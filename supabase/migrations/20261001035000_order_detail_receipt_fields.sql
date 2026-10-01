-- =============================================================================
-- Fix 7.4.b — order_detail y search_orders deben llevar los datos del ticket
-- =============================================================================
-- El ticket impreso usa discount_amount, discount_reason y order_type. order_detail
-- no los devolvía, así que una cuenta reimpresa desde el historial salía SIN el
-- descuento aplicado y siempre rotulada "EN LOCAL", aunque el pedido original fuera
-- de Uber con descuento. El ticket reimpreso deja de ser el mismo ticket.
--
-- Agregar columnas de salida obliga a DROP + CREATE: CREATE OR REPLACE no puede
-- cambiar la firma de retorno de una función que ya existe. Las columnas nuevas van
-- AL FINAL para no romper a quien lee por nombre (PostgREST devuelve objetos, no
-- posiciones).
--
-- search_orders también se rehace, y de paso devuelve paid_total y remaining: el
-- historial tiene que poder mostrar "faltan $X" en una cuenta dividida sin que el
-- panel tenga que calcularlo y arriesgarse a no coincidir con el servidor.
-- =============================================================================

drop function if exists public.order_detail(text, uuid);

create or replace function public.order_detail(p_admin_pin text, p_order_id uuid)
returns table (
  order_id       uuid,
  code           bigint,
  status         text,
  table_number   int,
  customer_name  text,
  total          numeric,
  subtotal       numeric,
  tax            numeric,
  payment_method text,
  paid_at        timestamptz,
  void_reason    text,
  voided_at      timestamptz,
  employee_name  text,
  item_id        uuid,
  product_id     uuid,
  item_name      text,
  quantity       numeric,
  price          numeric,
  notes          text,
  current_name   text,
  order_type      text,
  platform        text,
  discount_amount numeric,
  discount_reason text
)
language plpgsql volatile security definer
set search_path = public as $$
begin
  if public.auth_admin(p_admin_pin) is null then
    return;
  end if;

  return query
  select o.id, o.code, o.status, o.table_number, o.customer_name, o.total, o.subtotal,
         o.tax, o.payment_method, o.paid_at, o.void_reason, o.voided_at, e.full_name,
         oi.id, oi.product_id, oi.product_name, oi.quantity::numeric, oi.price, oi.notes,
         -- Si el producto sigue en la carta se muestra el nombre actual; si ya no
         -- existe, product_name es la foto histórica y current_name queda en null.
         p.name,
         o.order_type,
         o.platform,
         o.discount_amount,
         o.discount_reason
    from public.orders o
    left join public.employees e on e.id = o.created_by
    join public.order_items oi on oi.order_id = o.id
    left join public.products p on p.id = oi.product_id
   where o.id = p_order_id
   order by oi.id;
end $$;

drop function if exists public.search_orders(text, text, date, date, text, int);

create or replace function public.search_orders(
  p_admin_pin text,
  p_query text default null,
  p_from date default null,
  p_to date default null,
  p_status text default null,
  p_limit int default 50
)
returns table (
  id             uuid,
  code           bigint,
  status         text,
  table_number   int,
  customer_name  text,
  total          numeric,
  payment_method text,
  paid_at        timestamptz,
  void_reason    text,
  employee_name  text,
  item_count     int,
  order_type     text,
  platform       text,
  paid_total     numeric,
  remaining      numeric
)
language plpgsql volatile security definer
set search_path = public as $$
declare
  v_admin uuid;
  v_q     text;
  v_lo    timestamptz;
  v_hi    timestamptz;
begin
  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return;
  end if;

  v_q := nullif(btrim(coalesce(p_query, '')), '');

  v_lo := case when p_from is not null
               then p_from::timestamp at time zone public.business_tz() end;
  v_hi := case when p_to is not null
               then ((p_to + 1)::timestamp at time zone public.business_tz()) - interval '1 microsecond'
               else null end;

  return query
  select o.id, o.code, o.status, o.table_number, o.customer_name, o.total,
         o.payment_method, o.paid_at, o.void_reason, e.full_name,
         coalesce((select sum(oi.quantity) from public.order_items oi where oi.order_id = o.id), 0)::int,
         o.order_type,
         o.platform,
         coalesce(o.paid_total, 0),
         round(o.total - coalesce(o.paid_total, 0), 2)
    from public.orders o
    left join public.employees e on e.id = o.created_by
   where (v_q is null
          or o.code::text ilike '%' || v_q || '%'
          or o.table_number::text ilike '%' || v_q || '%'
          or o.customer_name ilike '%' || v_q || '%')
     and (p_status is null or o.status = p_status)
     and (v_lo is null or coalesce(o.paid_at, o.created_at) >= v_lo)
     and (v_hi is null or coalesce(o.paid_at, o.created_at) <= v_hi)
   order by o.code desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

revoke all on function public.order_detail(text, uuid) from public, authenticated;
grant execute on function public.order_detail(text, uuid) to anon;
revoke all on function public.search_orders(text, text, date, date, text, int) from public, authenticated;
grant execute on function public.search_orders(text, text, date, date, text, int) to anon;