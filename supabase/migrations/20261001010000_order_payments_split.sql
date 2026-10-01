-- =============================================================================
-- Fase 7.1 — Pagos parciales y división de cuenta
-- =============================================================================
-- Hoy una orden tiene UN payment_method y se cobra de golpe: complete_order exige
-- status='served' y hace un solo UPDATE a 'completed'. Con una barra de burgers
-- eso no alcanza: una cuenta de $485 se puede pagar 200 efectivo + 285 tarjeta,
-- o repartirse entre 3 personas.
--
-- Lo que cambia:
--   · order_payments: una fila por cobro. Es la verdad del dinero.
--   · orders.paid_total: derivado, lo recalcula add_payment. Nunca se suma a mano.
--   · orders.status 'partially_paid': la orden existe y tiene pagos, aún no está
--     liquidada.
--   · split_amount: reparte sin perder ni inventar centavos.
--
-- LO MÁS IMPORTANTE DE ESTA MIGRACIÓN: los cinco cortes y reportes que sumaban
-- orders.total por orders.payment_method dejan de hacerlo y suman order_payments
-- por order_payments.method. Si se olvidara uno, una cuenta dividida con 200
-- efectivo + 285 tarjeta se reportaría 485 como tarjeta, y el Corte Z no
-- cuadraría contra la gaveta. Se reescriben los CINCO:
--   close_shift, get_open_shifts, shift_report  (turno)
--   list_closed_shifts, sales_summary           (histórico)
--
-- Una venta anulada sigue saliendo de los totales, igual que antes: se excluye
-- cuando su order.status = 'cancelled', sin importar que el pago exista.
-- =============================================================================

-- =============================================================================
-- 1) order_payments — la verdad del dinero
-- =============================================================================
create table public.order_payments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  amount       numeric(12,2) not null check (amount > 0),
  method       text not null check (method in ('cash','card','transfer')),
  shift_id     uuid references public.shifts(id) on delete set null,
  paid_by      uuid references public.employees(id) on delete restrict,
  paid_at      timestamptz not null default now(),
  -- void_payment marca el pago como revertido en vez de borrarlo: el peso estuvo
  -- en la gaveta y el corte necesita poder demostrarlo. Un pago revertido se
  -- excluye de los totales (reverted_at is not null) pero sigue siendo evidencia.
  reverted_at  timestamptz,
  revert_reason text,
  note         text,
  created_at   timestamptz not null default now()
);

comment on table public.order_payments is
  'Cada cobro de una orden. Una cuenta dividida genera varios pagos con métodos distintos. Los cortes suman aquí, nunca orders.total.';
comment on column public.order_payments.reverted_at is
  'Fecha de reversa. Un pago con reverted_at sigue en la bitácora pero NO suma a los cortes.';

-- Índices: el primero sirve para listar los pagos de una orden (ticket, split), el
-- segundo para los cortes por turno+metodo, el tercero para sales_summary por fecha.
create index order_payments_order_idx on public.order_payments (order_id, paid_at);
create index order_payments_shift_method_idx on public.order_payments (shift_id, method)
  where shift_id is not null and reverted_at is null;
create index order_payments_paid_at_idx on public.order_payments (paid_at)
  where reverted_at is null;

-- =============================================================================
-- 2) orders: estado 'partially_paid' y total pagado (derivado)
-- =============================================================================
-- paid_total es un caché que la suma de order_payments debe reflejar. Existe
-- para que el tablero de cocina y el mapa de mesas muestren "faltan $X" sin
-- tener que agregar los pagos en cada SELECT. Lo escribe SOLO add_payment (y
-- void_payment para bajarlo); ningún otro flujo lo toca.
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','in_kitchen','ready','served',
                    'partially_paid','completed','cancelled'));

alter table public.orders add column paid_total numeric(12,2) not null default 0
  check (paid_total >= 0);

comment on column public.orders.paid_total is
  'Suma de order_payments no revertidos de la orden. Derivado: lo recalcula add_payment.';

-- Índices: el primero encuentra cuentas abiertas por mesa (mapa de mesas, 7.2);
-- el segundo es el tablero de cocina incluyendo lo parcialmente pagado.
create index orders_table_status_idx on public.orders (table_number, status)
  where status not in ('completed','cancelled');
create index orders_open_partial_idx on public.orders (created_at)
  where status in ('pending','in_kitchen','ready','served','partially_paid');

