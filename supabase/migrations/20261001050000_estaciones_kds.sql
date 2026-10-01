-- =============================================================================
-- Fase 8.1 — KDS por estación: estado y estación a nivel de renglón
-- =============================================================================
-- El KDS (/kitchen) ya existía y funcionaba: ruta propia, temporizador con alerta a
-- los 15 minutos, avance de estado en un toque y suscripción a Realtime sobre
-- `orders`. Lo que no podía hacer era separar cocina de barra, y no era cosa de la
-- interfaz: el estado vivía en la ORDEN, así que barra no tenía forma de decir "mi
-- bebida ya está" sin marcar también la hamburguesa.
--
-- El estado baja al renglón. Cada estación ve y mueve solo lo suyo, y el estado de
-- la orden pasa a ser el agregado de sus renglones. Nada más cambia: la orden sigue
-- siendo la que se cobra, la que aparece en el mapa de mesas y la que entra al corte.
--
-- `advance_order` se queda intacto para quien lo siga usando; el KDS usa la nueva
-- `advance_station_items`, que mueve renglones de una estación y recalcula el
-- agregado de la orden.
--
-- -----------------------------------------------------------------------------
-- Por qué `station` se COPIA al renglón en vez de resolverse con un join
-- -----------------------------------------------------------------------------
-- La tentación es no duplicar el dato: order_items ya tiene product_id y de ahí
-- sale la estación. El problema es la política de lectura de `products`:
--
--   products_anon_select_active  USING (is_active)
--
-- Si la estación se resuelve con un embed a products, desactivar un producto hace
-- que ese embed vuelva NULL y EL RENGLÓN DESAPAREZCA DEL KDS justo cuando más
-- importa verlo: alguien pidió algo y ahora está a medio preparar. La comanda ya no
-- lo tiene porque el producto se desactivó después de venderlo, y el cocinero se
-- queda sin saber qué falta.
--
-- Copiar la estación al vender congela la decisión de en qué estación se hizo ese
-- renglón. El costo es aceptado a propósito: mover un producto entre estaciones no
-- mueve renglones ya vendidos, y eso es lo correcto, porque la bebida se prepares
-- en barra aunque mañana el producto se mude a cocina.
--
-- -----------------------------------------------------------------------------
-- Por qué el estado de la orden NO retrocede si le agregan productos
-- -----------------------------------------------------------------------------
-- served, partially_paid y completed son estados de COBRO. Si a una cuenta que ya se
-- está cobrando le agregan una bebida, la bebida sí se prepara, pero la cuenta no
-- vuelve a 'in_kitchen': eso movería una orden ya cobrada en el mapa de mesas y en
-- el corte. El agregado solo se recalcula entre 'pending', 'in_kitchen' y 'ready'.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Estado y estación en el renglón
-- -----------------------------------------------------------------------------

alter table public.order_items
  add column status text not null default 'pending',
  add column station text not null default 'cocina';

alter table public.order_items
  add constraint order_items_status_check
    check (status in ('pending','in_progress','ready'));

alter table public.order_items
  add constraint order_items_station_check
    check (station in ('cocina','barra'));

-- -----------------------------------------------------------------------------
-- 2. Estación del producto, editable en Administración
-- -----------------------------------------------------------------------------
-- El valor por defecto NO sale de la categoría: la estación es una decisión de cómo
-- trabaja el restaurante (¿las bebidas las hace la barra o cocina? ¿las papas en
-- barra?) y cambia sin que cambie la carta. Se siembra por categoría una sola vez
-- y después se edita producto por producto en el panel de inventario.

alter table public.products
  add column station text not null default 'cocina';

alter table public.products
  add constraint products_station_check
    check (station in ('cocina','barra'));

update public.products set station = 'barra' where category in ('bebidas','extras');

