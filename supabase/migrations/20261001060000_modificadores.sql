-- =============================================================================
-- Fase 8.2 — Modificadores: extras con costo que cuelgan del producto
-- =============================================================================
-- Las notas de preparación YA existían y funcionan: input por línea en el POS,
-- viaje a create_order y append_order_items, y salida envuelta en la comanda.
-- Lo que no existía era el catálogo de extras con precio.
--
-- Lo primero que se descartó fue reusar la categoría `extras` como productos
-- normales, que es lo que se hace en el POS físico: tocar "queso" y que aparezca
-- como otra línea. Funciona, pero arruina los reportes:
--
--   top_products agrupa por order_items y suma oi.price. Si el queso fuera un
--   producto, 200 hamburguesas con queso producirían 200 renglones de queso y el
--   ranking de productos más vendidos lo pondría al lado de las hamburguesas,
--   aunque nadie lo pidió solo. Y una mesa con tres hamburguesas con queso
--   generaría cuatro renglones en el corte.
--
-- Con modificadores el queso es una fila de order_item_modifiers colgando de su
-- hamburguesa: se cobra bien, se imprime en la comanda sin precio, y top_products
-- sigue hablando de hamburguesas.
--
-- Y sale gratis para los reportes que ya existen:
--
--   sales_summary suma order_payments.amount, que es el total real con extras: ya
--   cuadra sin tocarlo. top_products suma order_items.price, o sea solo producto
--   base: los extras no lo contaminan.
--
-- -----------------------------------------------------------------------------
-- name y price en order_item_modifiers son instantáneas, no referencias vivas
-- -----------------------------------------------------------------------------
-- Es el mismo criterio con el que order_items ya guarda product_name y price: si
-- mañana sube el queso de $15 a $18, el ticket que se cobró ayer tiene que seguir
-- diciendo $15. Un ticket reimpreso en una disputa que diga otra suma no sirve.
-- El modifier_id sí se guarda, para poder saber de dónde salió.
--
-- -----------------------------------------------------------------------------
-- product_modifier_groups existe para que el extra no aparezca donde no aplica
-- -----------------------------------------------------------------------------
-- "Extra tocino" en una Coca-Cola es un error de captura esperando a ocurrir, y es
-- el tipo de error que se descubre en el corte. La tabla dice qué grupos ofrece
-- cada producto, y create_order lo valida en el servidor: aunque el POS ofrezca
-- algo que no corresponde, la orden no se crea.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tablas
-- -----------------------------------------------------------------------------

create table public.modifier_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  -- min_select 0 = el grupo es opcional. Queda soportado para que un grupo
  -- obligatorio (el término de la carne) se pueda agregar después sin migrar.
  min_select  integer not null default 0 check (min_select >= 0),
  max_select  integer not null default 1 check (max_select >= 1),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  constraint modifier_groups_select_range check (max_select >= min_select)
);

create table public.modifiers (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.modifier_groups(id) on delete cascade,
  name        text not null,
  price       numeric(12,2) not null default 0 check (price >= 0),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  unique (group_id, name)
);

create index on public.modifiers(group_id);

create table public.product_modifier_groups (
  product_id  uuid not null references public.products(id) on delete cascade,
  group_id    uuid not null references public.modifier_groups(id) on delete cascade,
  primary key (product_id, group_id)
);

create index on public.product_modifier_groups(group_id);

create table public.order_item_modifiers (
  id             uuid primary key default gen_random_uuid(),
  order_item_id  uuid not null references public.order_items(id) on delete cascade,
  modifier_id    uuid not null references public.modifiers(id),
  -- Instantáneas: ver el encabezado. quantity va porque dos hamburguesas con queso
  -- son $30 de queso, y sin esto la fila no distinguiría una de otra.
  name           text not null,
  price          numeric(12,2) not null check (price >= 0),
  quantity       integer not null default 1 check (quantity >= 1),
  created_at     timestamptz not null default now()
);

