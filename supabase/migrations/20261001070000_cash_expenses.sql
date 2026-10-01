-- =============================================================================
-- Fase 8.3 — Caja chica: salidas de efectivo del turno
-- =============================================================================
-- El corte Z decía expected_cash = fondo inicial + ventas en efectivo. Eso solo
-- cuadra si durante el turno no salió un peso de la gaveta. Y sale: hielo, gas,
-- servilletas, y esas cosas no tenían dónde anotarse. El cajero las sacaba de la
-- gaveta, el corte no lo sabía, y el faltante se quedaba sin explicación.
--
-- cash_expenses las registra. Y restarlas del esperado es lo que convierte al corte
-- Z en un corte de verdad: si la caja cuadra contra el esperado con gastos
-- descontados, entonces cualquier diferencia es un error real y no un gasto perdido.
--
-- -----------------------------------------------------------------------------
-- Es SOLO efectivo, y no es una simplificación
-- -----------------------------------------------------------------------------
-- No lleva payment_method porque lo que sale de la gaveta es efectivo por
-- definición. Un gasto pagado con tarjeta no es un movimiento de caja: no salió de
-- la gaveta, y descontarlo del esperado haría que el corte pareciera cuadrar cuando en
-- realidad no. Si algún día hay que llevar esos gastos, van en otra tabla y no
-- tocan esta fórmula.
--
-- -----------------------------------------------------------------------------
-- RLS sin ninguna política, como order_payments
-- -----------------------------------------------------------------------------
-- Es tabla de dinero. Se lee por RPC, que revalida el PIN, y no con una política
-- SELECT abierta. Las tablas de pedidos y renglones sí se leen abiertas porque las
-- necesita el tablero de cocina sin sesión; el dinero no.
-- =============================================================================

create table public.cash_expenses (
  id          uuid primary key default gen_random_uuid(),
  -- on delete restrict: un gasto con registro es evidencia. Si se borrara el turno,
  -- el gasto tiene que quedarse ahí diciendo que salió dinero.
  shift_id    uuid not null references public.shifts(id) on delete restrict,
  amount      numeric(12,2) not null check (amount > 0),
  reason      text not null check (btrim(reason) <> ''),
  by_employee uuid not null references public.employees(id),
  created_at  timestamptz not null default now(),
  voided_at   timestamptz,
  voided_by   uuid references public.employees(id),
  void_reason text,
  constraint cash_expenses_void_needs_reason
    check (voided_at is null or btrim(coalesce(void_reason, '')) <> '')
);

-- El índice es parcial y sobre shift_id porque las consultas son siempre "los gastos
-- VIGENTES de este turno". Los anulados no se consultan casi nunca, así que no
-- ensucian el índice.
create index on public.cash_expenses(shift_id) where voided_at is null;

alter table public.cash_expenses enable row level security;

-- -----------------------------------------------------------------------------
-- shifts.expenses_total
-- -----------------------------------------------------------------------------
-- Se congela al cerrar el turno, igual que expected_cash y variance. El motivo es
-- que un corte cerrado es un documento: si su resumen dependiera de recontar los
-- gastos cada vez que alguien abre el historial, un gasto borrado por error
-- reescribiría la historia de un turno que ya se quadró con el cajero.
--
-- Mientras el turno está abierto la columna sigue en 0 y NO es un dato roto: el total
-- vivo lo da el acumulado de list_shift_expenses, que es lo que lee la pantalla. El 0
-- de aquí se llena al cerrar, en el mismo UPDATE que freezes expected_cash y variance.
--
-- default 0 y not null para que los turnos ya cerrados, que son los que hay, no
-- queden con null y rompan los reportes.
-- -----------------------------------------------------------------------------

alter table public.shifts
  add column expenses_total numeric(12,2) not null default 0
    check (expenses_total >= 0);

-- =============================================================================
-- register_shift_expense
-- =============================================================================
-- Cualquier empleado con turno abierto, no solo el admin: el gasto real lo hace el
-- mesero o el cocinero saliendo a comprar hielo, y pedirle un PIN de administrador
-- para eso convierte cada compra en un trámite. El motivo es obligatorio porque una
-- salida sin explicación es indistinguible de un robo.

create or replace function public.register_shift_expense(
  p_pin    text,
  p_amount numeric,
  p_reason text
)
returns uuid
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_employee uuid;
  v_shift    uuid;
  v_amount   numeric;
  v_reason   text;
  v_id       uuid;
begin
  v_employee := public.auth_employee(p_pin);
  if v_employee is null then
    return null;
  end if;

  v_amount := round(coalesce(p_amount, 0), 2);
  if v_amount <= 0 then
    raise exception 'El monto del gasto debe ser mayor que cero' using errcode = '22023';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'Escribe en qué se gastó el dinero' using errcode = '22023';
  end if;

  select s.id into v_shift
    from public.shifts s
   where s.opened_by = v_employee and s.closed_at is null
   limit 1;

  if v_shift is null then
    raise exception 'No tienes un turno abierto. Abre tu turno en Caja primero.' using errcode = 'P0001';
  end if;

  insert into public.cash_expenses (shift_id, amount, reason, by_employee)
  values (v_shift, v_amount, v_reason, v_employee)
  returning id into v_id;

  return v_id;