-- =============================================================================
-- 3) split_amount — reparto sin perder ni inventar centavos
-- =============================================================================
-- 485 entre 3 -> 161.67, 161.67, 161.66 (los centavos van a los primeros pagos).
-- 100 entre 7 -> base 14.28, los primeros 4 reciben 14.29. Suma 100.00 exacto.
--
-- Por qué truncar y no redondear: truncar da el piso, y el resto (v_remainder,
-- los centavos) se reparte uno a uno entre los primeros. Así la suma de los
-- amounts es EXACTAMENTE p_total, sin que el sistema se quede ni regale un centavo.
--
-- Por qué los primeros y no el último: si el último absorbiera el ajuste, quien
-- paga de más es el último de la fila, y un cajero nuevo no sabe que esa cuenta
-- quedó chueca. Repartir entre los primeros hace que la diferencia máxima entre
-- dos personas sea un centavo, invisible.
create or replace function public.split_amount(p_total numeric, p_parts int)
returns table (part_no int, amount numeric)
language plpgsql immutable
set search_path = public as $$
declare
  v_base      numeric;
  v_remainder numeric;
  v_i         int;
begin
  if p_parts is null or p_parts < 1 then
    raise exception 'La cuenta se divide entre una o más personas' using errcode = '22023';
  end if;
  if p_total is null or p_total <= 0 then
    raise exception 'El total debe ser mayor a cero' using errcode = '22023';
  end if;

  v_base := trunc(p_total / p_parts, 2);
  v_remainder := p_total - v_base * p_parts;   -- la diferencia, en centavos

  for v_i in 1..p_parts loop
    return query
      select v_i,
             case when v_i <= v_remainder then v_base + 0.01 else v_base end;
  end loop;
end $$;

comment on function public.split_amount(numeric, int) is
  'Reparte un total entre n partes. Los centavos sobrantes van a los primeros pagos. Suma exacta.';

-- =============================================================================
-- 4) add_payment — el cobro, único lugar que escribe order_payments
-- =============================================================================
-- Cobrar es la única transición que mueve dinero, así que es la única que
-- revalida turno + PIN y la única que escribe en order_payments. complete_order
-- y el split la llaman; no hay un segundo camino que escriba dinero.
--
-- La cuenta solo se cobra cuando está 'served' o 'partially_paid': la cocina
-- primero sirve, luego se cobra. Cobrar una orden 'pending' saltaría el flujo.
--
-- Tolerancia de un centavo: si el cobro cierra por diferencia de redondeo del
-- cajero, la cuenta se liquida en vez de quedar "a un centavo" para siempre.
-- El rango aceptado es [total - 0.01, total + 0.01].
create or replace function public.add_payment(
  p_order_id uuid,
  p_pin text,
  p_shift_id uuid,
  p_payment_method text,
  p_amount numeric,
  p_note text default null
)
returns table (order_id uuid, paid_total numeric, remaining numeric, status text)
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_employee uuid;
  v_total    numeric;
  v_paid     numeric;
  v_new      numeric;
  v_status   text;
