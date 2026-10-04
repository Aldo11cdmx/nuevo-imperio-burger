-- =============================================================================
-- Kitchen flow: notificación al mesero al marcar Listo + cobro desde cualquier estado
-- =============================================================================
-- 1. `notifications`: tabla ligera de avisos para el mesero. Se crea con RLS como
--    order_payments: solo las RPC/triggers escriben, y anon lee vía política.
-- 2. Trigger sobre `orders`: al pasar una orden a 'ready' (cocina lista) se inserta una
--    notificación ligada a la mesa. La orden permanece 'ready' y cobrable desde Tables.
-- 3. `add_payment`: se quita el bloqueo "Solo se cobra una orden servida". El mesero ahora
--    puede cobrar pendiente/in_kitchen/ready (pago por adelantado); el cierre sigue en
--    complete_order y el agotamiento de stock está intacto.

-- -----------------------------------------------------------------------------
-- 1) Tabla de notificaciones
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid         primary key default gen_random_uuid(),
  order_id    uuid         references public.orders on delete cascade,
  table_number int,
  type        text         not null default 'ready',
  message     text         not null,
  created_at  timestamptz  not null default now(),
  read_at     timestamptz  null
);

create index if not exists notifications_table_idx
  on public.notifications (table_number);
create index if not exists notifications_unread_idx
  on public.notifications (read_at) where read_at is null;

comment on table public.notifications is
  'Avisos al mesero (orden lista, etc.). Se escribe desde triggers SECURITY DEFINER y se lee por anon vía política.';

-- -----------------------------------------------------------------------------
-- 2) Función disparada + trigger sobre orders
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER: el insert en notifications debe sortear el RLS, igual que los
-- inserts de add_payment en order_payments. El dueño de la función (rol de migración)
-- tiene bypassrls, así que el trigger escribe aunque dispare desde una actualización
-- de orders que no vino por una RPC de escritura.
create or replace function public.notify_order_ready()
returns trigger
language plpgsql security definer
set search_path = public, extensions as $$
begin
  if NEW.status = 'ready'
     and OLD.status is distinct from 'ready'
     and NEW.table_number is not null then
    insert into public.notifications (order_id, table_number, type, message)
    values (NEW.id, NEW.table_number, 'ready',
            format('Orden #%s lista para servir en mesa %s', NEW.code, NEW.table_number));
  end if;
  return NEW;
end $$;

comment on function public.notify_order_ready() is
  'Al marcar una orden como ready en orders, deja un aviso para el mesero de su mesa.';

drop trigger if exists order_ready_notify on public.orders;
create trigger order_ready_notify
  after update of status on public.orders
  for each row execute function public.notify_order_ready();

-- -----------------------------------------------------------------------------
-- 3) add_payment: quita el bloqueo de "solo se cobra orden servida"
-- -----------------------------------------------------------------------------
-- La orden sigue pudiendo cobrarse de una sola vez o por partes. Se conserva el
-- bloqueo de completed/cancelled (no se cobra lo liquidado) y la tolerancia de un
-- centavo. La cuenta a medias se marca 'partially_paid' como antes.
create or replace function public.add_payment(
  p_order_id uuid,
  p_pin text,
  p_shift_id uuid,
  p_payment_method text,
  p_amount numeric,
  p_note text default null
)
returns table (order_id uuid, paid_total numeric, remaining numeric, status text)
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_employee uuid;
  v_total    numeric;
  v_paid     numeric;
  v_new      numeric;
  v_status   text;
