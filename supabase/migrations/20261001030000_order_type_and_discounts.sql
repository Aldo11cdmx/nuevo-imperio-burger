-- =============================================================================
-- Fase 7.4 — Tipo de pedido y descuentos autorizados
-- =============================================================================
-- Dos cosas que se guardan en la orden porque cambian lo que se cobra y quién la
-- entrega:
--
--   · order_type: en local / para llevar / domicilio. Distingue una mesa de un
--     pedido de Uber, y los reportes los separan.
--   · discount_amount: monto fijo, con motivo obligatorio y PIN de administrador.
--     Un porcentaje sobre $485 no da un número limpio; un monto fijo sí, y el
--     descuento se guarda YA aplicado a total.
--
-- El descuento se guarda aplicado, no se recalcula al vuelo. El total que se cobró
-- y se imprimió es el que queda, aunque después cambie la carta.
--
-- platform solo aplica a order_type='platform': un Uber no es un "Rap$i". El CHECK
-- lo hace explícito en la base para que no dependa de que el cliente se acuerde.
-- =============================================================================

-- ---------- tipo de pedido ----------
alter table public.orders
  add column order_type text not null default 'dine_in'
    check (order_type in ('dine_in','takeout','platform'));

alter table public.orders
  add column platform text
    check (platform is null or platform in ('uber','rappi','didi'));

-- Plataforma y tipo no pueden contradecirse.
alter table public.orders add constraint orders_platform_matches_type
  check (platform is null or order_type = 'platform');

-- ---------- descuento autorizado ----------
alter table public.orders
  add column discount_amount numeric(12,2) not null default 0
    check (discount_amount >= 0);

alter table public.orders
  add column discount_reason text;

alter table public.orders
  add column discount_by uuid references public.employees(id) on delete restrict;

-- Un descuento sin motivo o sin autor queda sin efecto. La regla vive en la BASE
-- y no en el cliente: si mañana alguien escribe en orders por SQL, el CHECK lo
-- frena igual.
alter table public.orders add constraint orders_discount_needs_authorization
  check (
    (discount_amount = 0 and discount_reason is null and discount_by is null)
    or (discount_amount > 0 and btrim(coalesce(discount_reason,'')) <> ''
        and discount_by is not null)
  );

comment on column public.orders.discount_amount is
  'Descuento ya aplicado al total. Exige motivo y autor (ver orders_discount_needs_authorization).';
comment on column public.orders.order_type is
  'dine_in = mesa, takeout = para llevar, platform = domicilio (Uber/Rappi/Didi).';

create index orders_channel_idx on public.orders (order_type, platform)
  where order_type = 'platform';

-- =============================================================================
-- create_order acepta tipo, plataforma y descuento
-- =============================================================================
-- Los parámetros nuevos van AL FINAL y con default, así el POS que manda solo los
-- cinco originales sigue funcionando sin tocarlo.
create or replace function public.create_order(
  p_pin           text,
  p_shift_id      uuid,
  p_table_number  int,
  p_items         jsonb,
  p_customer_name text default null,
  p_order_type    text default 'dine_in',
  p_platform      text default null,
  p_discount_amount numeric default 0,
  p_admin_pin     text default null
)
returns table (order_id uuid, code bigint)
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_shift    uuid;
  v_employee uuid;
  v_admin    uuid;
  v_order    uuid;
  v_code     bigint;
  v_item     jsonb;
  v_line     record;
  v_product  record;
  v_qty      int;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_total    numeric;
  v_ids      uuid[];
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La orden no tiene productos' using errcode = '22023';
  end if;
  -- 0 es la barra, así que el mínimo válido pasa a ser 0. NULL sigue siendo "sin mesa".
  if p_table_number is not null and p_table_number < 0 then
    raise exception 'El número de mesa no es válido' using errcode = '22023';
  end if;

  if p_order_type is null or p_order_type not in ('dine_in','takeout','platform') then
    raise exception 'Tipo de pedido no válido' using errcode = '22023';
  end if;
  if p_platform is not null and p_platform not in ('uber','rappi','didi') then
    raise exception 'Plataforma no válida' using errcode = '22023';
  end if;
  -- Mismo motivo que orders_platform_matches_type, validado antes de escribir para
  -- que el error sea de cliente y no una violación de restricción.
  if p_platform is not null and p_order_type <> 'platform' then
    raise exception 'Una plataforma solo aplica a pedidos a domicilio' using errcode = '22023';
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

  -- El descuento lo autoriza un ADMIN, no quien cobra. Sin esto el cajero podría
  -- aplicar descuentos con su propio PIN, que es justo lo que no debe pasar.
  v_discount := round(coalesce(p_discount_amount, 0), 2);
  if v_discount < 0 then
    raise exception 'El descuento no puede ser negativo' using errcode = '22023';
  end if;
  if v_discount > 0 then
    v_admin := public.auth_admin(p_admin_pin);
    if v_admin is null then
      raise exception 'El descuento requiere PIN de administrador' using errcode = 'P0001';
    end if;
  end if;

  -- IDs en orden estable: dos cajas vendiendo los mismos productos a la vez los
  -- bloquean siempre en la misma secuencia y no pueden deadlockear entre ellas.
  select array_agg(distinct (i->>'product_id')::uuid order by (i->>'product_id')::uuid)
    into v_ids
    from jsonb_array_elements(p_items) i;

  -- FOR UPDATE bloquea todos los productos de la orden: impide que dos cajas vendan
  -- la última unidad.
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

  -- El descuento no puede pasar del total: una orden de $75 con descuento de $100
  -- daría un total negativo, que el CHECK de orders rechazaría con un error técnico
  -- en vez de uno que el cajero entienda.
  if v_discount > v_subtotal then
    raise exception 'El descuento no puede ser mayor que el total ($%)', round(v_subtotal, 2)
      using errcode = '22023';
  end if;

  v_total := round(v_subtotal - v_discount, 2);

  insert into public.orders as o
    (created_by, table_number, customer_name, subtotal, tax, total,
     order_type, platform, discount_amount, discount_reason, discount_by)
  values (
    v_employee,
    p_table_number,
    nullif(btrim(coalesce(p_customer_name, '')), ''),
    round(v_subtotal, 2),
    0,
    v_total,
    p_order_type,
    p_platform,
    v_discount,
    case when v_discount > 0 then 'Descuento autorizado' else null end,
    case when v_discount > 0 then v_admin else null end
  )
  returning o.id, o.code into v_order, v_code;

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