create index on public.order_item_modifiers(order_item_id);
create index on public.order_item_modifiers(modifier_id);

-- -----------------------------------------------------------------------------
-- 2. RLS y políticas
-- -----------------------------------------------------------------------------
-- Lectura para anon y authenticated, como orders y order_items: la carta es
-- pública a propósito (el POS muestra la carta sin sesión) y el catálogo de extras
-- es parte de la carta.
--
-- Ninguna política de escritura en ninguna de las cuatro: se escriben por RPC con
-- PIN, igual que el resto. RLS activado sin política ya bloquea el INSERT.
--
-- order_payments es el contraejemplo a copiar para cash_expenses: es tabla de
-- dinero y no tiene ni una política, se lee por RPC.

alter table public.modifier_groups enable row level security;
alter table public.modifiers enable row level security;
alter table public.product_modifier_groups enable row level security;
alter table public.order_item_modifiers enable row level security;

create policy modifier_groups_select_for_reading on public.modifier_groups
  for select to anon, authenticated using (true);
create policy modifiers_select_for_reading on public.modifiers
  for select to anon, authenticated using (true);
create policy product_modifier_groups_select_for_reading on public.product_modifier_groups
  for select to anon, authenticated using (true);
create policy order_item_modifiers_select_for_reading on public.order_item_modifiers
  for select to anon, authenticated using (true);

-- -----------------------------------------------------------------------------
-- 3. Semilla
-- -----------------------------------------------------------------------------
-- Un solo grupo con cuatro extras de pago. Todo lo demás sigue siendo nota de
-- texto, que ya funciona: "sin cebolla", "término medio" y "salsa aparte" se
-- escriben en el campo que ya existía y salen en la comanda.
--
-- Se hace por nombre y no con uuid fijos para que la migración también sirva
-- sobre una base donde el grupo ya exista.

insert into public.modifier_groups (name, min_select, max_select, sort_order)
values ('Extras', 0, 4, 0);

insert into public.modifiers (group_id, name, price, sort_order)
select g.id, v.nombre, v.precio, v.ord
  from (values
    ('Extra queso',    15.00, 0),
    ('Extra tocino',   20.00, 1),
    ('Extra huevo',    10.00, 2),
    ('Extra jitomate',  8.00, 3)
  ) as v(nombre, precio, ord)
  join public.modifier_groups g on g.name = 'Extras';

-- Solo a lo que lleva carne. Las bebidas, el menú niños y los combos no ofrecen
-- extras de carne, y ofrecerlos sería una tentación de cobro que el servidor
-- rechaza con un error, que es peor que no ofrecerlos.
insert into public.product_modifier_groups (product_id, group_id)
select p.id, g.id
  from public.products p
  join public.modifier_groups g on g.name = 'Extras'
 where p.category in ('hamburguesas','burros','tacos');

-- =============================================================================
-- 4. product_modifier_catalog: una sola lectura para toda la carta
-- =============================================================================
-- El POS necesita, por producto, qué grupos ofrece y qué extras tiene cada uno.
-- Con un select anidado de tres niveles (products -> product_modifier_groups ->
-- modifier_groups -> modifiers) eso se paga en cada recarga de carta y devuelve
-- un jsonb grande que hay que aplanar en JS.
--
-- Una RPC que devuelve un arreglo plano y se cachea en el store es más barato y
-- más simple de mantener. El PIN es de EMPLEADO, no de administrador: el que
-- captura la orden es un mesero y el catálogo se necesita para trabajar, no para
-- administrar.

