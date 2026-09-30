-- =============================================================================
-- Fase 2 — Turnos de caja y órdenes exclusivamente por RPC
-- =============================================================================
-- Son dos cosas en una migración porque create_order depende de shifts: si no hay
-- turno abierto no se puede cobrar, y el turno es lo que da identidad verificable a
-- la venta. Se paga con que el orden de despliegue sea 1) esta migración, 2) el
-- cliente la usa, 3) la migración siguiente revoca la escritura directa.
--
-- Sigue siendo ADITIVA. orders y order_items todavía aceptan INSERT y UPDATE desde
-- anon hasta que aterrice la fase 3; esto solo agrega la vía correcta.
-- =============================================================================

-- ---------- turnos de caja ----------
create table public.shifts (
  id            uuid primary key default gen_random_uuid(),
  opened_by     uuid not null references public.employees(id) on delete restrict,
  opened_at     timestamptz not null default now(),
  opening_float numeric(12,2) not null default 0 check (opening_float >= 0),
  closed_at     timestamptz,
  closed_by     uuid references public.employees(id) on delete restrict,
  counted_cash  numeric(12,2) check (counted_cash >= 0),
  expected_cash numeric(12,2),
  variance      numeric(12,2),
  note          text,
  created_at    timestamptz not null default now()
);

comment on table public.shifts is
  'Turnos de caja, uno por cajero. Varios pueden estar abiertos a la vez; con una sola gaveta el modelo degenera solo en uno.';
comment on column public.shifts.expected_cash is
  'opening_float + ventas en efectivo del turno. Lo calcula el servidor en close_shift.';
comment on column public.shifts.variance is
  'counted_cash - expected_cash. Negativo es faltante, positivo es sobrante.';

-- Un cajero no puede tener dos gavetas abiertas a la vez: si pudiera, el dinero de
-- ambas mezclaría y el corte no cuadraría contra nada.
create unique index shifts_one_open_per_employee on public.shifts (opened_by)
  where closed_at is null;
create index shifts_opened_at_desc_idx on public.shifts (opened_at desc);
create index shifts_closed_at_desc_idx on public.shifts (closed_at desc)
  where closed_at is not null;

-- ---------- columnas nuevas en orders ----------
-- shift_id se estampa al COBRAR, no al crear. El dinero entra en la gaveta cuando el
-- cliente paga, así que es ahí donde la orden pertenece a un turno. Nullable para no
-- tener que reescribir las órdenes ya existentes.
alter table public.orders add column shift_id uuid references public.shifts(id) on delete set null;
alter table public.orders add column void_reason text;
alter table public.orders add column voided_at timestamptz;

comment on column public.orders.shift_id is
  'Turno al que pertenece la venta. Se estampa en complete_order, no en create_order.';
comment on column public.orders.void_reason is
  'Motivo de la anulación. Obligatorio: cancel_order lo exige siempre.';

create index orders_shift_idx on public.orders (shift_id, payment_method)
  where shift_id is not null;
create index orders_paid_at_idx on public.orders (paid_at desc)
  where paid_at is not null;
create index orders_voided_at_idx on public.orders (voided_at desc)
  where voided_at is not null;

-- =============================================================================
-- Identidad
-- =============================================================================
-- Zona horaria del negocio en una sola función. "Ventas del día" tiene que cortar a
-- medianoche del restaurante, no de UTC: con UTC, el día cerraría a las 18:00 hora
-- local y todo el reporte diario estaría corrido medio día.
create function public.business_tz()
returns text language sql immutable
set search_path = public as $$ select 'America/Mexico_City'::text $$;

comment on function public.business_tz() is
  'Zona horaria del negocio. Cambiarla aquí mueve el corte de todos los reportes.';