end $$;

comment on function public.register_shift_expense(text, numeric, text) is
  'Registra una salida de efectivo del turno abierto. Exige PIN de empleado y motivo.';

-- =============================================================================
-- void_shift_expense
-- =============================================================================
-- Corregir un gasto mal capturado es normal ("puse 100 y eran 50"). Se anula con
-- motivo en vez de borrar la fila, porque borrar deja un agujero del mismo tamaño
-- que el error que se quería corregir.
--
-- Solo mientras el turno sigue abierto: con el corte ya hecho, el dinero ya se
-- contó contra el cajero y tocar el gasto reescribe un cuadre que ya se firmó.
--
-- Y solo el mismo empleado que lo registró, o un administrador. Un mesero no borra
-- el gasto de otro porque sí le conviene; un gerente sí puede corregirlo, y queda
-- el rastro de quién y por qué.

create or replace function public.void_shift_expense(
  p_pin      text,
  p_expense_id uuid,
  p_reason   text
)
returns void
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_employee uuid;
  v_admin    uuid;
  v_shift    uuid;
  v_expense  record;
  v_reason   text;
begin
  v_employee := public.auth_employee(p_pin);
  if v_employee is null then
    return;
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'Escribe por qué se anula el gasto' using errcode = '22023';
  end if;

  select e.id, e.shift_id, e.by_employee, e.voided_at
    into v_expense
    from public.cash_expenses e
   where e.id = p_expense_id;

  if v_expense.id is null then
    raise exception 'El gasto ya no existe' using errcode = 'P0001';
  end if;

  if v_expense.voided_at is not null then
    raise exception 'Ese gasto ya está anulado' using errcode = 'P0001';
  end if;

  select s.id into v_shift
    from public.shifts s
   where s.id = v_expense.shift_id and s.closed_at is null;

  if v_shift is null then
    raise exception 'El turno ya se cerró. El gasto ya entró en el corte.' using errcode = 'P0001';
  end if;

  v_admin := public.auth_admin(p_pin);
  if v_employee <> v_expense.by_employee and v_admin is null then
    raise exception 'Solo quien lo registró o un administrador puede anularlo' using errcode = 'P0001';
  end if;

  update public.cash_expenses e
     set voided_at = now(), voided_by = v_employee, void_reason = v_reason
   where e.id = p_expense_id;
end $$;

comment on function public.void_shift_expense(text, uuid, text) is
  'Anula un gasto del turno abierto, con motivo y sin borrarlo.';

-- =============================================================================
-- list_shift_expenses
-- =============================================================================
-- Solo del turno abierto del que llama. El acumulado viene en CADA fila, y la que lo
-- trae completo es la PRIMERA: el ORDER BY es descendente por fecha (lo más reciente
-- primero, que es como se lee una lista de gastos) pero la ventana de `sum() over` es
-- ASCENDENTE, así que la fila más reciente acumula todo lo vigente.
--
-- El cliente usa ese acumulado para calcular la diferencia del corte en vivo en vez de
-- sumar montos en JS: si el servidor redondea o ignora un gasto anulado de otra manera,
-- el corte de la pantalla y el del corte Z no pueden dar números distintos.

create or replace function public.list_shift_expenses(p_pin text)
returns table (
  id           uuid,
  amount       numeric,
  reason       text,
  by_name      text,
  created_at   timestamptz,
  voided_at    timestamptz,
  void_reason  text,
  voided_by    text,
  running_total numeric
)
language plpgsql stable security definer
set search_path = public, extensions as $$
declare
  v_employee uuid;
  v_shift    uuid;
begin
  -- El resultado de auth_employee se GUARDA, no solo se compara. Es la línea que hace
  -- que la función sirva: `s.opened_by = v_employee` es una comparación contra NULL
  -- mientras v_employee siga vacía, y una comparación contra NULL nunca es cierta, así
  -- que la lista salía siempre vacía aunque el turno tuviera gastos. Devolver vacío sin
  -- error es el peor modo de fallar: la pantalla muestra "sin gastos" y el corte espera
  -- un número que nunca llega.
  v_employee := public.auth_employee(p_pin);
  if v_employee is null then
    return;
  end if;

  select s.id into v_shift
    from public.shifts s
   where s.opened_by = v_employee and s.closed_at is null
   limit 1;

  if v_shift is null then
    return;
  end if;

  return query
  select e.id, e.amount, e.reason, emp.full_name, e.created_at,
         e.voided_at, e.void_reason, vb.full_name,
         -- Acumulado sobre los VIGENTES: los anulados ya no restan y aun así
         -- aparecen en la lista para que se vea que se corrigió algo.
         sum(case when e.voided_at is null then e.amount else 0 end)
           over (order by e.created_at, e.id)
    from public.cash_expenses e
    join public.employees emp on emp.id = e.by_employee
    left join public.employees vb on vb.id = e.voided_by
   where e.shift_id = v_shift
   order by e.created_at desc, e.id desc;
