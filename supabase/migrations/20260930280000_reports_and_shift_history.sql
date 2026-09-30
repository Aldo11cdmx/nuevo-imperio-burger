-- =============================================================================
-- Reportes, historial de cortes y anulación desde historial
-- =============================================================================
-- El corte X y el corte Z ya existían (get_open_shifts y close_shift). Lo que faltaba
-- era poder consultar un corte viejo, y no había forma de responder "¿cuánto vendimos?".
--
-- TODO corte de día se hace con AT TIME ZONE 'America/Mexico_City' sobre el timestamptz,
-- nunca con date() en UTC. Con UTC, un ticket de las 23:30 hora local caería en el día
-- siguiente y el reporte diario estaría corrido medio día.
-- =============================================================================

-- ------------------------------------------------------------------------------------
-- Helper: rango de un día de negocio
-- ------------------------------------------------------------------------------------
-- Un día de negocio va de medianoche a medianoche en hora del restaurante. Se expone
-- aparte para que las RPC usen exactamente el mismo corte sin repetir la conversión en
-- cinco lugares y acabar divergiendo.
create or replace function public.business_day(p_ts timestamptz)
returns date language sql immutable
set search_path = public as $$
  select (p_ts at time zone public.business_tz())::date
$$;

comment on function public.business_day(timestamptz) is
  'Fecha local del negocio a la que pertenece un instante. Todo reporte diario usa esto.';

-- El lunes de la semana local que contiene p_ts, a medianoche.
create or replace function public.business_week_start(p_ts timestamptz)
returns date language sql immutable
set search_path = public as $$
  select (date_trunc('week', p_ts at time zone public.business_tz())::date)
$$;

-- ------------------------------------------------------------------------------------
-- Historial de turnos cerrados
-- ------------------------------------------------------------------------------------
-- El corte Z era un callejón sin salida: se cerraba y el reporte se perdía en cuanto se
-- cerraba la pantalla. Con esto se puede volver a consultar cualquier corte.
--
-- Exige PIN de admin. Un corte cerrado lleva el efectivo contado y la diferencia, que es
-- justo el dato que no debe quedar accesible a quien solo tenga la llave del bundle.
create or replace function public.list_closed_shifts(p_admin_pin text, p_limit int default 30)
returns table (
  shift_id         uuid,
  employee_name    text,
  opened_at        timestamptz,
  closed_at        timestamptz,
  opening_float    numeric,
  cash_sales       numeric,
  card_sales       numeric,
  transfer_sales   numeric,
  total_sales      numeric,
  ticket_count     int,
  counted_total    numeric,
  expected_cash    numeric,
  cash_difference  numeric,
  shift_note       text
)
language plpgsql volatile security definer
set search_path = public as $$
begin
  if public.auth_admin(p_admin_pin) is null then
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
   where s.closed_at is not null
   group by s.id, e.full_name
   order by s.closed_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 200);
end $$;

-- ------------------------------------------------------------------------------------
-- sales_summary: el resumen del periodo
-- ------------------------------------------------------------------------------------
-- Tres cortes en una sola llamada porque la UI siempre muestra los tres juntos, y tres
-- viajes por separado darían tres fotos distintas del mismo instante.
--
-- p_from / p_to son fechas de negocio locales, inclusivas: p_to se extiende hasta el
-- final de ese día para que "del 1 al 3" incluya todo el día 3, que es lo que alguien
-- entiende cuando escribe esas fechas. Si el cliente manda instantes (reporte con hora
-- exacta) se respetan tal cual; sin nada, el rango es hoy.
create or replace function public.sales_summary(
  p_admin_pin text,
  p_from date,
  p_to date default null,
  p_from_ts timestamptz default null,
  p_to_ts timestamptz default null
)
returns table (
  scope           text,
  total_sales     numeric,
  ticket_count    int,
  ticket_average  numeric,
  cash_sales      numeric,
  card_sales      numeric,
  transfer_sales  numeric,
  voided_count    int,
  voided_amount   numeric
)
language plpgsql volatile security definer
set search_path = public as $$
declare
  v_today date;
  v_week  date;
  v_lo    timestamptz;
  v_hi    timestamptz;