-- Verificación de PIN de cualquier empleado activo. Es la primitiva de la que ahora
-- dependen auth_admin y los turnos, para que la lógica de rate limit y de bcrypt viva
-- en un solo sitio.
--
-- El registro de intento ocurre siempre, pero acertar borra la cuenta: lo que el límite
-- protege es la fuerza bruta, no el uso. Sin esto, cinco create_order correctos seguidos
-- bloqueaban la IP 15 minutos y el POS se trababa solo en el quinto ticket del turno.
create function public.auth_employee(p_pin text, p_role text default null)
returns uuid language plpgsql security definer
set search_path = public, extensions as $$
declare v_id uuid; v_block text;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return null;
  end if;

  v_block := public.rate_limit_register();
  if v_block is not null then
    return null;
  end if;

  select e.id into v_id
    from public.employees e
   where e.is_active
     and e.pin_hash = extensions.crypt(p_pin, e.pin_hash)
     and (p_role is null or e.role = p_role)
   limit 1;

  if v_id is not null then
    perform public.rate_limit_clear();
  end if;

  return v_id;
end $$;

-- auth_admin pasa a delegar en auth_employee. No cambia su contrato: sigue devolviendo
-- NULL en vez de lanzar, para que el contador anti-fuerza-bruta sobreviva.
create or replace function public.auth_admin(p_pin text)
returns uuid language plpgsql security definer
set search_path = public, extensions as $$
begin
  return public.auth_employee(p_pin, 'admin');
end $$;

-- =============================================================================
-- Turnos
-- =============================================================================
-- Devuelve, no lanza, en todos los caminos de autorización: si el RPC abortara la
-- transacción, el incremento del rate limit se perdería con ella.
create function public.open_shift(p_pin text, p_opening_float numeric)
returns uuid language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_employee uuid;
  v_existing uuid;
  v_shift    uuid;
begin
  if p_opening_float is null or p_opening_float < 0 then
    raise exception 'El fondo inicial no puede ser negativo' using errcode = '22023';
  end if;

  v_employee := public.auth_employee(p_pin);
  if v_employee is null then
    return null;
  end if;

  select s.id into v_existing
    from public.shifts s
   where s.opened_by = v_employee and s.closed_at is null
   limit 1;

  if v_existing is not null then
    -- Levanta en vez de devolver el turno existente: si el cajero quiere corregir el
    -- fondo, necesita saber que hay una gaveta abierta, no que el sistema le cuelgue
    -- silenciosamente la anterior.
    raise exception 'Ya tienes un turno abierto' using errcode = 'P0001';
  end if;

  insert into public.shifts (opened_by, opening_float)
  values (v_employee, round(p_opening_float, 2))
  returning id into v_shift;

  return v_shift;
end $$;

-- Las columnas de salida no se llaman igual que los parámetros: PostgREST devuelve
-- PGRST102 ("Empty or invalid json") si chocan, aunque la función sea correcta.
create function public.close_shift(p_pin text, p_counted_cash numeric, p_note text default null)
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
language plpgsql security definer
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

  -- FOR UPDATE serializa dos intentos de cierre simultáneos del mismo turno: el
  -- segundo espera y al despertar ve closed_at ya puesto.
  select s.id, s.opening_float into v_shift, v_float
    from public.shifts s
   where s.opened_by = v_employee and s.closed_at is null
   for update;

  if v_shift is null then
    raise exception 'No tienes un turno abierto' using errcode = 'P0001';
  end if;

  select coalesce(sum(o.total) filter (where o.payment_method = 'cash'), 0),
         coalesce(sum(o.total) filter (where o.payment_method = 'card'), 0),
         coalesce(sum(o.total) filter (where o.payment_method = 'transfer'), 0),
         coalesce(sum(o.total), 0),
         count(*)::int
    into v_cash, v_card, v_transfer, v_total, v_tickets
    from public.orders o
   where o.shift_id = v_shift and o.status = 'completed';

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

-- Turnos abiertos, con su desglose en vivo. Es el Corte X: lectura pura, no cierra nada.
--
-- Exige PIN aunque solo lea. El fondo inicial y las ventas de cada gaveta son dato
-- financiero: granting esto a anon sin PIN publicaría la caja de todo el negocio en el
-- bundle, que es el mismo error que auth_admin no sea ejecutable por anon.
--
-- Devuelve vacío en vez de lanzar si el PIN falla, por el mismo motivo que open_shift:
-- que el rate limit sobreviva al intento fallido.
--
-- Volatile, no stable: auth_employee escribe en pin_rate_limits, y PostgreSQL rechaza
-- escrituras dentro de una función marcada stable.
create function public.get_open_shifts(p_pin text)
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
         coalesce(sum(o.total) filter (where o.payment_method = 'cash'), 0),
         coalesce(sum(o.total) filter (where o.payment_method = 'card'), 0),
         coalesce(sum(o.total) filter (where o.payment_method = 'transfer'), 0),
         coalesce(sum(o.total), 0),
         count(o.id)::int
    from public.shifts s
    join public.employees e on e.id = s.opened_by
    left join public.orders o
      on o.shift_id = s.id and o.status = 'completed'
   where s.closed_at is null
   group by s.id, e.full_name
   order by s.opened_at;