-- -----------------------------------------------------------------------------
-- 3. Backfill
-- -----------------------------------------------------------------------------
-- Hoy no hay órdenes en producción, así que esto no mueve nada. Se deja igual para
-- que la migración sea correcta sobre una base con historia: antes el estado era de
-- la orden y se proyecta al renglón con la equivalencia directa.
--
-- El CASE no es cosmetico. Asignar directo o.status reventaba el CHECK en cuanto
-- hubiera una orden completed: el renglón solo admite pending, in_progress y ready, y
-- 'completed' es un estado de cobro que ya no existe a nivel de renglón. Anyadir la
-- columna con default y no backfillear tampoco servia, porque dejaba renglones en
-- 'pending' dentro de una orden cobrada, y eso es una tarjeta fantasma esperando a
-- que alguien la sirva dos veces.

update public.order_items oi
   set status = case o.status
                  when 'in_kitchen' then 'in_progress'
                  when 'ready'      then 'ready'
                  when 'served'     then 'ready'
                  when 'partially_paid' then 'ready'
                  when 'completed'  then 'ready'
                  else 'pending'
                end
  from public.orders o
 where o.id = oi.order_id;

update public.order_items oi
   set station = p.station
  from public.products p
 where p.id = oi.product_id
   and p.category in ('bebidas','extras');

-- -----------------------------------------------------------------------------
-- 4. Realtime sobre order_items
-- -----------------------------------------------------------------------------
-- El KDS se suscribía solo a `orders`. Marcar una bebida lista en barra actualiza
-- order_items y, si el total de la orden no cambia, `orders` ni se entera. El
-- tablero se quedaba igual hasta el siguiente evento.

alter publication supabase_realtime add table public.order_items;

-- =============================================================================
-- 5. create_order: la orden nace con renglones pendientes y con estación
-- =============================================================================

create or replace function public.create_order(
  p_pin             text,
  p_shift_id        uuid,
  p_table_number    integer,
  p_items           jsonb,
  p_customer_name   text default null,
  p_order_type      text default 'dine_in',
  p_platform        text default null,
  p_discount_amount numeric default 0,
  p_admin_pin       text default null
)
returns table (order_id uuid, code bigint)
language plpgsql volatile security definer
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
  v_before   numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La orden no tiene productos' using errcode = '22023';
  end if;
  if p_table_number is not null and p_table_number < 0 then
    raise exception 'El número de mesa no es válido' using errcode = '22023';
  end if;

  if p_order_type is null or p_order_type not in ('dine_in','takeout','platform') then
    raise exception 'Tipo de pedido no válido' using errcode = '22023';
  end if;
  if p_platform is not null and p_platform not in ('uber','rappi','didi') then
    raise exception 'Plataforma no válida' using errcode = '22023';
  end if;
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

  select array_agg(distinct (i->>'product_id')::uuid order by (i->>'product_id')::uuid)
    into v_ids
    from jsonb_array_elements(p_items) i;

  -- p.station entra al carrier: de ahí se copia al renglón. Bloquear sigue siendo
  -- por id ordenado, que es lo que evita el deadlock entre dos cajas.
  for v_product in
    select p.id, p.name, p.price, p.tracks_stock, p.stock, p.station
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

    select p.id, p.name, p.price, p.tracks_stock, p.stock, p.station
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
    insert into public.order_items (order_id, product_id, product_name, quantity, price, notes, status, station)
    select v_order, p.id, p.name, v_line.qty, p.price,
           nullif(btrim(coalesce(v_line.raw->>'notes', '')), ''),
           'pending', p.station
      from public.products p
     where p.id = v_line.pid;

    update public.products as p
       set stock = p.stock - v_line.qty
     where p.id = v_line.pid and p.tracks_stock
    returning stock into v_before;

    if found and v_before is not null then
      insert into public.stock_movements
        (product_id, delta, stock_before, stock_after, reason, kind, order_id, by_employee)
      values (
        v_line.pid, -v_line.qty, v_before + v_line.qty, v_before,
        'Venta #' || v_code, 'sale', v_order, v_employee
      );
    end if;
  end loop;

  return query select v_order, v_code;
end $$;

comment on function public.create_order(text, uuid, int, jsonb, text, text, text, numeric, text) is
  'Crea una orden completa. Rebaja stock y deja cada venta en stock_movements.';