begin
  if public.auth_admin(p_admin_pin) is null then
    return;
  end if;

  v_today := public.business_day(now());
  v_week  := public.business_week_start(now());

  v_lo := coalesce(
    p_from_ts,
    (coalesce(p_from, v_today)::timestamp at time zone public.business_tz())
  );
  v_hi := coalesce(
    p_to_ts,
    (((coalesce(p_to, v_today) + 1)::timestamp at time zone public.business_tz())
      - interval '1 microsecond')
  );

  return query
  with periodos(scope, lo, hi) as (
    values
      ('hoy',   v_today::timestamp at time zone public.business_tz(),
                 ((v_today + 1)::timestamp at time zone public.business_tz()) - interval '1 microsecond'),
      ('semana', v_week::timestamp at time zone public.business_tz(),
                 ((v_week + 7)::timestamp at time zone public.business_tz()) - interval '1 microsecond'),
      ('rango',  v_lo, v_hi)
  )
  select p.scope,
         coalesce(sum(o.total) filter (where o.status = 'completed'), 0),
         count(o.id) filter (where o.status = 'completed')::int,
         round(coalesce(avg(o.total) filter (where o.status = 'completed'), 0), 2),
         coalesce(sum(o.total) filter (where o.status = 'completed' and o.payment_method = 'cash'), 0),
         coalesce(sum(o.total) filter (where o.status = 'completed' and o.payment_method = 'card'), 0),
         coalesce(sum(o.total) filter (where o.status = 'completed' and o.payment_method = 'transfer'), 0),
         count(o.id) filter (where o.status = 'cancelled')::int,
         coalesce(sum(o.total) filter (where o.status = 'cancelled'), 0)
    from periodos p
    left join public.orders o
      on o.paid_at is not null
     and o.paid_at >= p.lo
     and o.paid_at <= p.hi
   group by p.scope
   order by array_position(array['hoy','semana','rango'], p.scope);
end $$;

-- ------------------------------------------------------------------------------------
-- top_products
-- ------------------------------------------------------------------------------------
-- Agrega por product_id, no por product_name. El nombre cambia cuando el admin edita la
-- carta, y las líneas viejas guardan el nombre histórico: agrupar por nombre separaría
-- "Burger" de "Burger Sazón" como dos productos distintos.
--
-- Se excluyen product_id null: son líneas de productos que ya no existen en la carta. No se
-- pueden atribuir a un producto real, y meterlas inflaría el ranking.
--
-- El nombre que se muestra es el vivo del catálogo: si el admin renombró el producto, el
-- reporte lo muestra como se llama hoy. Si ya no existe, cae al nombre histórico guardado
-- en la línea, y el ranking sigue explicando esa venta.
create or replace function public.top_products(
  p_admin_pin text,
  p_from date,
  p_to date default null,
  p_limit int default 5
)
returns table (
  rank         int,
  product_id   uuid,
  product_name text,
  units        numeric,
  revenue      numeric
)
language plpgsql volatile security definer
set search_path = public as $$
declare
  v_admin uuid;
  v_today date;
  v_lo    timestamptz;
  v_hi    timestamptz;
begin
  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return;
  end if;

  v_today := public.business_day(now());
  v_lo    := coalesce(p_from, v_today)::timestamp at time zone public.business_tz();
  v_hi    := ((coalesce(p_to, v_today) + 1)::timestamp at time zone public.business_tz())
             - interval '1 microsecond';

  return query
  select row_number() over (order by sum(oi.quantity) desc)::int,
         oi.product_id,
         coalesce(p.name, max(oi.product_name)),
         sum(oi.quantity)::numeric,
         round(sum(oi.quantity * oi.price), 2)
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    left join public.products p on p.id = oi.product_id
   where o.status = 'completed'
     and oi.product_id is not null
     and o.paid_at >= v_lo
     and o.paid_at <= v_hi
   group by oi.product_id, p.name
   order by sum(oi.quantity) desc, sum(oi.quantity * oi.price) desc
   limit least(greatest(coalesce(p_limit, 5), 1), 50);
end $$;

-- ------------------------------------------------------------------------------------
-- search_orders: historial con filtros
-- ------------------------------------------------------------------------------------
-- Busca por número de ticket, mesa o cliente. El texto va entre % para que "12" encuentre
-- 12, 112 y 1212: en una barra de burgers se teclea rápido y nadie busca dígito por dígito.
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
  item_count     int
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

  -- Rango opcional. Sin fechas se busca en todo el histórico.
  v_lo := case when p_from is not null
               then p_from::timestamp at time zone public.business_tz() end;
  v_hi := case when p_to is not null
               then ((p_to + 1)::timestamp at time zone public.business_tz()) - interval '1 microsecond'
               else null end;

  return query
  select o.id, o.code, o.status, o.table_number, o.customer_name, o.total,
         o.payment_method, o.paid_at, o.void_reason, e.full_name,
         coalesce((select sum(oi.quantity) from public.order_items oi where oi.order_id = o.id), 0)::int
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