create or replace function public.product_modifier_catalog(p_pin text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions as $$
begin
  if public.auth_employee(p_pin) is null then
    return null;
  end if;

  return (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'group_id',   g.id,
        'name',       g.name,
        'min_select', g.min_select,
        'max_select', g.max_select,
        'modifiers',  (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id',    m.id,
            'name',  m.name,
            'price', m.price
          ) order by m.sort_order, m.name), '[]'::jsonb)
            from public.modifiers m
           where m.group_id = g.id and m.is_active
        ),
        'product_ids', (
          select coalesce(jsonb_agg(pmg.product_id), '[]'::jsonb)
            from public.product_modifier_groups pmg
           where pmg.group_id = g.id
        )
      ) order by g.sort_order, g.name
    ), '[]'::jsonb)
      from public.modifier_groups g
     where g.is_active
       and exists (
         select 1 from public.product_modifier_groups pmg where pmg.group_id = g.id
       )
  );
end $$;

comment on function public.product_modifier_catalog(text) is
  'Catálogo de modificadores por producto, en un solo arreglo plano. Valida PIN de empleado.';

-- =============================================================================
-- 5. RPC de administración del catálogo
-- =============================================================================

-- p_id va después de los obligatorios a propósito: en PostgreSQL un parámetro con
-- DEFAULT ya no puede estar seguido de uno sin DEFAULT. Por eso p_name y p_group_id
-- van segundos y el id, que solo se envía al editar, va al final de los obligatorios.
create or replace function public.save_modifier_group(
  p_pin        text,
  p_name       text,
  p_id         uuid default null,
  p_min_select integer default 0,
  p_max_select integer default 1,
  p_is_active  boolean default true,
  p_sort_order integer default 0
)
returns uuid
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_admin uuid;
  v_id    uuid;
  v_name  text;
begin
  if public.auth_admin(p_pin) is null then
    return null;
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'El grupo necesita nombre' using errcode = '22023';
  end if;

  if p_min_select < 0 or p_max_select < 1 or p_max_select < p_min_select then
    raise exception 'El rango de selección no es válido' using errcode = '22023';
  end if;

  insert into public.modifier_groups (name, min_select, max_select, is_active, sort_order)
  values (v_name, p_min_select, p_max_select, coalesce(p_is_active, true), coalesce(p_sort_order, 0))
  on conflict (id) do update
     set name        = excluded.name,
         min_select  = excluded.min_select,
         max_select  = excluded.max_select,
         is_active   = excluded.is_active,
         sort_order  = excluded.sort_order
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.save_modifier(
  p_pin        text,
  p_group_id   uuid,
  p_name       text,
  p_id         uuid default null,
  p_price      numeric default 0,
  p_is_active  boolean default true,
  p_sort_order integer default 0
)
returns uuid
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_admin uuid;
  v_id    uuid;
  v_name  text;
  v_price numeric;
begin
  if public.auth_admin(p_pin) is null then
    return null;
  end if;

  if p_group_id is null or not exists (select 1 from public.modifier_groups g where g.id = p_group_id) then
    raise exception 'El grupo del extra ya no existe' using errcode = '22023';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'El extra necesita nombre' using errcode = '22023';
  end if;

  v_price := round(coalesce(p_price, 0), 2);
  if v_price < 0 then
    raise exception 'El precio del extra no puede ser negativo' using errcode = '22023';
  end if;

  insert into public.modifiers (group_id, name, price, is_active, sort_order)
  values (p_group_id, v_name, v_price, coalesce(p_is_active, true), coalesce(p_sort_order, 0))
  on conflict (id) do update
     set group_id   = excluded.group_id,
         name       = excluded.name,
         price      = excluded.price,
         is_active  = excluded.is_active,
         sort_order = excluded.sort_order
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.set_product_modifier_groups(
  p_pin        text,
  p_product_id uuid,
  p_group_ids  uuid[]
)
returns void
language plpgsql volatile security definer
set search_path = public, extensions as $$
begin
  if public.auth_admin(p_pin) is null then
    return;
  end if;

  if not exists (select 1 from public.products p where p.id = p_product_id) then
    raise exception 'El producto ya no existe' using errcode = '22023';
  end if;

  -- Un grupo que ya no existe se ignora en vez de reventar: la pantalla manda lo que
  -- tiene cargado, y un grupo borrado a mitad de edición no puede dejar al
  -- administrador sin poder guardar el resto.
  delete from public.product_modifier_groups
   where product_id = p_product_id
     and group_id <> all (coalesce(p_group_ids, '{}'::uuid[]));

  insert into public.product_modifier_groups (product_id, group_id)
  select p_product_id, g.id
    from public.modifier_groups g
   where g.id = any (coalesce(p_group_ids, '{}'::uuid[]))
  on conflict do nothing;
