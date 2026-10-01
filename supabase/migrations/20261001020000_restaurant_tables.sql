-- =============================================================================
-- Fase 7.2 — Mapa de mesas
-- =============================================================================
-- El local tiene una forma física que el software no conoce. El layout se guarda
-- en porcentaje (0-100) y no en píxeles para que se vea igual en una tablet de 8
-- que en una de 11.
--
-- Decisión de fondo: NO hay columna de estado en la mesa. El color se DERIVA de las
-- órdenes abiertas que la referencian. Una caché de "ocupada/libre" puede quedar
-- desincronizada de la verdad —que son las órdenes— y un mapa de mesas que miente
-- es peor que no tener mapa.
--
-- Las mesas virtuales (0 = Barra, 999 = Para llevar) existen en la misma tabla pero
-- se identifican por su número, sin columna aparte: un booleano redundante podría
-- contradecir al número y nadie sabría cuál manda.
-- =============================================================================

create table public.restaurant_tables (
  id          uuid primary key default gen_random_uuid(),
  number      int not null unique check (number >= 0),
  label       text not null default '',
  seats       int not null default 4 check (seats > 0),
  shape       text not null default 'square'
                check (shape in ('square','round','rect')),
  -- Porcentaje del lienzo, no píxeles: el layout se define una vez y escala solo.
  pos_x       numeric(5,2) not null default 50
                check (pos_x >= 0 and pos_x <= 100),
  pos_y       numeric(5,2) not null default 50
                check (pos_y >= 0 and pos_y <= 100),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.restaurant_tables is
  'Layout del salón. El estado (libre/ocupada/cuenta) se deriva de las órdenes abiertas, no se guarda.';
comment on column public.restaurant_tables.number is
  'Número de mesa. 0 = Barra y 999 = Para llevar son virtuales: no tienen posición en el lienzo.';
comment on column public.restaurant_tables.pos_x is
  'Posición horizontal en PORCENTAJE (0-100) del lienzo, para que se vea igual en cualquier tablet.';

create index restaurant_tables_active_idx on public.restaurant_tables (sort_order)
  where is_active;

-- ---------- updated_at ----------
create trigger restaurant_tables_touch before update on public.restaurant_tables
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Mesa 0 = Barra: hay que abrirle paso en orders
-- =============================================================================
-- El esquema nació con CHECK (table_number > 0) y create_order rechazaba cualquier
-- número menor que 1, porque antes "sin mesa" era NULL y no existía la barra como
-- destino de una orden. Con la barra siendo una mesa virtual numerada 0, ese
-- bloqueo impediría registrarla.
--
-- 0 pasa a ser un número de mesa válido. "Sin mesa" sigue siendo NULL: son dos
-- cosas distintas y no deben confmudirse.
alter table public.orders drop constraint orders_table_number_check;
alter table public.orders add constraint orders_table_number_check
  check (table_number is null or table_number >= 0);

create or replace function public.create_order(
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
  -- 0 es la barra, así que el mínimo válido pasa a ser 0. NULL sigue significando
  -- "sin mesa asignada".
  if p_table_number is not null and p_table_number < 0 then
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

  -- FOR UPDATE en una sola sentencia bloquea todos los productos de la orden.
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

  insert into public.orders as o (created_by, table_number, customer_name, subtotal, tax, total)
  values (v_employee, p_table_number, nullif(btrim(coalesce(p_customer_name, '')), ''),
          round(v_subtotal, 2), 0, round(v_subtotal, 2))
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

revoke all on function public.create_order(text, uuid, int, jsonb, text) from public, authenticated;
grant execute on function public.create_order(text, uuid, int, jsonb, text) to anon;

-- =============================================================================
-- Layout por defecto
-- =============================================================================
-- Si el admin no ha configurado nada, el mapa arranca con una distribución
-- razonable en vez de vacío. Es un punto de partida, no la verdad del local: el
-- admin la rearrange desde Administración y esto solo corre cuando la tabla está
-- vacía.
--
-- 0 = Barra (virtual, esquina superior izquierda) y 999 = Para llevar (virtual,
-- esquina superior derecha). Las 10 mesas físicas se colocan en una retícula 5x2.
insert into public.restaurant_tables (number, label, seats, shape, pos_x, pos_y, sort_order)
select 0, 'Barra', 0, 'rect', 0, 0, -2
where not exists (select 1 from public.restaurant_tables);

insert into public.restaurant_tables (number, label, seats, shape, pos_x, pos_y, sort_order)
select 999, 'Para llevar', 0, 'rect', 100, 0, -1
where not exists (select 1 from public.restaurant_tables where number = 999);

insert into public.restaurant_tables (number, label, seats, shape, pos_x, pos_y, sort_order)
select n, 'Mesa ' || n, 4, 'square',
       10 + ((n - 1) % 5) * 20,
       25 + ((n - 1) / 5) * 35,
       n
  from generate_series(1, 10) as n
 where not exists (select 1 from public.restaurant_tables where number = n);

-- =============================================================================
-- tables_status — el mapa, con el estado derivado de las órdenes
-- =============================================================================
-- No pide PIN: cualquiera que abra el mapa ya ve desde el salón qué mesas están
-- ocupadas. Pedirlo haría inútil el mapa justo para quien más lo necesita (el
-- mesero), y no expone nada que él no vea de todas formas al caminar entre mesas.
--
-- Precedencia del color: si hay alguna orden EN PROCESO, la mesa es roja aunque
-- también tenga órdenes servidas. Rojo significa "la cocina sigue trabajando";
-- amarillo (cuenta) solo cuando TODO lo de esa mesa ya está servido y lo que
-- falta es cobrar.
create or replace function public.tables_status()
returns table (
  table_id      uuid,
  number        int,
  label         text,
  seats         int,
  shape         text,
  pos_x         numeric,
  pos_y         numeric,
  sort_order    int,
  is_virtual    boolean,
  state         text,        -- 'free' | 'busy' | 'billing'
  open_orders   int,
  amount_due    numeric,
  customer_names text
)
language plpgsql volatile security definer
set search_path = public as $$
begin
  return query
  select t.id,
         t.number,
         nullif(btrim(t.label), ''),
         t.seats,
         t.shape,
         t.pos_x,
         t.pos_y,
         t.sort_order,
         (t.number in (0, 999)),
         case
           when count(*) filter (where o.status in ('pending','in_kitchen','ready')) > 0
             then 'busy'
           when count(*) filter (where o.status in ('served','partially_paid')) > 0
             then 'billing'
           else 'free'
         end,
         count(o.id)::int,
         coalesce(sum(o.total - coalesce(o.paid_total, 0))
                  filter (where o.status <> 'cancelled'), 0),
         nullif(string_agg(distinct coalesce(o.customer_name, ''), ', ')
                  filter (where o.customer_name is not null
                            and btrim(coalesce(o.customer_name, '')) <> ''
                            and o.status <> 'cancelled'), '')
    from public.restaurant_tables t
    left join public.orders o
      on o.table_number = t.number
     and o.status not in ('completed','cancelled')
   where t.is_active
   group by t.id
   order by t.sort_order, t.number;
end $$;

comment on function public.tables_status() is
  'Mapa de mesas con su estado derivado de las órdenes abiertas. Lectura sin PIN: no expone nada sensible.';

-- =============================================================================
-- save_table — editar el layout (solo admin)
-- =============================================================================
-- Crear, mover y desactivar mesas pasa por aquí. Borrar no: desactivar alcanza, y
-- una mesa con órdenes viejas no se puede borrar sin perder el historial.
--
-- p_number va antes que p_table_id a propósito: PostgreSQL no permite un parámetro
-- con default seguido de otro sin default. p_table_id llega al final y con default
-- null, que es como se crea una mesa nueva.
create or replace function public.save_table(
  p_admin_pin text,
  p_number int,
  p_table_id uuid default null,
  p_label text default null,
  p_seats int default 4,
  p_shape text default 'square',
  p_pos_x numeric default 50,
  p_pos_y numeric default 50,
  p_is_active boolean default true
)
returns uuid language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_admin uuid;
  v_id    uuid;
begin
  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return null;
  end if;

  if p_number is null or p_number < 0 or p_number > 999 then
    raise exception 'El número de mesa debe estar entre 0 y 999' using errcode = '22023';
  end if;
  if p_shape not in ('square','round','rect') then
    raise exception 'Forma no válida' using errcode = '22023';
  end if;
  if p_seats is null or p_seats < 0 then
    raise exception 'La capacidad no puede ser negativa' using errcode = '22023';
  end if;
  if p_pos_x < 0 or p_pos_x > 100 or p_pos_y < 0 or p_pos_y > 100 then
    raise exception 'La mesa se salió del salón' using errcode = '22023';
  end if;

  if p_table_id is null then
    insert into public.restaurant_tables (number, label, seats, shape, pos_x, pos_y, is_active)
    values (p_number, coalesce(nullif(btrim(p_label), ''), 'Mesa ' || p_number),
            p_seats, p_shape, p_pos_x, p_pos_y, p_is_active)
    returning id into v_id;
  else
    -- unique en number: si el número ya existe en otra mesa, revienta el INSERT con
    -- 23505. Se traduce a un mensaje que el admin entienda.
    update public.restaurant_tables
       set number = p_number,
           label = coalesce(nullif(btrim(p_label), ''), label),
           seats = p_seats,
           shape = p_shape,
           pos_x = p_pos_x,
           pos_y = p_pos_y,
           is_active = p_is_active
     where id = p_table_id
    returning id into v_id;

    if v_id is null then
      raise exception 'La mesa ya no existe' using errcode = 'P0001';
    end if;
  end if;

  return v_id;
end $$;

-- Mover una mesa sin reescribir todos sus datos: el arrastre manda una posición
-- cada pocos píxeles y mandar el objeto entero en cada movimiento sería traffic.
create or replace function public.move_table(
  p_admin_pin text, p_table_id uuid, p_pos_x numeric, p_pos_y numeric
)
returns uuid language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_admin uuid;
begin
  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return null;
  end if;
  if p_pos_x < 0 or p_pos_x > 100 or p_pos_y < 0 or p_pos_y > 100 then
    raise exception 'La mesa se salió del salón' using errcode = '22023';
  end if;

  update public.restaurant_tables
     set pos_x = p_pos_x, pos_y = p_pos_y
   where id = p_table_id
  returning id into v_admin;
  return v_admin;
end $$;

-- =============================================================================
-- Permisos
-- =============================================================================
-- El mapa se lee directo por anon (cualquiera puede ver el salón) y se edita solo
-- por RPC con PIN de admin. restaurants_tables no tiene INSERT/UPDATE para anon.
alter table public.restaurant_tables enable row level security;
grant select on public.restaurant_tables to anon;
create policy restaurant_tables_select on public.restaurant_tables
  for select to anon, authenticated using (true);
revoke insert, update, delete on table public.restaurant_tables from anon, authenticated;

revoke all on function public.tables_status() from public, authenticated;
grant execute on function public.tables_status() to anon;
revoke all on function public.save_table(text, int, uuid, text, int, text, numeric, numeric, boolean) from public, authenticated;
grant execute on function public.save_table(text, int, uuid, text, int, text, numeric, numeric, boolean) to anon;
revoke all on function public.move_table(text, uuid, numeric, numeric) from public, authenticated;
grant execute on function public.move_table(text, uuid, numeric, numeric) to anon;

-- Realtime: también entran las mesas, para que un cambio de layout se vea en
-- tablets abiertas sin recargar.
do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime'
                   and schemaname='public' and tablename='restaurant_tables') then
    alter publication supabase_realtime add table public.restaurant_tables;
  end if;
end $$;