begin
  if p_payment_method is null or p_payment_method not in ('cash','card','transfer') then
    raise exception 'Método de pago no válido' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto a cobrar debe ser mayor a cero' using errcode = '22023';
  end if;

  v_employee := public.auth_employee(p_pin);
  if v_employee is null then
    return;   -- vacío, no error: el rate limit debe sobrevivir al intento fallido
  end if;

  -- El turno tiene que ser el del cajero que cobra: si no, el efectivo cae en la
  -- gaveta de otro y su corte nunca lo refleja. Mismo motivo que complete_order.
  perform 1 from public.shifts
   where id = p_shift_id and closed_at is null and opened_by = v_employee;
  if not found then
    raise exception 'No hay una caja abierta. Abre tu turno en Caja antes de cobrar.' using errcode = 'P0001';
  end if;

  -- FOR UPDATE serializa dos cobros concurrentes de la misma orden: el segundo
  -- espera y al despertar ve paid_total ya actualizado, así que no hay doble cobro.
  select o.total, coalesce(o.paid_total, 0), o.status
    into v_total, v_paid, v_status
    from public.orders o
   where o.id = p_order_id
   for update;

  if v_total is null then
    raise exception 'La orden no existe' using errcode = 'P0001';
  end if;
  if v_status in ('completed','cancelled') then
    raise exception 'Esta orden ya no admite cobros (está en %)', v_status using errcode = 'P0001';
  end if;
  -- Solo se cobra lo servido. partially_paid es el estado intermedio de una
  -- cuenta dividida: sigue pendiente, no es una orden nueva en cocina.
  if v_status not in ('served','partially_paid') then
    raise exception 'Solo se cobra una orden servida (está en %)', v_status using errcode = 'P0001';
  end if;

  v_new := v_paid + round(p_amount, 2);

  if v_new > v_total + 0.01 then
    raise exception 'El cobro ($%) supera lo que falta ($%)', round(v_new, 2),
            round(v_total - v_paid, 2) using errcode = '22023';
  end if;

  insert into public.order_payments
    (order_id, amount, method, shift_id, paid_by, note)
  values
    (p_order_id, round(p_amount, 2), p_payment_method, p_shift_id, v_employee,
     nullif(btrim(coalesce(p_note, '')), ''));

  if v_new >= v_total - 0.01 then
    v_status := 'completed';
  else
    v_status := 'partially_paid';
  end if;

  update public.orders
     set paid_total = v_new,
         status = v_status,
         -- payment_method queda como respaldo para cuando la orden se liquidó en un
         -- solo pago; los cortes ya no lo leen (usan order_payments). En una cuenta
         -- dividida muestra el método del último cobro: es informativo, no la verdad.
         payment_method = case when v_status = 'completed'
                               then p_payment_method else payment_method end,
         paid_at = case when v_status = 'completed' then now() else paid_at end,
         shift_id = p_shift_id
   where id = p_order_id;

  return query select p_order_id, v_new, round(v_total - v_new, 2), v_status;
end $$;

-- =============================================================================
-- 5) complete_order — atajo de un solo pago, ahora sobre add_payment
-- =============================================================================
-- Antes escribía directo en orders. Ahora delega en add_payment para que exista
-- UN solo camino que escriba en order_payments: ningún cobro puede quedar fuera
-- de la bitácora. Cobra lo que falta (total - paid_total), así que también sirve
-- para liquidar el último tranche de una cuenta dividida.
--
-- Devuelve NULL si el PIN no cuadra (igual que antes): es el camino del rate
-- limit, abortar la transacción tiraría el contador.
create or replace function public.complete_order(
  p_order_id uuid, p_pin text, p_shift_id uuid, p_payment_method text
)
returns text language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_total     numeric;
  v_paid      numeric;
  v_remaining numeric;
  r_status    text;
begin
  select o.total, coalesce(o.paid_total, 0) into v_total, v_paid
    from public.orders o
   where o.id = p_order_id;

  if v_total is null then
    return null;
  end if;

  v_remaining := round(v_total - v_paid, 2);

  -- Ya liquidada (o con el centavo de tolerancia cubierto): no hay nada que cobrar.
  if v_remaining <= 0.01 then
    return 'completed';
  end if;

  -- add_payment revalida PIN, turno y estado, y devuelve status en su 4a columna.
  -- Si el PIN falla, add_payment devuelve conjunto vacío y r_status queda null.
  select a.status into r_status
    from public.add_payment(p_order_id, p_pin, p_shift_id, p_payment_method, v_remaining) a;

  return r_status;
end $$;

-- =============================================================================
-- 6) order_payment_status — qué falta por cobrar
-- =============================================================================
-- Para el badge "faltan $X" del tablero y el resumen del diálogo de división.
-- No pide turno: es lectura del estado de la cuenta.
create or replace function public.order_payment_status(p_pin text, p_order_id uuid)
returns table (
  total       numeric,
  paid_total  numeric,
  remaining   numeric,
  status      text,
  payments    int
)
language plpgsql volatile security definer
set search_path = public, extensions as $$
begin
  if public.auth_employee(p_pin) is null then
    return;
  end if;
  return query
  select o.total,
         coalesce(o.paid_total, 0),
         round(o.total - coalesce(o.paid_total, 0), 2),
         o.status,
         (select count(*)::int from public.order_payments p
           where p.order_id = o.id and p.reverted_at is null)
    from public.orders o
   where o.id = p_order_id;
end $$;