end $$;

-- =============================================================================
-- 6. top_modifiers: cuánto se vendió de cada extra
-- =============================================================================
-- Con el modelo de delta de precio esta pregunta no tiene respuesta: el extra
-- sería texto dentro de una nota. Aquí es un conteo, y es el número que decide si
-- el queso vale $15 o $18.

create or replace function public.top_modifiers(
  p_admin_pin text,
  p_from      date,
  p_to        date default null,
  p_limit     integer default 5
)
returns table (rank integer, modifier_id uuid, modifier_name text, units numeric, revenue numeric)
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_admin uuid;
  v_today date;
  v_lo    timestamptz;
  v_hi    timestamptz;
begin
  if public.auth_admin(p_admin_pin) is null then
    return;
  end if;

  v_today := public.business_day(now());
  v_lo    := coalesce(p_from, v_today)::timestamp at time zone public.business_tz();
  v_hi    := (((coalesce(p_to, v_today) + 1)::timestamp at time zone public.business_tz())
              - interval '1 microsecond');

  return query
  select row_number() over (order by sum(oim.quantity * oi.quantity) desc)::int,
         oim.modifier_id,
         max(oim.name),
         sum(oim.quantity * oi.quantity)::numeric,
         round(sum(oim.quantity * oi.quantity * oim.price), 2)
    from public.order_item_modifiers oim
    join public.order_items oi on oi.id = oim.order_item_id
    join public.orders o       on o.id = oi.order_id
   where o.status = 'completed'
     and o.paid_at >= v_lo
     and o.paid_at <= v_hi
   group by oim.modifier_id
   order by sum(oim.quantity * oi.quantity) desc
   limit least(greatest(coalesce(p_limit, 5), 1), 50);
end $$;