begin
  if p_payment_method is null or p_payment_method not in ('cash','card','transfer') then
    raise exception 'Método de pago no válido' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto a cobrar debe ser mayor a cero' using errcode = '22023';
  end if;

  v_employee := public.auth_employee(p_pin);
  if v_employee is null then
    return;   -- vacío, no error: el rate limit debe sobrevivir al intento fallido
  end if;

  -- El turno tiene que ser el del cajero que cobra: si no, el efectivo cae en la
  -- gaveta de otro y su corte nunca lo refleja. Mismo motivo que complete_order.
  perform 1 from public.shifts
   where id = p_shift_id and closed_at is null and opened_by = v_employee;
  if not found then
    raise exception 'No hay una caja abierta. Abre tu turno en Caja antes de cobrar.' using errcode = 'P0001';
  end if;

  -- FOR UPDATE serializa dos cobros concurrentes de la misma orden: el segundo
  -- espera y al despertar ve paid_total ya actualizado, así que no hay doble cobro.
  select o.total, coalesce(o.paid_total, 0), o.status
    into v_total, v_paid, v_status
    from public.orders o
   where o.id = p_order_id
   for update;

  if v_total is null then
    raise exception 'La orden no existe' using errcode = 'P0001';
  end if;
  if v_status in ('completed','cancelled') then
    raise exception 'Esta orden ya no admite cobros (está en %)', v_status using errcode = 'P0001';
  end if;
  -- El mesero puede cobrar antes de que la cocina termine o del todo: pagos por
  -- adelantado y división parcial entran por acá. Lo que NO se cobra es una orden
  -- liquidada (caso anterior) o anulada.

  v_new := v_paid + round(p_amount, 2);

  if v_new > v_total + 0.01 then
    raise exception 'El cobro ($%) supera lo que falta ($%)', round(v_new, 2),
            round(v_total - v_paid, 2) using errcode = '22023';
  end if;

  insert into public.order_payments
    (order_id, amount, method, shift_id, paid_by, note)
  values
    (p_order_id, round(p_amount, 2), p_payment_method, p_shift_id, v_employee,
     nullif(btrim(coalesce(p_note, '')), ''));

  -- El cobro liquida la cuenta (completed) o la deja parcialmente pagada. La
  -- transición a 'served' no se fuerza desde aquí: la cocina lo marca al servir, y
  -- una orden pagada directamente también sale del tablero de cocina.
  if v_new >= v_total - 0.01 then
    v_status := 'completed';
  else
    v_status := 'partially_paid';
  end if;

  update public.orders
     set paid_total = v_new,
         status = v_status,
         payment_method = case when v_status = 'completed'
                               then p_payment_method else payment_method end,
         paid_at = case when v_status = 'completed' then now() else paid_at end,
         shift_id = p_shift_id
   where id = p_order_id;

  return query select p_order_id, v_new, round(v_total - v_new, 2), v_status;
end $$;

comment on function public.add_payment(uuid, text, uuid, text, numeric, text) is
  'Cobra una orden y la liquida si alcanza el total. Deja de exigir estado served: admite pagos por adelantado y división desde cualquier estado abierto.';

-- -----------------------------------------------------------------------------
-- 4) Permisos: anon lee notificaciones y ejecuta las RPC afectadas
-- -----------------------------------------------------------------------------
alter table public.notifications enable row level security;
revoke all on table public.notifications from authenticated;
grant select on public.notifications to anon;
create policy if not exists "anon: leer notificaciones"
  on public.notifications for select to anon using (true);

-- Marca como leídas las notificaciones pendientes. No pide PIN: descartar un aviso es
-- una acción sin consecuencia de negocio, y la política de select ya expone la info.
create or replace function public.mark_notifications_read()
returns void
language plpgsql security definer
set search_path = public, extensions as $$
begin
  update public.notifications
     set read_at = now()
   where read_at is null;
end $$;
revoke all on function public.mark_notifications_read() from public, authenticated;
grant execute on function public.mark_notifications_read() to anon;

do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime'
                   and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

revoke all on function public.add_payment(uuid, text, uuid, text, numeric, text) from public, authenticated;
grant execute on function public.add_payment(uuid, text, uuid, text, numeric, text) to anon;

-- -----------------------------------------------------------------------------
-- 5) Verificación post-migración
-- -----------------------------------------------------------------------------
--  1. La tabla de notificaciones existe y anon la lee:
--       select has_table_privilege('anon', 'public.notifications', 'select');
--       -> true
--
--  2. El trigger de notificación está activo sobre orders:
--       select tgname, tgrelid::regclass from pg_trigger
--        where NOT tgisinternal and tgname = 'order_ready_notify';
--      -> order_ready_notify | public.orders
--
--  3. add_payment ya no bloquea por estado served (busca el mensaje viejo y no lo
--    encuentra):
--       select prosrc from pg_proc where proname = 'add_payment';
--       -> prosrc no contiene 'Solo se cobra una orden servida'