end $$;

-- Un turno concreto, abierto o ya cerrado. El cliente lo usa para el Corte X del turno
-- propio y para consultar un corte anterior. También exige PIN: un corte cerrado lleva
-- el conteo de efectivo y la diferencia, que es exactamente lo que no debe salir sin
-- que alguien se identifique.
create function public.shift_report(p_pin text, p_shift_id uuid)
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
         coalesce(sum(o.total) filter (where o.payment_method = 'cash'), 0),
         coalesce(sum(o.total) filter (where o.payment_method = 'card'), 0),
         coalesce(sum(o.total) filter (where o.payment_method = 'transfer'), 0),
         coalesce(sum(o.total), 0),
         count(o.id)::int,
         s.counted_cash, s.expected_cash, s.variance, s.note
    from public.shifts s
    join public.employees e on e.id = s.opened_by
    left join public.orders o
      on o.shift_id = s.id and o.status = 'completed'
   where s.id = p_shift_id
   group by s.id, e.full_name;
end $$;

-- =============================================================================
-- Órdenes
-- =============================================================================
-- El total se calcula AQUÍ, leyendo products.price. Se ignora por completo cualquier
-- precio que mande el cliente: es el cambio que cierra el hueco por el que hoy
-- cualquiera puede poner total = 0 en una orden.
--
-- p_items: [{ "product_id": "<uuid>", "quantity": 2, "notes": "sin cebolla" }]
--
-- El PIN no es un extra: shift_id por sí solo no acredita nada. orders es legible por
-- anon hasta la fase 3 y trae shift_id, así que un uuid ajeno se puede leer del propio
-- historial y luego usar aquí para vender en la gaveta de otro cajero. El PIN ata la
-- orden a quien realmente está en la gaveta.
--
-- p_customer_name va al final y con default: es un dato accesorio, y sin default
-- omitirlo desde PostgREST devolvía PGRST202, que es un error de cliente y no de
-- validación. Va después de p_items para que ese sí sea obligatorio.
create function public.create_order(
  p_pin          text,
  p_shift_id     uuid,
  p_table_number int,
  p_items        jsonb,
  p_customer_name text default null
)
returns table (order_id uuid, code bigint)
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_shift     uuid;
  v_employee  uuid;
  v_order     uuid;
  v_code      bigint;
  v_item      jsonb;
  v_line      record;
  v_product   record;
  v_qty       int;
  v_subtotal  numeric := 0;
  v_ids       uuid[];
