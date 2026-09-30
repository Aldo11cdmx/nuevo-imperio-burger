-- =============================================================================
-- Fase 1 — Catálogo en base de datos
-- =============================================================================
-- Mueve la carta de src/data/products.js a public.products. Es la condición para
-- que el CRUD de menú, el control de stock y el Top-5 de productos funcionen:
-- hasta ahora la carta era código estático y order_items solo guardaba el texto
-- del nombre, así que cualquier agregado de ventas tenía que resolverse por
-- coincidencia de texto.
--
-- Esta migración es ADITIVA: no toca ningún privilegio existente. El bloqueo de la
-- escritura directa sobre orders llega en una migración posterior, después de que
-- el cliente deje de insertar y actualizar tablas directamente.
-- =============================================================================

create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  name                text not null check (length(btrim(name)) > 0),
  price               numeric(12,2) not null check (price >= 0),
  category            text not null check (length(btrim(category)) > 0),
  is_active           boolean not null default true,
  tracks_stock        boolean not null default false,
  stock               int not null default 0 check (stock >= 0),
  low_stock_threshold int not null default 0 check (low_stock_threshold >= 0),
  image_url           text,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Un producto que no controla stock no puede quedar en negativo por error de captura.
  constraint products_stock_when_tracked check (not tracks_stock or stock >= 0)
);

comment on table public.products is
  'Carta del restaurante. El POS solo lee los productos is_active; el CRUD completo va por RPC con PIN de admin.';
comment on column public.products.slug is
  'Identificador legible y estable, para semillas idempotentes. No es la clave foránea: esa es id.';
comment on column public.products.tracks_stock is
  'true solo para producto Controlado (empaquetados y bebidas). Si es false, stock y low_stock_threshold se ignoran.';

create index products_active_sort_idx on public.products (is_active, sort_order);
create index products_category_idx on public.products (category);

create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- ---------- ordenes referencian el producto ----------
-- Nullable a propósito: las líneas de prueba que ya existen quedan en null y no
-- entran al Top-5. No se reescribe el histórico de venta para "arreglarlo".
alter table public.order_items
  add column product_id uuid references public.products(id) on delete set null;

create index order_items_product_idx on public.order_items (product_id)
  where product_id is not null;