-- =============================================================================
-- apply_discount — autorizar un descuento sobre una orden ya abierta
-- =============================================================================
-- Para el caso de que el descuento se pida después de mandar la orden a cocina.
--
-- NO se permite sobre una orden con pagos: en ese momento el dinero ya está en la
-- gaveta y el Corte Z ya lo contó. Tocar el total de una orden cobrada dejaría el
-- corte descuadrado contra el dinero real. La vía correcta es void_payment y volver
-- a cobrar.
create or replace function public.apply_discount(
  p_admin_pin text, p_order_id uuid, p_amount numeric, p_reason text
)
returns table (order_id uuid, subtotal numeric, discount_amount numeric, total numeric)
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_admin     uuid;
  v_subtotal  numeric;
  v_total     numeric;
  v_discount  numeric;
begin
  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return;
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'El descuento no puede ser negativo' using errcode = '22023';
  end if;
  if p_amount > 0 and btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Escribe el motivo del descuento' using errcode = '22023';
  end if;

  select coalesce(sum(oi.quantity * oi.price), 0) into v_subtotal
    from public.order_items oi
   where oi.order_id = p_order_id;

  if v_subtotal = 0 then
    raise exception 'La orden no existe o no tiene productos' using errcode = 'P0001';
  end if;

  if p_amount > v_subtotal then
    raise exception 'El descuento no puede ser mayor que el total ($%)', round(v_subtotal, 2)
      using errcode = '22023';
  end if;

  if exists (select 1 from public.orders o
              where o.id = p_order_id and coalesce(o.paid_total, 0) > 0) then
    raise exception 'La cuenta ya tiene pagos: revierte el cobro antes de descontar'
      using errcode = 'P0001';
  end if;

  v_discount := round(p_amount, 2);
  v_total := round(v_subtotal - v_discount, 2);

  update public.orders o
     set discount_amount = v_discount,
         discount_reason = case when v_discount > 0 then btrim(p_reason) else null end,
         discount_by = case when v_discount > 0 then v_admin else null end,
         total = v_total
   where o.id = p_order_id;

  return query select p_order_id, round(v_subtotal, 2), v_discount, v_total;
end $$;

-- =============================================================================
-- sales_by_channel — cuánto salió por cada canal
-- =============================================================================
-- Función NUEVA en vez de tocar sales_summary: agregar columnas a una función que
-- ya devuelve un record obliga a borrarla y recrearla, y eso rompería el panel de
-- reportes que hoy espera las nueve columnas actuales. Una función aparte deja el
-- reporte viejo intacto y este se suma al lado.
create or replace function public.sales_by_channel(
  p_admin_pin text, p_from date, p_to date default null
)
returns table (
  order_type   text,
  platform     text,
  tickets      int,
  total_sales  numeric,
  discount_total numeric
)
language plpgsql volatile security definer
set search_path = public as $$
declare
  v_today date;
  v_lo    timestamptz;
  v_hi    timestamptz;
begin
  if public.auth_admin(p_admin_pin) is null then
    return;
  end if;

  v_today := public.business_day(now());
  v_lo    := coalesce(p_from, v_today)::timestamp at time zone public.business_tz();
  v_hi    := ((coalesce(p_to, v_today) + 1)::timestamp at time zone public.business_tz())
             - interval '1 microsecond';

  return query
  select o.order_type,
         o.platform,
         count(*)::int,
         coalesce(sum(o.total), 0),
         coalesce(sum(o.discount_amount), 0)
    from public.orders o
   where o.status = 'completed'
     and o.paid_at >= v_lo
     and o.paid_at <= v_hi
   group by o.order_type, o.platform
   order by coalesce(sum(o.total), 0) desc;
end $$;

comment on function public.sales_by_channel(text, date, date) is
  'Ventas por canal (local, para llevar, Uber/Rappi/Didi). Complementa sales_summary, no lo reemplaza.';

-- =============================================================================
-- Permisos
-- =============================================================================
-- IMPORTANTE: agregar parámetros NO reemplaza la función, la SOBRECARGA. Con las
-- dos versiones conviviendo, la llamada de 5 argumentos del POS queda ambigua
-- (ERROR 42725 "function create_order(...) is not unique"). La de 5 se elimina:
-- la de 9 tiene todos los parámetros nuevos con default, así que sigue aceptando
-- exactamente la misma llamada que antes.
drop function if exists public.create_order(text, uuid, int, jsonb, text);

revoke all on function public.create_order(text, uuid, int, jsonb, text, text, text, numeric, text) from public, authenticated;
grant execute on function public.create_order(text, uuid, int, jsonb, text, text, text, numeric, text) to anon;
revoke all on function public.apply_discount(text, uuid, numeric, text) from public, authenticated;
grant execute on function public.apply_discount(text, uuid, numeric, text) to anon;
revoke all on function public.sales_by_channel(text, date, date) from public, authenticated;
grant execute on function public.sales_by_channel(text, date, date) to anon;