-- =============================================================================
-- 6. append_order_items: los renglones agregados nacen pendientes
-- =============================================================================
-- Es lo que hace que agregar "y otra de papas" a una cuenta ya servida vuelva a
-- sonar en cocina: el renglón nuevo entra en 'pending' y el KDS lo muestra hasta que
-- esa estación lo marque listo. Los renglones anteriores NO se tocan, que es la
-- promesa de que el agregado es aditivo.

create or replace function public.append_order_items(
  p_pin      text,
  p_order_id uuid,
  p_items    jsonb
)
returns table (order_id uuid, code bigint, added numeric)
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_employee uuid;
  v_order    uuid;
  v_code     bigint;
  v_status   text;
  v_item     jsonb;
  v_line     record;
  v_product  record;
  v_qty      int;
  v_subtotal numeric := 0;
  v_ids      uuid[];
  v_before   numeric;
begin
  v_employee := public.auth_employee(p_pin);
  if v_employee is null then
    return;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'No hay productos para agregar' using errcode = '22023';
  end if;

  select o.id, o.code, o.status
    into v_order, v_code, v_status
    from public.orders o
   where o.id = p_order_id
     for update;

  if v_order is null then
    raise exception 'La cuenta ya no existe. Recarga el mapa de mesas.' using errcode = 'P0001';
  end if;

  if v_status not in ('pending','in_kitchen','ready','served','partially_paid') then
    raise exception 'Esa cuenta ya no admite productos' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.shifts s
     where s.opened_by = v_employee and s.closed_at is null
  ) then
    raise exception 'No hay una caja abierta. Abre tu turno en Caja antes de agregar productos.'
      using errcode = 'P0001';
  end if;

  select array_agg(distinct (i->>'product_id')::uuid order by (i->>'product_id')::uuid)
    into v_ids
    from jsonb_array_elements(p_items) i;

  for v_product in
    select p.id, p.name, p.price, p.tracks_stock, p.stock, p.station
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

    select p.id, p.name, p.price, p.tracks_stock, p.stock, p.station
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

  for v_line in
    select i as raw, (i->>'product_id')::uuid as pid,
           coalesce((i->>'quantity')::int, 0) as qty
      from jsonb_array_elements(p_items) i
  loop
    insert into public.order_items (order_id, product_id, product_name, quantity, price, notes, status, station)
    select v_order, p.id, p.name, v_line.qty, p.price,
           nullif(btrim(coalesce(v_line.raw->>'notes', '')), ''),
           'pending', p.station
      from public.products p
     where p.id = v_line.pid;

    update public.products as p
       set stock = p.stock - v_line.qty
     where p.id = v_line.pid and p.tracks_stock
    returning stock into v_before;

    if found and v_before is not null then
      insert into public.stock_movements
        (product_id, delta, stock_before, stock_after, reason, kind, order_id, by_employee)
      values (
        v_line.pid, -v_line.qty, v_before + v_line.qty, v_before,
        'Agregado a la venta #' || v_code, 'sale', v_order, v_employee
      );
    end if;
  end loop;

  update public.orders o
     set subtotal = round(o.subtotal + v_subtotal, 2),
         total    = round(o.total + v_subtotal, 2)
   where o.id = v_order;

  return query select v_order, v_code, round(v_subtotal, 2);
end $$;

comment on function public.append_order_items(text, uuid, jsonb) is
  'Agrega productos a una cuenta abierta. Solo suma: no modifica ni quita líneas existentes.';

-- =============================================================================
-- 7. advance_station_items: el KDS avanza por estación
-- =============================================================================
-- Un paso por llamada, como el botón del KDS: pending -> in_progress -> ready.
-- En 'ready' no hace nada, que es lo que permite al botón quedar deshabilitado en
-- lugar de tener que esconderse.
--
-- Devuelve el estado de la orden y cuántos renglones siguen sin terminar en TODAS
-- las estaciones, para que la tarjeta se actualice sin volver a leer la orden entera.

create or replace function public.advance_station_items(
  p_pin      text,
  p_order_id uuid,
  p_station  text
)
returns table (order_status text, remaining integer, changed integer)
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_employee uuid;
  v_order    uuid;
  v_status   text;
  v_row      record;
  v_remaining int;
  v_changed  int;