end $$;

comment on function public.list_shift_expenses(text) is
  'Gastos del turno abierto, con acumulado de los que siguen vigentes.';

-- =============================================================================
-- close_shift: los gastos salen del efectivo esperado
-- =============================================================================
-- Se DROPEA y se vuelve a crear, no se reemplaza. PostgreSQL no permite cambiar el
-- tipo de retorno con CREATE OR REPLACE, y aquí el tipo de retorno cambia de
-- verdad: se le agrega la columna de gastos. El cuerpo es casi el mismo; lo que
-- cambia de verdad es una línea aritmética y un campo más en el UPDATE.

drop function public.close_shift(text, numeric, text);

create or replace function public.close_shift(
  p_pin          text,
  p_counted_cash numeric,
  p_note         text default null
)
returns table (
  shift_id uuid,
  opening_float numeric,
  cash_sales numeric,
  card_sales numeric,
  transfer_sales numeric,
  total_sales numeric,
  ticket_count integer,
  expenses numeric,
  expected_cash numeric,
  counted_total numeric,
  cash_difference numeric
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
  v_expenses numeric := 0;
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

  -- Los gastos vigentes del turno. Los anulados se excluyen porque ya no restan, y
  -- contarlos restaría dos veces un error que ya se corrigió.
  select coalesce(sum(e.amount), 0) into v_expenses
    from public.cash_expenses e
   where e.shift_id = v_shift
     and e.voided_at is null;

  -- Lo que de verdad debería haber en la gaveta. Antes era fondo + efectivo y
  -- cualquier salida de caja se veía como faltante sin explicación.
  v_expected := v_float + v_cash - v_expenses;

  update public.shifts set
    closed_at      = now(),
    closed_by      = v_employee,
    counted_cash   = round(p_counted_cash, 2),
    expected_cash  = v_expected,
    expenses_total = v_expenses,
    variance       = round(p_counted_cash, 2) - v_expected,
    note           = nullif(btrim(coalesce(p_note, '')), '')
   where id = v_shift;

  return query
  select v_shift, v_float, v_cash, v_card, v_transfer, v_total, v_tickets,
         v_expenses, v_expected, round(p_counted_cash, 2), round(p_counted_cash, 2) - v_expected;
end $$;

comment on function public.close_shift(text, numeric, text) is
  'Cierra el turno. El efectivo esperado descuenta los gastos vigentes del turno.';

-- =============================================================================
-- shift_report y list_closed_shifts
-- =============================================================================
-- Solo agrega la columna de gastos a lo que ya devolvían. Un corte cerrado que
-- descuenta gastos del esperado pero no los muestra deja al lector sin explicación
-- de por qué el número es el que es.
--
-- Estas dos también se dropean por el mismo motivo que close_shift: cambia el tipo
-- de retorno. Ninguna función depende de ellas, y los permisos se vuelven a dar al
-- final.

drop function public.shift_report(text, uuid);
drop function public.list_closed_shifts(text, integer);

create or replace function public.shift_report(p_pin text, p_shift_id uuid)
returns table (
  shift_id uuid, employee_name text, opened_at timestamptz, closed_at timestamptz,
  opening_float numeric, cash_sales numeric, card_sales numeric, transfer_sales numeric,
  total_sales numeric, ticket_count integer, expenses numeric,
  counted_total numeric, expected_cash numeric, cash_difference numeric, shift_note text
)
language plpgsql security definer
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
         s.expenses_total,
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

create or replace function public.list_closed_shifts(p_admin_pin text, p_limit integer default 30)
returns table (
  shift_id uuid, employee_name text, opened_at timestamptz, closed_at timestamptz,
  opening_float numeric, cash_sales numeric, card_sales numeric, transfer_sales numeric,
  total_sales numeric, ticket_count integer, expenses numeric,
  counted_total numeric, expected_cash numeric, cash_difference numeric, shift_note text
)
language plpgsql security definer
set search_path = public, extensions as $$
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
         s.expenses_total,
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

-- =============================================================================
-- Permisos
-- =============================================================================

revoke all on function public.register_shift_expense(text, numeric, text) from public, authenticated;
grant execute on function public.register_shift_expense(text, numeric, text) to anon;

revoke all on function public.void_shift_expense(text, uuid, text) from public, authenticated;
grant execute on function public.void_shift_expense(text, uuid, text) to anon;

revoke all on function public.list_shift_expenses(text) from public, authenticated;
grant execute on function public.list_shift_expenses(text) to anon;

revoke all on function public.close_shift(text, numeric, text) from public, authenticated;
grant execute on function public.close_shift(text, numeric, text) to anon;

revoke all on function public.shift_report(text, uuid) from public, authenticated;
grant execute on function public.shift_report(text, uuid) to anon;

revoke all on function public.list_closed_shifts(text, integer) from public, authenticated;
grant execute on function public.list_closed_shifts(text, integer) to anon;