begin
  -- jsonb_typeof primero: si el cliente manda un objeto en vez de un arreglo,
  -- jsonb_array_length aborta con "cannot get array length of a non-array", que es un
  -- mensaje de PostgreSQL que no le dice nada a quien está frente a la tablet.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La orden no tiene productos' using errcode = '22023';
  end if;
  if p_table_number is not null and p_table_number < 1 then
    raise exception 'El número de mesa no es válido' using errcode = '22023';
  end if;

  v_employee := public.auth_employee(p_pin);
  if v_employee is null then
    return;
  end if;

  select s.id into v_shift
    from public.shifts s
   where s.id = p_shift_id
     and s.closed_at is null
     and s.opened_by = v_employee
   for update;

  if v_shift is null then
    raise exception 'No hay una caja abierta. Abre tu turno en Caja antes de cobrar.' using errcode = 'P0001';
  end if;

  -- IDs en orden estable: dos cajas vendiendo los mismos productos a la vez los
  -- bloquean siempre en la misma secuencia y no pueden deadlockear entre ellas.
  select array_agg(distinct (i->>'product_id')::uuid order by (i->>'product_id')::uuid)
    into v_ids
    from jsonb_array_elements(p_items) i;

  -- FOR UPDATE en una sola sentencia bloquea todos los productos de la orden. Es lo
  -- que impide que dos cajas vendan la última unidad: la segunda espera y al despertar
  -- ve el stock ya descontado.
  for v_product in
    select p.id, p.name, p.price, p.tracks_stock, p.stock
      from public.products p
     where p.id = any(v_ids)
     for update
  loop
    null;
  end loop;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'quantity')::int, 0);
    if v_qty < 1 then
      raise exception 'Cantidad no válida' using errcode = '22023';
    end if;

    select p.id, p.name, p.price, p.tracks_stock, p.stock
      into v_product
      from public.products p
     where p.id = (v_item->>'product_id')::uuid;

    if not found then
      raise exception 'Uno de los productos ya no existe. Recarga la carta.' using errcode = 'P0001';
    end if;

    if v_product.tracks_stock and v_product.stock < v_qty then
      raise exception 'Sin stock de %: quedan %', v_product.name, v_product.stock using errcode = 'P0001';
    end if;

    v_subtotal := v_subtotal + v_product.price * v_qty;
  end loop;

  -- AS o: la función declara order_id como columna de salida y "id" se volvería
  -- ambiguo entre la variable, el record y las tablas del cuerpo.
  insert into public.orders as o (created_by, table_number, customer_name, subtotal, tax, total)
  values (v_employee, p_table_number, nullif(btrim(coalesce(p_customer_name, '')), ''),
          round(v_subtotal, 2), 0, round(v_subtotal, 2))
  returning o.id, o.code into v_order, v_code;

  -- v_line es un record y no el jsonb v_item: los campos del FOR se leen como
  -- v_line.pid, no como un campo del jsonb.
  for v_line in
    select i as raw, (i->>'product_id')::uuid as pid,
           coalesce((i->>'quantity')::int, 0) as qty
      from jsonb_array_elements(p_items) i
  loop
    insert into public.order_items (order_id, product_id, product_name, quantity, price, notes)
    select v_order, p.id, p.name, v_line.qty, p.price,
           nullif(btrim(coalesce(v_line.raw->>'notes', '')), '')
      from public.products p
     where p.id = v_line.pid;

    update public.products as p
       set stock = p.stock - v_line.qty
     where p.id = v_line.pid and p.tracks_stock;
  end loop;

  return query select v_order, v_code;
end $$;

-- Avanza la orden por el flujo de cocina. Rechaza saltos: no se puede pasar de pending
-- a ready, ni volver atrás.
create function public.advance_order(p_order_id uuid, p_to_status text)
returns text language plpgsql security definer
set search_path = public, extensions as $$
declare v_current text;
begin
  if p_to_status not in ('in_kitchen', 'ready', 'served') then
    raise exception 'Transición no válida' using errcode = '22023';
  end if;

  select o.status into v_current
    from public.orders o
   where o.id = p_order_id
   for update;

  if v_current is null then
    raise exception 'La orden no existe' using errcode = 'P0001';
  end if;

  if (p_to_status = 'in_kitchen' and v_current <> 'pending')
     or (p_to_status = 'ready' and v_current <> 'in_kitchen')
     or (p_to_status = 'served' and v_current <> 'ready') then
    raise exception 'No se puede pasar de % a %', v_current, p_to_status using errcode = 'P0001';
  end if;

  update public.orders set status = p_to_status where id = p_order_id;
  return p_to_status;
end $$;

-- Cobro. Es el momento en que el dinero entra a la gaveta, así que es aquí donde la
-- orden se asigna a un turno.
create function public.complete_order(
  p_order_id uuid, p_pin text, p_shift_id uuid, p_payment_method text)
returns text language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_current  text;
  v_employee uuid;