-- ---------- semilla: la carta real ----------
insert into public.products (slug, name, price, category, sort_order, tracks_stock) values
  ('hamb-arrachera', 'Hamburguesa Arrachera', 95.00, 'hamburguesas', 0, false),
  ('hamb-bufalo', 'Hamburguesa Búfalo Chicken Burger', 85.00, 'hamburguesas', 1, false),
  ('hamb-camaron', 'Hamburguesa Camarón', 110.00, 'hamburguesas', 2, false),
  ('hamb-chipotle', 'Hamburguesa Chipotle Burger', 90.00, 'hamburguesas', 3, false),
  ('hamb-guacamole', 'Hamburguesa Guacamole Burger', 90.00, 'hamburguesas', 4, false),
  ('hamb-hawaiana', 'Hamburguesa Hawaiana', 85.00, 'hamburguesas', 5, false),
  ('hamb-hongo', 'Hamburguesa Hongo Burger', 90.00, 'hamburguesas', 6, false),
  ('hamb-monster', 'Hamburguesa Monster Burger', 135.00, 'hamburguesas', 7, false),
  ('hamb-nortec', 'Hamburguesa Nortec Burger', 85.00, 'hamburguesas', 8, false),
  ('hamb-sencilla', 'Hamburguesa Sencilla', 75.00, 'hamburguesas', 9, false),
  ('hamb-suiza', 'Hamburguesa Suiza', 90.00, 'hamburguesas', 10, false),
  ('hamb-texas', 'Hamburguesa Texas Burger', 85.00, 'hamburguesas', 11, false),
  ('burro-arrachera', 'Burro Arrachera', 90.00, 'burros', 1012, false),
  ('burro-bistec', 'Burro Bistec', 80.00, 'burros', 1013, false),
  ('burro-campechano', 'Burro Campechano', 80.00, 'burros', 1014, false),
  ('burro-enchilada', 'Burro de Enchilada', 80.00, 'burros', 1015, false),
  ('burro-hawaiano', 'Burro Hawaiano', 80.00, 'burros', 1016, false),
  ('burro-pastor', 'Burro Pastor', 80.00, 'burros', 1017, false),
  ('burro-pollo', 'Burro Pollo', 80.00, 'burros', 1018, false),
  ('burro-texano', 'Burro Texano', 80.00, 'burros', 1019, false),
  ('carne-enchilada', 'Carne Enchilada', 80.00, 'burros', 1020, false),
  ('alitas', 'Alitas', 65.00, 'snacks', 2021, false),
  ('aros-cebolla', 'Aros de Cebolla', 50.00, 'snacks', 2022, false),
  ('boneless', 'Boneless', 80.00, 'snacks', 2023, false),
  ('club-sandwich', 'Club Sándwich', 65.00, 'snacks', 2024, false),
  ('costillas', 'Costillas', 85.00, 'snacks', 2025, false),
  ('ensalada-imperial', 'Ensalada Imperial', 75.00, 'snacks', 2026, false),
  ('nachos-chilli', 'Nachos Chilli', 60.00, 'snacks', 2027, false),
  ('papas-francesas', 'Papas Francesas', 50.00, 'snacks', 2028, false),
  ('papas-gajo', 'Papas Gajo', 50.00, 'snacks', 2029, false),
  ('poutine', 'Poutine', 85.00, 'snacks', 2030, false),
  ('carnita-asada', 'Carnita Asada', 85.00, 'antojitos', 3031, false),
  ('chilaquiles', 'Chilaquiles', 65.00, 'antojitos', 3032, false),
  ('enchiladas-casa', 'Enchiladas de la Casa', 75.00, 'antojitos', 3033, false),
  ('enchiladas-suizas', 'Enchiladas Suizas', 80.00, 'antojitos', 3034, false),
  ('taco-arrachera', 'Taco Arrachera', 33.00, 'tacos', 4035, false),
  ('taco-bistec', 'Taco Bistec', 30.00, 'tacos', 4036, false),
  ('taco-campechano', 'Taco Campechano', 30.00, 'tacos', 4037, false),
  ('taco-longaniza', 'Taco Longaniza', 30.00, 'tacos', 4038, false),
  ('taco-pastor', 'Taco Pastor', 30.00, 'tacos', 4039, false),
  ('combo-alitas', 'Alitas c/Papas+Soda', 65.00, 'combos', 5040, false),
  ('combo-chilaquiles', 'Chilaquiles c/Bistec+Soda', 60.00, 'combos', 5041, false),
  ('combo-club', 'Club Sándwich+Papas+Soda', 60.00, 'combos', 5042, false),
  ('combo-familiar', 'Combo Familiar', 260.00, 'combos', 5043, false),
  ('combo-nuevo', 'Combo Nuevo', 290.00, 'combos', 5044, false),
  ('combo-gante', 'Hamburguesa Gante+Papas+Soda', 80.00, 'combos', 5045, false),
  ('combo-urburger', 'Urburger+Papas+Soda', 50.00, 'combos', 5046, false),
  ('combo-papas-refresco', 'Papas Francesa+Refresco', 45.00, 'combos', 5047, false),
  ('malteadas', 'Malteadas', 40.00, 'bebidas', 6048, true),
  ('boing', 'Boing', 25.00, 'bebidas', 6049, true),
  ('coca-cola', 'Coca Cola', 25.00, 'bebidas', 6050, true),
  ('coca-cola-media', 'Coca-cola 1/2', 30.00, 'bebidas', 6051, true),
  ('limonada-nieve', 'Limonada con Nieve', 30.00, 'bebidas', 6052, true),
  ('manzanita', 'Manzanita Deliciosa', 15.00, 'bebidas', 6053, true),
  ('sangria', 'Sangria Preparada', 30.00, 'bebidas', 6054, true),
  ('sprite', 'Sprite', 20.00, 'bebidas', 6055, true),
  ('vaso-agua', 'Vaso de Agua', 15.00, 'bebidas', 6056, true),
  ('bolitas-pollo', 'Bolitas de Pollo', 45.00, 'ninos', 7057, false),
  ('mini-burguer', 'Mini Burguer', 45.00, 'ninos', 7058, false),
  ('sincronizada', 'Sincronizada', 45.00, 'ninos', 7059, false),
  ('extra-10', 'Extra 10', 10.00, 'extras', 8060, false),
  ('extra-5', 'Extra 5', 5.00, 'extras', 8061, false),
  ('pina', 'Piña', 10.00, 'extras', 8062, false),
  ('queso', 'Queso', 5.00, 'extras', 8063, false),
  ('tocino', 'Tocino', 10.00, 'extras', 8064, false)
