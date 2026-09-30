-- =============================================================================
-- Fase 4 (parte 1) — Bitácora de movimientos de stock
-- =============================================================================
-- El stock bajaba y subía sin dejar rastro. adjust_stock recibía p_reason y lo
-- descartaba; save_product pisaba stock sin preguntar por qué. Con nueve productos
-- controlando inventario, "el stock no cuadra con el refri" no tenía forma de
-- investigarse: solo quedaba la cifra actual, sin historial.
--
-- La bitácora guarda el antes y el después. Sin el antes no se puede saber si un
-- conteo de 40 fue una compra, una merma de 10 o un decremento a ciegas.
-- =============================================================================

create table public.stock_movements (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  -- delta negativo = salida, positivo = entrada.
  delta        integer not null,
  stock_before integer not null,
  stock_after  integer not null,
  -- Por qué pasó. Obligatorio cuando el movimiento es una salida: cada unidad que
  -- falta tiene que tener una explicación (merma, robo, error de captura).
  reason       text,
  -- sale: lo descontó create_order. void: lo devolvió cancel_order.
  -- purchase: entrada de mercancía. count: conteo físico, que fija el número real.
  -- waste: merma.
  kind         text not null check (kind in ('sale','void','purchase','count','waste')),
  -- Se llena solo en sale/void para poder cruzar el movimiento con su ticket.
  order_id     uuid references public.orders(id) on delete set null,
  by_employee  uuid references public.employees(id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.stock_movements is
  'Bitácora de cada cambio en existencias. Con delta, antes y después, se puede reconstruir por qué el stock llegó al número que tiene.';
comment on column public.stock_movements.reason is
  'Motivo. Obligatorio en salidas: una unidad que falta tiene que tener explicación.';

-- El índice es por producto y fecha descendente: la consulta de la UI siempre es
-- "los últimos movimientos de este producto".
create index stock_movements_product_created_idx
  on public.stock_movements (product_id, created_at desc);
create index stock_movements_order_idx
  on public.stock_movements (order_id)
  where order_id is not null;
create index stock_movements_kind_created_idx
  on public.stock_movements (kind, created_at desc);

-- El movimiento con salida sin motivo no sirve para nada. La regla vive en la base
-- para que no dependa de que el cliente la recuerde.
--
-- PostgreSQL no tiene CREATE CONSTRAINT: los CHECK se agregan con ALTER TABLE.
alter table public.stock_movements
  add constraint stock_movements_salida_exige_motivo
  check (delta >= 0 or btrim(coalesce(reason, '')) <> '');

-- No se guarda un movimiento que no movió nada: sería ruido en la bitácora y
-- desorienta al leerla ("¿por qué hay un conteo de 0 unidades?").
alter table public.stock_movements
  add constraint stock_movements_delta_no_cero
  check (delta <> 0);

-- RLS sin políticas: nadie lee ni escribe por PostgREST. El acceso es por RPC, igual
-- que shifts.
alter table public.stock_movements enable row level security;
revoke all on table public.stock_movements from anon, authenticated;

-- =============================================================================
-- adjust_stock: ahora deja rastro y no trunca en silencio
-- =============================================================================
-- Dos arreglos sobre la versión anterior:
--
-- 1. greatest(stock + p_delta, 0) ocultaba el error. Si el sistema decía 5 y el
--    gerente registraba una merma de 8, el stock se quedaba en 0 y la bitácora
--    guardaba un delta de -5: el número ya no cuadraba con lo que se quiso
--    descontar. Ahora se rechaza, para que el contador sea el número real.
--
-- 2. p_reason era obligatorio en la firma y se ignoraba. Una salida sin motivo no
--    puede guardarse (lo bloquea el CHECK de arriba), y la UI la pide antes.
create or replace function public.adjust_stock(
  p_admin_pin text, p_product_id uuid, p_delta integer, p_reason text default null)
returns integer language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_admin  uuid;
  v_before integer;
  v_after  integer;
  v_reason text;
begin
  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return null;
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'El ajuste no puede ser cero' using errcode = '22023';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  -- Toda salida necesita motivo. Se valida aquí para devolver el error en español
  -- que entiende el usuario, en vez de dejar que reviente el CHECK con un mensaje
  -- interno de PostgreSQL.
  if p_delta < 0 and v_reason is null then
    raise exception 'Escribe el motivo por el que baja el stock' using errcode = '22023';
  end if;

  perform public.rate_limit_clear();

  select stock into v_before
    from public.products
   where id = p_product_id
     for update;

  if v_before is null then
    raise exception 'El producto no existe' using errcode = '22023';
  end if;

  v_after := v_before + p_delta;
  if v_after < 0 then
    raise exception 'No puedes descontar más de lo que hay: quedan %', v_before using errcode = '22023';
  end if;

  update public.products set stock = v_after where id = p_product_id;

  insert into public.stock_movements
    (product_id, delta, stock_before, stock_after, reason, kind, by_employee)
  values (
    p_product_id, p_delta, v_before, v_after, v_reason,
    case when p_delta > 0 then 'purchase' else 'waste' end,
    v_admin
  );

  return v_after;
end $$;

-- =============================================================================
-- set_stock: conteo físico
-- =============================================================================
-- Ajustar por delta y contar son cosas distintas. El conteo físico dice "hay 40 en el
-- refri", que no es "hay 10 más". Con delta habría que calcular la diferencia a mano y
-- un error de dedo se convierte en una merma fantasma de 200 unidades.
--
-- Fija el número absoluto y guarda la diferencia real como delta, que es lo que hace
-- legible la bitácora.
create or replace function public.set_stock(
  p_admin_pin text, p_product_id uuid, p_counted integer, p_reason text default null)
returns integer language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_admin   uuid;
  v_before  integer;
  v_counted integer;
  v_reason  text;
begin
  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return null;
  end if;

  if p_counted is null or p_counted < 0 then
    raise exception 'La cantidad contada no puede ser negativa' using errcode = '22023';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  perform public.rate_limit_clear();

  select stock into v_before
    from public.products
   where id = p_product_id
     for update;

  if v_before is null then
    raise exception 'El producto no existe' using errcode = '22023';
  end if;

  -- Sin cambio no hay movimiento que registrar. Un conteo que confirma el número
  -- sigue siendo información, pero no un movimiento de inventario.
  if v_before = p_counted then
    return v_before;
  end if;

  if p_counted < v_before and v_reason is null then
    raise exception 'El conteo bajó: escribe por qué faltaban unidades' using errcode = '22023';
  end if;

  update public.products set stock = p_counted where id = p_product_id;

  insert into public.stock_movements
    (product_id, delta, stock_before, stock_after, reason, kind, by_employee)
  values (
    p_product_id, p_counted - v_before, v_before, p_counted, v_reason, 'count', v_admin
  );

  return p_counted;
end $$;

-- =============================================================================
-- Lectura del historial
-- =============================================================================
-- Exige PIN de admin: el historial de mermas y robos es información que no debe
-- estar en el bundle. Es la misma regla que auth_admin no es ejecutable por anon.
--
-- VOLATILE, no stable: auth_admin escribe en pin_rate_limits al validar el PIN, y
-- PostgreSQL rechaza escrituras dentro de una función stable. Da
-- "cannot execute DELETE in a read-only transaction" (25006). Verificado.
create or replace function public.stock_history(
  p_admin_pin text, p_product_id uuid, p_limit int default 30)
returns table (
  id           uuid,
  product_id   uuid,
  product_name text,
  delta        integer,
  stock_before integer,
  stock_after  integer,
  reason       text,
  kind         text,
  employee_name text,
  created_at   timestamptz
)
language plpgsql volatile security definer
set search_path = public as $$
begin
  if public.auth_admin(p_admin_pin) is null then
    return;
  end if;

  return query
  select m.id, m.product_id, p.name, m.delta, m.stock_before, m.stock_after,
         m.reason, m.kind, e.full_name, m.created_at
    from public.stock_movements m
    join public.products p on p.id = m.product_id
    left join public.employees e on e.id = m.by_employee
   where m.product_id = p_product_id
   order by m.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 200);
end $$;

-- =============================================================================
-- create_order y cancel_order: registrar venta y devolución
-- =============================================================================
-- El descuento por venta es la razón principal por la que el stock baja, y hasta ahora
-- era el único cambio sin rastro. Sin esto, la bitácora solo tendría ajustes manuales y
-- no se podría contrastar el consumo real contra lo que dice el sistema.

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
  v_before    integer;
begin
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

    -- Solo se mueve el stock de lo que lo controla, y el SELECT con FOR UPDATE de
    -- arriba ya dejó la fila bloqueada: es seguro leer stock antes y escribir después.
    if exists (select 1 from public.products where id = v_line.pid and tracks_stock) then
      select stock into v_before from public.products where id = v_line.pid;

      update public.products as p
         set stock = p.stock - v_line.qty
       where p.id = v_line.pid and p.tracks_stock;

      insert into public.stock_movements
        (product_id, delta, stock_before, stock_after, reason, kind, order_id, by_employee)
      values (
        v_line.pid, -v_line.qty, v_before, v_before - v_line.qty,
        'Venta #' || v_code, 'sale', v_order, v_employee
      );
    end if;
  end loop;

  return query select v_order, v_code;
end $$;

create or replace function public.cancel_order(
  p_order_id uuid, p_reason text, p_admin_pin text default null)
returns text language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_order   record;
  v_vadmin  uuid;
  v_actor   uuid;
  v_before  integer;
  v_line    record;
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

  if v_order.status = 'cancelled' then
    raise exception 'Esa orden ya está anulada' using errcode = 'P0001';
  end if;

  -- Quién queda como autor del movimiento. Si la venta estaba cobrada hace falta un
  -- admin, y ese es el que ampara la devolución.
  v_actor := null;
  if v_order.paid_at is not null then
    v_vadmin := public.auth_admin(p_admin_pin);
    if v_vadmin is null then
      return null;
    end if;
    v_actor := v_vadmin;
  end if;

  update public.orders set
    status      = 'cancelled',
    void_reason = btrim(p_reason),
    voided_at   = now()
   where id = p_order_id;

  -- Se devuelve el stock. Se recorre línea por línea en vez de un UPDATE ... FROM
  -- agrupado porque ahora hace falta el stock antes y después de cada una para poder
  -- registrar el movimiento.
  for v_line in
    select oi.product_id, sum(oi.quantity)::int as qty
      from public.order_items oi
     where oi.order_id = p_order_id
       and oi.product_id is not null
     group by oi.product_id
  loop
    update public.products as p
       set stock = p.stock + v_line.qty
     where p.id = v_line.product_id
       and p.tracks_stock
    returning stock into v_before;

    if found and v_before is not null then
      insert into public.stock_movements
        (product_id, delta, stock_before, stock_after, reason, kind, order_id, by_employee)
      values (
        v_line.product_id, v_line.qty, v_before - v_line.qty, v_before,
        'Anulación: ' || btrim(p_reason), 'void', p_order_id, v_actor
      );
    end if;
  end loop;

  return 'cancelled';
end $$;

-- =============================================================================
-- Permisos
-- =============================================================================
revoke all on function public.adjust_stock(text, uuid, int, text) from public, authenticated;
grant execute on function public.adjust_stock(text, uuid, int, text) to anon;
revoke all on function public.set_stock(text, uuid, int, text) from public, authenticated;
grant execute on function public.set_stock(text, uuid, int, text) to anon;
revoke all on function public.stock_history(text, uuid, int) from public, authenticated;
grant execute on function public.stock_history(text, uuid, int) to anon;