-- =============================================================================
-- 7) list_order_payments — detalle de pagos (ticket, historial, split ya cobrado)
-- =============================================================================
create or replace function public.list_order_payments(p_pin text, p_order_id uuid)
returns table (
  payment_id uuid,
  amount     numeric,
  method     text,
  paid_at    timestamptz,
  paid_by    text,
  note       text,
  reverted   boolean
)
language plpgsql volatile security definer
set search_path = public, extensions as $$
begin
  if public.auth_employee(p_pin) is null then
    return;
  end if;
  return query
  select p.id, p.amount, p.method, p.paid_at, e.full_name, p.note, p.reverted_at is not null
    from public.order_payments p
    left join public.employees e on e.id = p.paid_by
   where p.order_id = p_order_id
   order by p.paid_at, p.id;
end $$;

-- =============================================================================
-- 8) void_payment — reversa de un cobro mal hecho
-- =============================================================================
-- No borra el pago: lo marca revertido. Borrarlo sería perder la evidencia de que
-- ese peso estuvo en la gaveta, que es justo lo que el corte debe poder demostrar.
-- El pago sale de los totales (los cortes filtran reverted_at is null) y se le
-- baja a orders.paid_total. Si la orden estaba liquidada, vuelve a partially_paid.
create or replace function public.void_payment(
  p_payment_id uuid, p_reason text, p_admin_pin text
)
returns table (payment_id uuid, order_id uuid, method text, amount numeric)
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_admin  uuid;
  v_order  uuid;
  v_method text;
  v_amount numeric;
  v_total  numeric;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Escribe el motivo de la reversa' using errcode = '22023';
  end if;

  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return;
  end if;

  update public.order_payments p
     set reverted_at = now(),
         revert_reason = btrim(p_reason)
   where p.id = p_payment_id and p.reverted_at is null
  returning p.order_id, p.method, p.amount into v_order, v_method, v_amount;

  if v_order is null then
    raise exception 'El pago no existe o ya fue revertido' using errcode = 'P0001';
  end if;

  select o.total into v_total
    from public.orders o
   where o.id = v_order
   for update;

  -- Se recalcula paid_total desde los pagos vivos, no restando a ciegas: así no
  -- se acumula error de redondeo si esto se repite varias veces.
  update public.orders o
     set paid_total = coalesce((
           select sum(p.amount) from public.order_payments p
            where p.order_id = o.id and p.reverted_at is null
         ), 0),
         status = case
           when o.status = 'completed'
             and coalesce((select sum(p.amount) from public.order_payments p
                            where p.order_id = o.id and p.reverted_at is null), 0)
                 < o.total - 0.01
             then 'partially_paid'::text
           else o.status end,
         paid_at = case
           when o.status = 'completed'
             and coalesce((select sum(p.amount) from public.order_payments p
                            where p.order_id = o.id and p.reverted_at is null), 0)
                 < o.total - 0.01
             then null else o.paid_at end
   where o.id = v_order;

  return query select p_payment_id, v_order, v_method, v_amount;
end $$;

-- =============================================================================
-- 9) REESCRITURA DE LOS CINCO CORTES — suman order_payments
-- =============================================================================
-- Regla que se aplica en los cinco: el dinero se suma desde order_payments por
-- su método real, excluyendo pagos revertidos y excluyendo órdenes anuladas
-- (para que una venta anulada siga saliendo de los totales, como antes).
--
-- ticket_count cuenta órdenes DISTINTAS con al menos un pago vivo: un ticket no
-- se multiplica porque se pague en tres partes.
-- total_sales = suma de lo cobrado, que es lo que realmente entró a la gaveta.

-- ---- close_shift (Corte Z: el efectivo esperado) ----
create or replace function public.close_shift(p_pin text, p_counted_cash numeric, p_note text default null)
returns table (
  shift_id           uuid,
  opening_float      numeric,
  cash_sales         numeric,
  card_sales         numeric,
  transfer_sales     numeric,
  total_sales        numeric,
  ticket_count       int,
  expected_cash      numeric,
  counted_total      numeric,
  cash_difference    numeric
)
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_employee uuid;
  v_shift    uuid;
  v_float    numeric;
  v_cash     numeric := 0;
  v_card     numeric := 0;
  v_transfer numeric := 0;
  v_total    numeric := 0;
  v_tickets  int := 0;
  v_expected numeric;