begin
  v_employee := public.auth_employee(p_pin);
  if v_employee is null then
    return;
  end if;

  if p_station is null or p_station not in ('cocina','barra') then
    raise exception 'Estación no válida' using errcode = '22023';
  end if;

  -- La orden se bloquea primero: dos estaciones avanzando a la vez se serializan y la
  -- segunda ve el agregado ya recalculado.
  select o.id, o.status into v_order, v_status
    from public.orders o
   where o.id = p_order_id
     for update;

  if v_order is null then
    raise exception 'La orden ya no existe' using errcode = 'P0001';
  end if;

  if v_status in ('completed','cancelled') then
    raise exception 'Esa orden ya no está en cocina' using errcode = 'P0001';
  end if;

  -- Los renglones se bloquean ORDENADOS por id, igual que los productos en
  -- create_order. Es la razón de que esta línea exista: dos estaciones que bloqueen
  -- los mismos renglones en distinto orden se pueden deadlockear entre ellas.
  for v_row in
    select oi.id
      from public.order_items oi
     where oi.order_id = p_order_id
       and oi.station = p_station
       and oi.status <> 'ready'
     order by oi.id
     for update
  loop
    null;
  end loop;

  update public.order_items oi
     set status = case oi.status when 'pending' then 'in_progress' else 'ready' end
   where oi.order_id = p_order_id
     and oi.station = p_station
     and oi.status <> 'ready';

  get diagnostics v_changed = row_count;

  -- El agregado cuenta renglones de TODAS las estaciones: la orden sale del tablero
  -- cuando ya no queda nada por hacer en ninguna parte, no cuando una de las dos
  -- terminó lo suyo.
  select count(*)::int into v_remaining
    from public.order_items oi
   where oi.order_id = p_order_id
     and oi.status <> 'ready';

  -- El agregado solo se mueve entre pending, in_kitchen y ready. Una cuenta servida
  -- o a medias no retrocede a cocina: son estados de cobro, y devolverlos movería la
  -- orden en el mapa de mesas y en el corte.
  --
  -- 'in_kitchen' significa que AL MENOS una estación ya empezó, no que todas. Si la
  -- orden se quedara en 'pending' mientras la plancha está trabajando, el mapa de mesas
  -- y la tarjeta del KDS la mostrarían como sin empezar.
  if v_remaining = 0 and v_status in ('pending','in_kitchen') then
    update public.orders o set status = 'ready' where o.id = p_order_id;
    v_status := 'ready';
  elsif v_remaining > 0 and v_status = 'pending'
        and exists (
          select 1 from public.order_items oi
           where oi.order_id = p_order_id and oi.status = 'in_progress'
        ) then
    update public.orders o set status = 'in_kitchen' where o.id = p_order_id;
    v_status := 'in_kitchen';
  elsif v_remaining > 0 and v_status = 'ready' then
    update public.orders o set status = 'in_kitchen' where o.id = p_order_id;
    v_status := 'in_kitchen';
  end if;

  return query select v_status, v_remaining, v_changed;
end $$;

comment on function public.advance_station_items(text, uuid, text) is
  'Avanza un paso los renglones de una estación y recalcula el estado agregado de la orden.';

-- =============================================================================
-- 8. Permisos
-- =============================================================================
-- Mismo patrón que el resto de RPC de escritura: accesible con la llave anónima, que
-- es la que viaja en la tablet, y con revalidación de PIN dentro. La llave anon no
-- alcanza por sí sola para escribir: sin un PIN válido no se toca nada.

revoke all on function public.advance_station_items(text, uuid, text) from public, authenticated;
grant execute on function public.advance_station_items(text, uuid, text) to anon;

revoke all on function public.create_order(text, uuid, int, jsonb, text, text, text, numeric, text)
  from public, authenticated;
grant execute on function public.create_order(text, uuid, int, jsonb, text, text, text, numeric, text) to anon;

revoke all on function public.append_order_items(text, uuid, jsonb) from public, authenticated;
grant execute on function public.append_order_items(text, uuid, jsonb) to anon;