-- ------------------------------------------------------------------------------------
-- order_detail: las líneas de un ticket
-- ------------------------------------------------------------------------------------
-- El historial muestra el total, pero para entender una venta hace falta ver qué se llevó
-- el cliente. Se separa de search_orders porque la forma de la respuesta es distinta: aquí
-- se pide UN ticket y se devuelven sus líneas, no una lista de tickets.
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
  current_name   text
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
         -- Si el producto sigue en la carta se muestra el nombre actual; si ya no existe,
         -- product_name es la foto histórica y current_name queda en null. La venta se
         -- sigue explicando aunque el producto se haya borrado de la carta.
         p.name
    from public.orders o
    left join public.employees e on e.id = o.created_by
    join public.order_items oi on oi.order_id = o.id
    left join public.products p on p.id = oi.product_id
   where o.id = p_order_id
   order by oi.id;
end $$;

-- ------------------------------------------------------------------------------------
-- Anulación desde el historial
-- ------------------------------------------------------------------------------------
-- cancel_order ya exige motivo, y PIN de admin si la orden estaba cobrada. Lo que le
-- faltaba era poder invocarla desde el historial sin buscar el uuid a mano.
--
-- Se expone como void_order para que la UI tenga un punto de entrada claro. Cuando
-- cancel_order devuelve null es porque la orden estaba cobrada y el PIN de admin no
-- cuadró: no es un error de servidor, es una decisión de negocio, y la UI debe poder pedir
-- el PIN y reintentar sin perder el motivo ya escrito.
create or replace function public.void_order(
  p_order_id uuid, p_reason text, p_admin_pin text default null
)
returns table (
  status      text,
  was_paid    boolean,
  void_reason text
)
language plpgsql volatile security definer
set search_path = public as $$
declare
  v_paid   boolean;
  v_reason text;
  v_result text;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Escribe el motivo de la anulación' using errcode = '22023';
  end if;

  select o.paid_at is not null into v_paid
    from public.orders o
   where o.id = p_order_id
   for update;

  if v_paid is null and not found then
    raise exception 'La orden no existe' using errcode = 'P0001';
  end if;

  v_reason := btrim(p_reason);
  v_result := public.cancel_order(p_order_id, v_reason, p_admin_pin);

  if v_result is null then
    return;
  end if;

  return query select v_result, v_paid, v_reason;
end $$;

-- ------------------------------------------------------------------------------------
-- Permisos
-- ------------------------------------------------------------------------------------
-- Todas exigen PIN de admin dentro del cuerpo. El privilegio EXECUTE para anon es
-- necesario para que el navegador las pueda llamar, igual que con el resto: la diferencia
-- es que no hacen nada sin un PIN válido.
--
-- business_day y business_week_start no piden PIN: son funciones puras de fecha, no tocan
-- datos y no tienen nada que revelar.
revoke all on function public.list_closed_shifts(text, int) from public, authenticated;
grant execute on function public.list_closed_shifts(text, int) to anon;
revoke all on function public.sales_summary(text, date, date, timestamptz, timestamptz) from public, authenticated;
grant execute on function public.sales_summary(text, date, date, timestamptz, timestamptz) to anon;
revoke all on function public.top_products(text, date, date, int) from public, authenticated;
grant execute on function public.top_products(text, date, date, int) to anon;
revoke all on function public.search_orders(text, text, date, date, text, int) from public, authenticated;
grant execute on function public.search_orders(text, text, date, date, text, int) to anon;
revoke all on function public.order_detail(text, uuid) from public, authenticated;
grant execute on function public.order_detail(text, uuid) to anon;
revoke all on function public.void_order(uuid, text, text) from public, authenticated;
grant execute on function public.void_order(uuid, text, text) to anon;

revoke all on function public.business_day(timestamptz) from public, authenticated;
grant execute on function public.business_day(timestamptz) to anon;
revoke all on function public.business_week_start(timestamptz) from public, authenticated;
grant execute on function public.business_week_start(timestamptz) to anon;
