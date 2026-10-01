-- =============================================================================
-- Fix 7.5 — append_order_items: agregar productos a una cuenta ya abierta
-- =============================================================================
-- Hoy no hay forma de añadir productos a una orden que ya está en cocina:
-- order_items solo se inserta desde create_order, así que un cliente que dice
-- "y agrégame unas papas" obliga a cancelar y rehacer el pedido entero.
--
-- append_order_items resuelve eso, y es ESTRICTAMENTE aditivo a propósito: solo
-- agrega líneas nuevas. No sube cantidades de líneas existentes ni borra. Motivo:
-- la comanda que dispara lleva SOLO lo nuevo, para que el cocinero no rehaga lo
-- que ya tenía listo. Si el renglón de un agregado fuera ambiguo, la cocina
-- Cocina de más; y quitar productos exigiría devolver stock y dejar rastro, que es
-- un flujo distinto.
--
-- Qué NO hace, y por qué:
--
-- * No toca discount_amount. El descuento autorizado se mantiene tal cual y el total
--   sube por el mismo monto que el subtotal, así que la relación
--   total = subtotal - descuento se conserva. Agregar nunca autoriza un descuento.
--
-- * No exige turno abierto a la orden, solo al mesero que agrega (igual que
--   create_order). Agregar descuenta stock y mueve la venta del día, y eso tiene que
--   quedar atribuible a un turno.
--
-- * Acepta partially_paid a propósito. El saldo pendiente sube y el corte cuadra:
--   los reportes atribuyen por order_payments.paid_at, no por orders.shift_id, así
--   que lo agregado entra el día en que se cobra el resto, que es cuando el dinero
--   entra de verdad.
--
-- -----------------------------------------------------------------------------
-- FIX 7.5.b — create_order había perdido la bitácora de stock
-- -----------------------------------------------------------------------------
-- El create_order de 20260930260000 escribía cada venta en stock_movements con
-- kind 'sale' y motivo 'Venta #N'. Al reescribirlo en 20261001030000 para meter el
-- tipo de pedido y el descuento, ese INSERT se quedó atrás: la versión en producción
-- descuenta products.stock pero NO registra el movimiento.
--
-- El efecto es que el historial de inventario del panel de Administración muestra
-- compras, conteos, ajustes y anulaciones, pero ninguna venta: el stock baja sin que
-- nada explique por qué. Un inventario que se descuenta solo es exactamente el
-- inventario en el que no se puede confiar.
--
-- Acá se restaura. La firma de create_order NO cambia, así que es un CREATE OR
-- REPLACE normal: el POS sigue mandando los mismos nueve parámetros.
-- =============================================================================

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

  -- El descuento lo autoriza un ADMIN, no quien cobra.
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
     where p.id = v_line.pid and p.tracks_stock
    returning stock into v_before;

    -- La bitácora se escribe solo si el producto lleva control de stock. `found` es
    -- falso cuando el UPDATE no tocó filas, o sea cuando tracks_stock está apagado.
    -- El motivo 'Venta #N' lo exige el CHECK salida_exige_motivo: una salida de
    -- inventario siempre tiene que decir de dónde salió.
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
-- append_order_items
-- =============================================================================

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

  -- Se bloquea la orden primero. Así dos meseros agregando a la misma cuenta se
  -- serializan y el segundo ve el total ya actualizado en vez de pisarlo.
  select o.id, o.code, o.status
    into v_order, v_code, v_status
    from public.orders o
   where o.id = p_order_id
     for update;

  if v_order is null then
    raise exception 'La cuenta ya no existe. Recarga el mapa de mesas.' using errcode = 'P0001';
  end if;

  -- completed y cancelled quedan fuera: una cuenta cerrada no crece, y una anulada
  -- no puede volver a cocina.
  if v_status not in ('pending','in_kitchen','ready','served','partially_paid') then
    raise exception 'Esa cuenta ya no admite productos' using errcode = 'P0001';
  end if;

  -- Mismo requisito que create_order: quien agrega necesita su turno abierto.
  -- Agregar descuenta stock y mueve la venta del día, y eso tiene que quedar
  -- atribuible a un turno abierto. La orden puede venir de otro turno: el de quien
  -- agrega es el que importa.
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

  -- Los productos se bloquean ORDENADOS por uuid, igual que en create_order. Ese
  -- orden es la razón de que la línea exista: dos cajas que bloqueen los mismos
  -- productos en distinto orden se pueden deadlockear entre ellas.
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

  for v_line in
    select i as raw, (i->>'product_id')::uuid as pid,
           coalesce((i->>'quantity')::int, 0) as qty
      from jsonb_array_elements(p_items) i
  loop
    -- Nombre y precio salen del servidor, nunca del cliente: la comanda y el ticket
    -- tienen que decir lo mismo que dice la carta.
    insert into public.order_items (order_id, product_id, product_name, quantity, price, notes)
    select v_order, p.id, p.name, v_line.qty, p.price,
           nullif(btrim(coalesce(v_line.raw->>'notes', '')), '')
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

  -- El descuento NO se toca: subtotal y total suben lo mismo y la relación
  -- total = subtotal - descuento sigue dando lo mismo.
  update public.orders o
     set subtotal = round(o.subtotal + v_subtotal, 2),
         total    = round(o.total + v_subtotal, 2)
   where o.id = v_order;

  return query select v_order, v_code, round(v_subtotal, 2);
end $$;

comment on function public.append_order_items(text, uuid, jsonb) is
  'Agrega productos a una cuenta abierta. Solo suma: no modifica ni quita líneas existentes.';

-- =============================================================================
-- Permisos
-- =============================================================================
-- Mismo patrón que el resto de RPC de escritura: accesible con la llave anónima,
-- que es la que viaja en la tablet, y con revalidación de PIN dentro. La llave
-- anon no alcanza por sí sola para escribir: sin un PIN válido no se toca nada.
-- =============================================================================

revoke all on function public.append_order_items(text, uuid, jsonb) from public, authenticated;
grant execute on function public.append_order_items(text, uuid, jsonb) to anon;

revoke all on function public.create_order(text, uuid, int, jsonb, text, text, text, numeric, text)
  from public, authenticated;
grant execute on function public.create_order(text, uuid, int, jsonb, text, text, text, numeric, text) to anon;