begin
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'El efectivo contado no puede ser negativo' using errcode = '22023';
  end if;

  v_employee := public.auth_employee(p_pin);
  if v_employee is null then
    return;
  end if;

  select s.id, s.opening_float into v_shift, v_float
    from public.shifts s
   where s.opened_by = v_employee and s.closed_at is null
   for update;

  if v_shift is null then
    raise exception 'No tienes un turno abierto' using errcode = 'P0001';
  end if;

  -- Suma de order_payments por método real, sin pagos revertidos y sin órdenes
  -- anuladas (order.status='cancelled'). El subconsulto pre-filtra para que los
  -- sums y el count distinct desquiten de la misma forma.
  select coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
         coalesce(sum(p.amount) filter (where p.method = 'card'), 0),
         coalesce(sum(p.amount) filter (where p.method = 'transfer'), 0),
         coalesce(sum(p.amount), 0),
         count(distinct p.order_id)::int
    into v_cash, v_card, v_transfer, v_total, v_tickets
    from public.order_payments p
    join public.orders o on o.id = p.order_id
   where p.shift_id = v_shift
     and p.reverted_at is null
     and o.status <> 'cancelled';

  v_expected := v_float + v_cash;

  update public.shifts set
    closed_at     = now(),
    closed_by     = v_employee,
    counted_cash  = round(p_counted_cash, 2),
    expected_cash = v_expected,
    variance      = round(p_counted_cash, 2) - v_expected,
    note          = nullif(btrim(coalesce(p_note, '')), '')
   where id = v_shift;

  return query
  select v_shift, v_float, v_cash, v_card, v_transfer, v_total, v_tickets,
         v_expected, round(p_counted_cash, 2), round(p_counted_cash, 2) - v_expected;
end $$;

-- ---- get_open_shifts (Corte X, en vivo) ----
create or replace function public.get_open_shifts(p_pin text)
returns table (
  id             uuid,
  opened_by      uuid,
  employee_name  text,
  opened_at      timestamptz,
  opening_float  numeric,
  cash_sales     numeric,
  card_sales     numeric,
  transfer_sales numeric,
  total_sales    numeric,
  ticket_count   int
)
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_employee uuid;
begin
  v_employee := public.auth_employee(p_pin);
  if v_employee is null then
    return;
  end if;

  return query
  select s.id, s.opened_by, e.full_name, s.opened_at, s.opening_float,
         coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
         coalesce(sum(p.amount) filter (where p.method = 'card'), 0),
         coalesce(sum(p.amount) filter (where p.method = 'transfer'), 0),
         coalesce(sum(p.amount), 0),
         count(distinct p.order_id)::int
    from public.shifts s
    join public.employees e on e.id = s.opened_by
    left join public.order_payments p
      on p.shift_id = s.id and p.reverted_at is null
    left join public.orders po
      on po.id = p.order_id and po.status = 'cancelled'
   where s.closed_at is null
     and (p.id is null or po.id is null)   -- excluye pagos de órdenes anuladas
   group by s.id, e.full_name
   order by s.opened_at;
end $$;

-- ---- shift_report (un turno concreto, abierto o cerrado) ----
create or replace function public.shift_report(p_pin text, p_shift_id uuid)
returns table (
  shift_id           uuid,
  employee_name      text,
  opened_at          timestamptz,
  closed_at          timestamptz,
  opening_float      numeric,
  cash_sales         numeric,
  card_sales         numeric,
  transfer_sales     numeric,
  total_sales        numeric,
  ticket_count       int,
  counted_total      numeric,
  expected_cash      numeric,
  cash_difference    numeric,
  shift_note         text
)
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_employee uuid;
begin
  v_employee := public.auth_employee(p_pin);
  if v_employee is null then
    return;
  end if;

  return query
  select s.id, e.full_name, s.opened_at, s.closed_at, s.opening_float,
         coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
         coalesce(sum(p.amount) filter (where p.method = 'card'), 0),
         coalesce(sum(p.amount) filter (where p.method = 'transfer'), 0),
         coalesce(sum(p.amount), 0),
         count(distinct p.order_id)::int,
         s.counted_cash, s.expected_cash, s.variance, s.note
    from public.shifts s
    join public.employees e on e.id = s.opened_by
    left join public.order_payments p
      on p.shift_id = s.id and p.reverted_at is null
    left join public.orders po
      on po.id = p.order_id and po.status = 'cancelled'
   where s.id = p_shift_id
     and (p.id is null or po.id is null)
   group by s.id, e.full_name;