on conflict (slug) do nothing;

-- Conteo inicial PROVISIONAL de las bebidas. Es un número inventado a propósito para
-- que el POS no arranque con todas las bebidas agotadas y la función se pueda probar
-- de inmediato. Hay que corregirlo en Admin > Inventario con el conteo real antes de
-- abrir al público.
update public.products set stock = 50, low_stock_threshold = 10 where tracks_stock;

-- ---------- RLS: el POS solo lee lo que está activo ----------
alter table public.products enable row level security;
revoke all on table public.products from anon, authenticated;
grant select on table public.products to anon;

create policy products_anon_select_active on public.products
  for select to anon using (is_active);

-- El POS lee en vivo para que el stock de una tablet se refleje en las demás.
do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime'
                   and schemaname='public' and tablename='products') then
    alter publication supabase_realtime add table public.products;
  end if;
end $$;

-- =============================================================================
-- Gestión de catálogo (PIN de administrador)
-- =============================================================================
-- El plan preveía cuatro funciones (upsert_product, set_product_active,
-- set_stock_tracking, adjust_stock). Se consolidan en tres porque save_product ya
-- cubre is_active y tracks_stock, y mantener funciones separadas que escriben las
-- mismas columnas solo multiplica la superficie que hay que auditar.
--
-- save_product recibe el producto entero como jsonb: son nueve campos y una función
-- con nueve parámetros posicionales es fácil de llamar mal.

-- Slug legible a partir del nombre. No es perfecto pero es estable y único; el
-- sufijo aleatorio desempata nombres repetidos sin preguntar por un unicador.
create function public.slugify(p_text text)
returns text language sql immutable
set search_path = public as $$
  select coalesce(nullif(btrim(
    lower(regexp_replace(p_text, '[^a-z0-9]+', '-', 'g'))
  ), '-'), 'producto') || '-' || substr(md5(random()::text), 1, 6)
$$;

create function public.save_product(p_admin_pin text, p_product jsonb)
returns uuid language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_admin uuid;
  v_id    uuid;
  v_name  text;