-- =============================================================================
-- 7. create_order y append_order_items aceptan modificadores
-- =============================================================================
-- Cada elemento de p_items admite ahora:
--
--   { "product_id": "...", "quantity": 2, "notes": "",
--     "modifiers": [ { "modifier_id": "...", "quantity": 1 } ] }
--
-- El precio del extra es POR UNIDAD del renglón: dos hamburguesas con queso son
-- $30 de queso. Es la única lectura que hace sentido en un restaurante, y es la
-- que evita que "traiga dos con queso" salga a la mitad de precio.
--
-- El nombre y el precio salen del servidor, nunca del cliente: la comanda y el
-- ticket tienen que decir lo mismo que dice la carta.

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
  v_mod      jsonb;
  v_modr     record;
  v_product  record;
  v_qty      int;
  v_modqty   int;
  v_modunit  numeric := 0;
  v_item_id  uuid;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_total    numeric;
  v_ids      uuid[];
  v_mod_ids  uuid[];
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

  select array_agg(distinct (m->>'modifier_id')::uuid order by (m->>'modifier_id')::uuid)
    into v_mod_ids
    from jsonb_array_elements(p_items) i,
         jsonb_array_elements(coalesce(i->'modifiers', '[]'::jsonb)) m;

  -- Productos y modificadores se bloquean ORDENADOS por id, y en ese orden fijo.
  -- Dos cajas que bloqueen el mismo conjunto en distinto orden se pueden
  -- deadlockear entre ellas; es la razón de que estas dos líneas existan.
  for v_product in
    select p.id, p.name, p.price, p.tracks_stock, p.stock, p.station
      from public.products p
     where p.id = any(v_ids)
     for update
  loop
    null;
  end loop;

  for v_modr in
    select m.id
      from public.modifiers m
     where m.id = any(v_mod_ids)
     order by m.id
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

    -- Extras de este renglón. El precio se acumula POR UNIDAD y se multiplica por
    -- la cantidad del renglón al final del ciclo.
    v_modunit := 0;

    for v_mod in
      select * from jsonb_array_elements(coalesce(v_item->'modifiers', '[]'::jsonb))
    loop
      v_modqty := coalesce((v_mod->>'quantity')::int, 1);
      if v_modqty < 1 then
        raise exception 'Cantidad de extra no válida' using errcode = '22023';
      end if;

      select m.id, m.name, m.price, m.is_active, g.id as gid, g.is_active as g_active
        into v_modr
        from public.modifiers m
        join public.modifier_groups g on g.id = m.group_id
       where m.id = (v_mod->>'modifier_id')::uuid;

      if not found then
        raise exception 'Uno de los extras ya no existe. Recarga la carta.' using errcode = 'P0001';
      end if;

      if not v_modr.is_active or not v_modr.g_active then
        raise exception 'El extra % ya no se ofrece', v_modr.name using errcode = 'P0001';
      end if;

      -- El extra tiene que pertenecer a un grupo que el producto realmente ofrece.
      -- Sin esta validación el POS podría cobrar un extra de tocino en una Coca-Cola.
      if not exists (
        select 1 from public.product_modifier_groups pmg
         where pmg.product_id = v_product.id and pmg.group_id = v_modr.gid
      ) then
        raise exception '% no aplica a %', v_modr.name, v_product.name using errcode = 'P0001';
      end if;

      -- El tope del grupo se cuenta por unidades: dos hamburguesas con tres quesos
      -- son seis unidades de queso en esa línea.
      if v_modqty > (select g.max_select from public.modifier_groups g where g.id = v_modr.gid) then
        raise exception 'No se pueden pedir tantos %', v_modr.name using errcode = 'P0001';
      end if;

      v_modunit := v_modunit + v_modr.price * v_modqty;
    end loop;

    v_subtotal := v_subtotal + (v_product.price + v_modunit) * v_qty;
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
     where p.id = v_line.pid
    returning id into v_item_id;

    -- Instantáneas: name y price salen del catálogo en el momento de la venta.
    insert into public.order_item_modifiers (order_item_id, modifier_id, name, price, quantity)
    select v_item_id, m.id, m.name, m.price,
           greatest(coalesce((x->>'quantity')::int, 1), 1)
      from jsonb_array_elements(coalesce(v_line.raw->'modifiers', '[]'::jsonb)) x
      join public.modifiers m on m.id = (x->>'modifier_id')::uuid;

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
  'Crea una orden completa, con modificadores opcionales por renglón. Rebaja stock y deja cada venta en stock_movements.';