end $$;

-- ---- list_closed_shifts (historial de cortes) ----
create or replace function public.list_closed_shifts(p_admin_pin text, p_limit int default 30)
returns table (
  shift_id         uuid,
  employee_name    text,
  opened_at        timestamptz,
  closed_at        timestamptz,
  opening_float    numeric,
  cash_sales       numeric,
  card_sales       numeric,
  transfer_sales   numeric,
  total_sales      numeric,
  ticket_count     int,
  counted_total    numeric,
  expected_cash    numeric,
  cash_difference  numeric,
  shift_note       text
)
language plpgsql volatile security definer
set search_path = public as $$
begin
  if public.auth_admin(p_admin_pin) is null then
    return;
  end if;

  return query
  select s.id, e.full_name, s.opened_at, s.closed_at, s.opening_float,
         coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
         coalesce(sum(p.amount) filter (where p.method = 'card'), 0),
         coalesce(sum(p.amount) filter (where p.method = 'transfer'), 0),
         coalesce(sum(p.amount), 0),
         count(distinct p.order_id)::int,
         s.counted_cash, s.expected_cash, s.variance, s.note
    from public.shifts s
    join public.employees e on e.id = s.opened_by
    left join public.order_payments p
      on p.shift_id = s.id and p.reverted_at is null
    left join public.orders po
      on po.id = p.order_id and po.status = 'cancelled'
   where s.closed_at is not null
     and (p.id is null or po.id is null)
   group by s.id, e.full_name
   order by s.closed_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 200);
end $$;

-- ---- sales_summary (hoy / semana / rango, por fecha de pago) ----
-- Tres cortes en una llamada, igual que antes. La ventana se filtra por el
-- paid_at de cada pago (money-in-time), no por orders.paid_at: una cuenta
-- dividida puede tener pagos en dos días y ambos deben caer donde se cobraron.
--
-- Las ventas (total, ticket_count, ticket_average, cash/card/transfer) salen de
-- order_payments. Las anulaciones (voided_count, voided_amount) siguen saliendo
-- de orders.cancelled, que es un hecho distinto (la venta se anuló, no el pago).
--
-- ticket_average = total_sales / ticket_count, equivalente al avg del total de
-- órdenes completadas: con cuentas divididas, el promedio del ticket debe seguir
-- siendo el promedio por TICKET, no por cobro.
create or replace function public.sales_summary(
  p_admin_pin text,
  p_from date,
  p_to date default null,
  p_from_ts timestamptz default null,
  p_to_ts timestamptz default null
)
returns table (
  scope           text,
  total_sales     numeric,
  ticket_count    int,
  ticket_average  numeric,
  cash_sales      numeric,
  card_sales      numeric,
  transfer_sales  numeric,
  voided_count    int,
  voided_amount   numeric
)
language plpgsql volatile security definer
set search_path = public as $$
declare
  v_today date;
  v_week  date;
  v_lo    timestamptz;
  v_hi    timestamptz;
begin
  if public.auth_admin(p_admin_pin) is null then
    return;
  end if;

  v_today := public.business_day(now());
  v_week  := public.business_week_start(now());

  v_lo := coalesce(
    p_from_ts,
    (coalesce(p_from, v_today)::timestamp at time zone public.business_tz())
  );
  v_hi := coalesce(
    p_to_ts,
    (((coalesce(p_to, v_today) + 1)::timestamp at time zone public.business_tz())
      - interval '1 microsecond')
  );

  return query
  with periodos(scope, lo, hi) as (
    values
      ('hoy',   v_today::timestamp at time zone public.business_tz(),
                 ((v_today + 1)::timestamp at time zone public.business_tz()) - interval '1 microsecond'),
      ('semana', v_week::timestamp at time zone public.business_tz(),
                 ((v_week + 7)::timestamp at time zone public.business_tz()) - interval '1 microsecond'),
      ('rango',  v_lo, v_hi)
  ),
  -- Ventas: dinero cobrado, por método real, de órdenes no anuladas.
  pagos as (
    select per.scope,
           sum(p.amount) as total,
           count(distinct p.order_id)::int as tickets,
           sum(p.amount) filter (where p.method = 'cash')     as cash,
           sum(p.amount) filter (where p.method = 'card')     as card,
           sum(p.amount) filter (where p.method = 'transfer') as transfer
      from periodos per
      join public.order_payments p
        on p.paid_at >= per.lo and p.paid_at <= per.hi
      join public.orders o
        on o.id = p.order_id and o.status <> 'cancelled'
     where p.reverted_at is null
     group by per.scope
  ),
  -- Anulaciones: órdenes cobradas y luego canceladas (histórico, no se restan).
  anuladas as (
    select per.scope,
           count(*)::int as cnt,
           sum(o.total) as amount
      from periodos per
      join public.orders o
        on o.paid_at >= per.lo and o.paid_at <= per.hi
     where o.status = 'cancelled'
     group by per.scope
  )
  select per.scope,
         coalesce(pg.total, 0),
         coalesce(pg.tickets, 0),
         case when coalesce(pg.tickets, 0) > 0
              then round(pg.total / pg.tickets, 2) else 0 end,
         coalesce(pg.cash, 0),
         coalesce(pg.card, 0),
         coalesce(pg.transfer, 0),
         coalesce(an.cnt, 0),
         coalesce(an.amount, 0)
    from periodos per
    left join pagos pg on pg.scope = per.scope
    left join anuladas an on an.scope = per.scope
   order by array_position(array['hoy','semana','rango'], per.scope);