begin
  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return null;
  end if;

  v_name := btrim(coalesce(p_product->>'name', ''));
  if length(v_name) = 0 then
    raise exception 'El nombre es obligatorio' using errcode = '22023';
  end if;
  if coalesce((p_product->>'price')::numeric, -1) < 0 then
    raise exception 'El precio no puede ser negativo' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_product->>'category', ''))) = 0 then
    raise exception 'La categoría es obligatoria' using errcode = '22023';
  end if;
  if coalesce((p_product->>'low_stock_threshold')::int, 0) < 0 then
    raise exception 'El umbral no puede ser negativo' using errcode = '22023';
  end if;

  perform public.rate_limit_clear();

  v_id := nullif(p_product->>'id', '')::uuid;

  if v_id is null then
    insert into public.products (
      slug, name, price, category, is_active, tracks_stock,
      stock, low_stock_threshold, image_url, sort_order
    ) values (
      public.slugify(v_name),
      v_name,
      (p_product->>'price')::numeric,
      btrim(p_product->>'category'),
      coalesce((p_product->>'is_active')::boolean, true),
      coalesce((p_product->>'tracks_stock')::boolean, false),
      greatest(coalesce((p_product->>'stock')::int, 0), 0),
      coalesce((p_product->>'low_stock_threshold')::int, 0),
      nullif(btrim(coalesce(p_product->>'image_url', '')), ''),
      coalesce((p_product->>'sort_order')::int, 0)
    ) returning id into v_id;
  else
    -- El stock solo se toca si viene explícito: un rename desde el menú no debe
    -- resetear el inventario. Por eso coalesce(..., stock) y no el valor del jsonb.
    update public.products set
      name                = v_name,
      price               = (p_product->>'price')::numeric,
      category            = btrim(p_product->>'category'),
      is_active           = coalesce((p_product->>'is_active')::boolean, is_active),
      tracks_stock        = coalesce((p_product->>'tracks_stock')::boolean, tracks_stock),
      stock               = coalesce((p_product->>'stock')::int, stock),
      low_stock_threshold = coalesce((p_product->>'low_stock_threshold')::int, low_stock_threshold),
      image_url           = nullif(btrim(coalesce(p_product->>'image_url', image_url)), ''),
      sort_order          = coalesce((p_product->>'sort_order')::int, sort_order)
    where id = v_id;
    if not found then
      raise exception 'El producto no existe' using errcode = '22023';
    end if;
  end if;

  return v_id;
end $$;

-- Listing completo para la pantalla de Admin: incluye los inactivos, que la política
-- de SELECT esconde al POS a propósito.
create function public.list_all_products(p_admin_pin text)
returns table (
  id                  uuid,
  slug                text,
  name                text,
  price               numeric,
  category            text,
  is_active           boolean,
  tracks_stock        boolean,
  stock               int,
  low_stock_threshold int,
  image_url           text,
  sort_order          int
)
language plpgsql security definer
set search_path = public, extensions as $$
declare v_admin uuid;
begin
  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return;   -- sin filas: el cliente lo interpreta como autorización fallida
  end if;
  perform public.rate_limit_clear();
  return query
    select p.id, p.slug, p.name, p.price, p.category, p.is_active,
           p.tracks_stock, p.stock, p.low_stock_threshold, p.image_url, p.sort_order
      from public.products p
     order by p.category, p.sort_order, p.name;
end $$;

-- Ajuste por delta para los botones rápidos (+10, merma de -1) y el conteo físico.
-- Es un incremento atómico dentro de la función, no un read-modify-write del cliente:
-- dos tablets restando a la vez no pueden pisarse.
create function public.adjust_stock(
  p_admin_pin text, p_product_id uuid, p_delta int, p_reason text default null)
returns int language plpgsql security definer
set search_path = public, extensions as $$
declare v_admin uuid; v_stock int;
begin
  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return null;
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'El ajuste no puede ser cero' using errcode = '22023';
  end if;

  perform public.rate_limit_clear();

  update public.products
     set stock = greatest(stock + p_delta, 0)
   where id = p_product_id
  returning stock into v_stock;

  if v_stock is null then
    raise exception 'El producto no existe' using errcode = '22023';
  end if;
  return v_stock;
end $$;

-- ---------- permisos de función ----------
-- Postgres otorga EXECUTE a PUBLIC por defecto: revocar de PUBLIC es obligatorio.
revoke all on function public.slugify(text) from public, authenticated;
grant execute on function public.slugify(text) to anon;

revoke all on function public.save_product(text, jsonb) from public, authenticated;
grant execute on function public.save_product(text, jsonb) to anon;
revoke all on function public.list_all_products(text) from public, authenticated;
grant execute on function public.list_all_products(text) to anon;
revoke all on function public.adjust_stock(text, uuid, int, text) from public, authenticated;
grant execute on function public.adjust_stock(text, uuid, int, text) to anon;