-- =============================================================================
-- 8. append_order_items con modificadores
-- =============================================================================
-- El agregado sigue siendo estrictamente aditivo: los renglones nuevos pueden
-- llevar extras, los anteriores no se tocan. El descuento tampoco se toca, y la
-- relación total = subtotal - descuento se conserva porque los dos suben lo mismo.

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
  v_mod      jsonb;
  v_modr     record;
  v_product  record;
  v_qty      int;
  v_modqty   int;
  v_modunit  numeric := 0;
  v_item_id  uuid;
  v_subtotal numeric := 0;
  v_ids      uuid[];
  v_mod_ids  uuid[];
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

  select array_agg(distinct (m->>'modifier_id')::uuid order by (m->>'modifier_id')::uuid)
    into v_mod_ids
    from jsonb_array_elements(p_items) i,
         jsonb_array_elements(coalesce(i->'modifiers', '[]'::jsonb)) m;

  for v_product in
    select p.id, p.name, p.price, p.tracks_stock, p.stock, p.station
      from public.products p
     where p.id = any(v_ids)
     for update
  loop
    null;
  end loop;

  for v_modr in
    select m.id
      from public.modifiers m
     where m.id = any(v_mod_ids)
     order by m.id
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

    v_modunit := 0;

    for v_mod in
      select * from jsonb_array_elements(coalesce(v_item->'modifiers', '[]'::jsonb))
    loop
      v_modqty := coalesce((v_mod->>'quantity')::int, 1);
      if v_modqty < 1 then
        raise exception 'Cantidad de extra no válida' using errcode = '22023';
      end if;

      select m.id, m.name, m.price, m.is_active, g.id as gid, g.is_active as g_active
        into v_modr
        from public.modifiers m
        join public.modifier_groups g on g.id = m.group_id
       where m.id = (v_mod->>'modifier_id')::uuid;

      if not found then
        raise exception 'Uno de los extras ya no existe. Recarga la carta.' using errcode = 'P0001';
      end if;

      if not v_modr.is_active or not v_modr.g_active then
        raise exception 'El extra % ya no se ofrece', v_modr.name using errcode = 'P0001';
      end if;

      if not exists (
        select 1 from public.product_modifier_groups pmg
         where pmg.product_id = v_product.id and pmg.group_id = v_modr.gid
      ) then
        raise exception '% no aplica a %', v_modr.name, v_product.name using errcode = 'P0001';
      end if;

      if v_modqty > (select g.max_select from public.modifier_groups g where g.id = v_modr.gid) then
        raise exception 'No se pueden pedir tantos %', v_modr.name using errcode = 'P0001';
      end if;

      v_modunit := v_modunit + v_modr.price * v_modqty;
    end loop;

    v_subtotal := v_subtotal + (v_product.price + v_modunit) * v_qty;
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
     where p.id = v_line.pid
    returning id into v_item_id;

    insert into public.order_item_modifiers (order_item_id, modifier_id, name, price, quantity)
    select v_item_id, m.id, m.name, m.price,
           greatest(coalesce((x->>'quantity')::int, 1), 1)
      from jsonb_array_elements(coalesce(v_line.raw->'modifiers', '[]'::jsonb)) x
      join public.modifiers m on m.id = (x->>'modifier_id')::uuid;

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
  'Agrega productos y extras a una cuenta abierta. Solo suma: no modifica ni quita líneas existentes.';

-- =============================================================================
-- 9. Permisos
-- =============================================================================
-- El catálogo se LEE con el PIN del empleado: es lo que necesita el POS para
-- trabajar, y no otorga ningún privilegio. Las tres de administración exigen PIN
-- de admin, igual que el resto del panel de Administración.

revoke all on function public.product_modifier_catalog(text) from public, authenticated;
grant execute on function public.product_modifier_catalog(text) to anon;

revoke all on function public.save_modifier_group(text, text, uuid, integer, integer, boolean, integer)
  from public, authenticated;
grant execute on function public.save_modifier_group(text, text, uuid, integer, integer, boolean, integer) to anon;

revoke all on function public.save_modifier(text, uuid, text, uuid, numeric, boolean, integer)
  from public, authenticated;
grant execute on function public.save_modifier(text, uuid, text, uuid, numeric, boolean, integer) to anon;

revoke all on function public.set_product_modifier_groups(text, uuid, uuid[]) from public, authenticated;
grant execute on function public.set_product_modifier_groups(text, uuid, uuid[]) to anon;

revoke all on function public.top_modifiers(text, date, date, integer) from public, authenticated;
grant execute on function public.top_modifiers(text, date, date, integer) to anon;

revoke all on function public.create_order(text, uuid, int, jsonb, text, text, text, numeric, text)
  from public, authenticated;
grant execute on function public.create_order(text, uuid, int, jsonb, text, text, text, numeric, text) to anon;

revoke all on function public.append_order_items(text, uuid, jsonb) from public, authenticated;
grant execute on function public.append_order_items(text, uuid, jsonb) to anon;