end $$;

-- =============================================================================
-- 10) Realtime: order_payments entra a la publicación
-- =============================================================================
-- El mapa de mesas (7.2) y el tablero escuchan order_payments para que un cobro
-- cambie el color de la mesa sin recargar. Se agrega con guarda por si ya estaba.
do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime'
                   and schemaname='public' and tablename='order_payments') then
    alter publication supabase_realtime add table public.order_payments;
  end if;
end $$;

-- =============================================================================
-- 11) Permisos
-- =============================================================================
-- order_payments es dinero: RLS sin políticas (la ausencia de políticas es la
-- protección) y sin ningún privilegio para anon/authenticated. Se accede solo
-- por las RPC, que revalidan PIN.
alter table public.order_payments enable row level security;
revoke all on table public.order_payments from anon, authenticated;

-- Las RPC que el navegador necesita (split_amount para previsualizar, add_payment
-- y sus lecturas para cobrar) son ejecutables por anon; cada una revalida el PIN
-- que necesita dentro del cuerpo.
revoke all on function public.split_amount(numeric, int) from public, authenticated;
grant execute on function public.split_amount(numeric, int) to anon;

revoke all on function public.add_payment(uuid, text, uuid, text, numeric, text) from public, authenticated;
grant execute on function public.add_payment(uuid, text, uuid, text, numeric, text) to anon;

-- complete_order conserva su firma; se re-grant por claridad aunque ya tenía.
revoke all on function public.complete_order(uuid, text, uuid, text) from public, authenticated;
grant execute on function public.complete_order(uuid, text, uuid, text) to anon;

revoke all on function public.order_payment_status(text, uuid) from public, authenticated;
grant execute on function public.order_payment_status(text, uuid) to anon;

revoke all on function public.list_order_payments(text, uuid) from public, authenticated;
grant execute on function public.list_order_payments(text, uuid) to anon;

revoke all on function public.void_payment(uuid, text, text) from public, authenticated;
grant execute on function public.void_payment(uuid, text, text) to anon;

-- =============================================================================
-- Verificación post-migración
-- =============================================================================
--  1. Los cinco cortes ya NO deben mencionar orders.total junto a payment_method:
--       select proname from pg_proc join pg_namespace on pg_namespace.oid=pronamespace
--        where nspname='public' and proname in
--          ('close_shift','get_open_shifts','shift_report','list_closed_shifts','sales_summary')
--          and prosrc like '%orders%payment_method%';
--     -> cero filas.
--
--  2. Todos los cortes sí deben leer order_payments:
--       ... and prosrc like '%order_payments%';
--     -> cinco filas.
--
--  3. Repartos (no mutan nada, split_amount es pura):
--       select part_no, amount from split_amount(485, 3);  -- 161.67,161.67,161.66 suma 485.00
--       select sum(amount) from split_amount(100, 7);        -- 100.00
--       select sum(amount) from split_amount(100, 6);        -- 100.00
--
--  4. La tabla de pagos no es legible por anon:
--       -- debe fallar 42501:
--       --   select * from order_payments;
-- =============================================================================