begin
  if p_payment_method not in ('cash', 'card', 'transfer') then
    raise exception 'Método de pago no válido' using errcode = '22023';
  end if;

  v_employee := public.auth_employee(p_pin);
  if v_employee is null then
    return null;
  end if;

  -- El turno tiene que ser el del cajero que está cobrando, no uno cualquiera que esté
  -- abierto: si no, el efectivo de esta venta cae en la gaveta de otro y su corte nunca
  -- lo refleja.
  perform 1 from public.shifts
   where id = p_shift_id and closed_at is null and opened_by = v_employee;
  if not found then
    raise exception 'No hay una caja abierta' using errcode = 'P0001';
  end if;

  select o.status into v_current
    from public.orders o
   where o.id = p_order_id
   for update;

  if v_current is null then
    raise exception 'La orden no existe' using errcode = 'P0001';
  end if;
  if v_current <> 'served' then
    raise exception 'Solo se cobra una orden servida (está en %)', v_current using errcode = 'P0001';
  end if;

  update public.orders set
    status         = 'completed',
    payment_method = p_payment_method,
    paid_at        = now(),
    shift_id       = p_shift_id
   where id = p_order_id;

  return 'completed';
end $$;

-- Anulación. El motivo es obligatorio siempre. Si la orden ya estaba cobrada, hace
-- falta además PIN de administrador: el dinero ya salió de la gaveta y ahí la
-- conversación es con el gerente, no con el turno.
--
-- completed SÍ se puede anular, con PIN de admin. Al pasar a 'cancelled' sale sola de
-- los totales del turno, porque close_shift, get_open_shifts y shift_report filtran por
-- status = 'completed': no hace falta lógica extra para que el dinero vuelva a cuadrar.
create function public.cancel_order(
  p_order_id uuid, p_reason text, p_admin_pin text default null)
returns text language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_order   record;
  v_vadmin  uuid;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Escribe el motivo de la anulación' using errcode = '22023';
  end if;

  select o.id, o.status, o.paid_at into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if v_order.id is null then
    raise exception 'La orden no existe' using errcode = 'P0001';
  end if;

  -- Anular algo ya anulado no aporta nada y dejaría dos marcas de la misma decisión.
  if v_order.status = 'cancelled' then
    raise exception 'Esa orden ya está anulada' using errcode = 'P0001';
  end if;

  if v_order.paid_at is not null then
    v_vadmin := public.auth_admin(p_admin_pin);
    if v_vadmin is null then
      return null;
    end if;
  end if;

  update public.orders set
    status      = 'cancelled',
    void_reason = btrim(p_reason),
    voided_at   = now()
   where id = p_order_id;

  -- Se devuelve el stock. on delete set null deja product_id en null si el producto
  -- fue borrado, y coalesce evita el no-match silencioso.
  update public.products p
     set stock = p.stock + coalesce(i.qty, 0)
    from (select product_id, sum(quantity)::int as qty
            from public.order_items
           where order_id = p_order_id
           group by product_id) i
    where p.id = i.product_id
      and p.tracks_stock;

  return 'cancelled';
end $$;

-- =============================================================================
-- Permisos
-- =============================================================================
-- shifts no se le da nada a anon: se accede solo por RPC. Que la llave viaje en el
-- bundle no significa que el cajero pueda leer la gaveta de otro por PostgREST.
revoke all on table public.shifts from anon, authenticated;

revoke all on function public.business_tz() from public, authenticated;
grant execute on function public.business_tz() to anon;

revoke all on function public.auth_employee(text, text) from public, anon, authenticated;

revoke all on function public.open_shift(text, numeric) from public, authenticated;
grant execute on function public.open_shift(text, numeric) to anon;
revoke all on function public.close_shift(text, numeric, text) from public, authenticated;
grant execute on function public.close_shift(text, numeric, text) to anon;
revoke all on function public.get_open_shifts(text) from public, authenticated;
grant execute on function public.get_open_shifts(text) to anon;
revoke all on function public.shift_report(text, uuid) from public, authenticated;
grant execute on function public.shift_report(text, uuid) to anon;
revoke all on function public.create_order(text, uuid, int, jsonb, text) from public, authenticated;
grant execute on function public.create_order(text, uuid, int, jsonb, text) to anon;
revoke all on function public.advance_order(uuid, text) from public, authenticated;
grant execute on function public.advance_order(uuid, text) to anon;
revoke all on function public.complete_order(uuid, text, uuid, text) from public, authenticated;
grant execute on function public.complete_order(uuid, text, uuid, text) to anon;
revoke all on function public.cancel_order(uuid, text, text) from public, authenticated;
grant execute on function public.cancel_order(uuid, text, text) to anon;
