-- =============================================================================
-- POS Sazón & Carbón — esquema core (estado consolidado)
-- =============================================================================
-- Este archivo reproduce el estado final del esquema en una base vacía.
--
-- Se aplicó al proyecto tlwiazszyqhddhefhirs como la secuencia de migraciones
-- pos_core_schema -> pos_auth_lockout_fix -> pos_list_employees ->
-- pos_revoke_anon_privileges -> pos_rate_limit_commit_fix ->
-- pos_client_ip_search_path -> pos_revoke_public_execute. Este archivo consolida
-- ese resultado; no es el registro de la secuencia aplicada.
--
-- Decisiones de seguridad que condicionan el resto del archivo:
--
--  1. La llave anon viaja en el bundle de Vite: no es un secreto. Por eso
--     employees NO tiene políticas RLS. Con PIN de 4 dígitos el espacio es de
--     10.000 y un digest bcrypt se revierte por fuerza bruta en milisegundos:
--     hashear no protege si la columna es legible, así que no se expone.
--  2. La app no usa Supabase Auth. Tras validar un PIN la conexión sigue siendo
--     el rol anon, de modo que toda mutación sensible revalida un PIN de
--     administrador dentro de la función (patrón de re-autenticación).
--  3. El camino de FALLO de los RPC de autenticación retorna, no lanza. Si
--     lanzara, Postgres abortaría la transacción y con ella el contador
--     anti-fuerza-bruta, que era exactamente el bug que se corrigió aquí.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- employees ----------
create table public.employees (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null check (length(btrim(full_name)) > 0),
  role       text not null check (role in ('admin','cashier','waiter','kitchen')),
  pin_hash   text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Impide dos empleados con el mismo PIN, que haría ambiguo el limit 1 del login.
  constraint employees_pin_hash_key unique (pin_hash)
);

comment on table public.employees is
  'Empleados del POS. RLS sin políticas: se accede solo vía login_with_pin, list_employees, create_employee y toggle_employee.';
comment on column public.employees.pin_hash is
  'bcrypt (pgcrypto crypt). Nunca devolver esta columna a anon.';

-- ---------- orders ----------
create table public.orders (
  id             uuid primary key default gen_random_uuid(),
  code           bigint generated always as identity,
  table_number   int check (table_number > 0),
  customer_name  text,
  status         text not null default 'pending'
                   check (status in ('pending','in_kitchen','ready','served','completed','cancelled')),
  subtotal       numeric(12,2) not null default 0 check (subtotal >= 0),
  tax            numeric(12,2) not null default 0 check (tax >= 0),
  total          numeric(12,2) not null default 0 check (total >= 0),
  payment_method text check (payment_method in ('cash','card','transfer')),
  paid_at        timestamptz,
  created_by     uuid not null references public.employees(id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.orders is
  'Órdenes del POS. Sin política DELETE para anon: el historial de ventas es inalterable.';

create table public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  product_name text not null,
  quantity     int not null check (quantity > 0),
  price        numeric(12,2) not null check (price >= 0),
  notes        text,
  created_at   timestamptz not null default now()
);

comment on table public.order_items is
  'Líneas de orden. Sin política DELETE para anon.';

-- ---------- indices ----------
-- Parcial: es exactamente la consulta de Kitchen (órdenes no cobradas ni anuladas).
create index orders_open_created_at_idx on public.orders (created_at)
  where status in ('pending','in_kitchen','ready','served');
create index orders_created_at_desc_idx on public.orders (created_at desc);
create index orders_created_by_idx on public.orders (created_by);
create index order_items_order_id_idx on public.order_items (order_id);

-- ---------- updated_at ----------
create function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- ---------- rate limit por IP ----------
-- Con login solo por PIN un intento fallido NO se puede atribuir a un empleado: el
-- PIN es la credencial, así que si no verifica no sabemos de quién es. Por eso el
-- bloqueo es por IP y no por empleado.
create table public.pin_rate_limits (
  ip                inet primary key,
  window_started_at timestamptz not null default now(),
  attempts          int not null default 0,
  locked_until      timestamptz
);

comment on table public.pin_rate_limits is
  'Ventana y bloqueo por IP. Limitar por empleado es imposible con login solo por PIN; ver rate_limit_register.';

-- ---------- utilidades ----------
create function public.client_ip()
returns text language plpgsql stable
set search_path = public as $$
declare h json; fwd text;
begin
  begin
    h := current_setting('request.headers', true)::json;
  exception when others then
    return '0.0.0.0';
  end;
  if h is null then return '0.0.0.0'; end if;
  fwd := h->>'x-forwarded-for';
  if fwd is null or fwd = '' then fwd := coalesce(h->>'x-real-ip', '0.0.0.0'); end if;
  fwd := split_part(btrim(fwd), ',', 1);   -- x-forwarded-for puede ser una lista
  return case when fwd ~ '^[0-9a-fA-F:.]+$' then fwd else '0.0.0.0' end;
end $$;

-- Registra un intento y devuelve el mensaje de bloqueo, o NULL si puede continuar.
-- Devuelve en vez de lanzar a propósito: si abortara la transacción, el incremento
-- se perdería y el rate limit no serviría de nada.
create function public.rate_limit_register()
returns text language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_ip       inet;
  v_attempts int;
  v_locked   timestamptz;
  v_started  timestamptz;
begin
  -- Serializa lectura y actualización del contador: dos intentos simultáneos no
  -- pueden saltarse el umbral de 5.
  perform pg_advisory_xact_lock(hashtextextended('pos_auth', 0));
  v_ip := public.client_ip()::inet;

  delete from public.pin_rate_limits
   where (locked_until is not null and locked_until < now())
      or (locked_until is null and window_started_at < now() - interval '10 minutes');

  insert into public.pin_rate_limits (ip, window_started_at, attempts)
  values (v_ip, now(), 0)
  on conflict (ip) do nothing;

  select r.attempts, r.locked_until, r.window_started_at
    into v_attempts, v_locked, v_started
    from public.pin_rate_limits r
   where r.ip = v_ip
     for update;

  if v_locked is not null and v_locked > now() then
    return 'Demasiados intentos fallidos. Reintenta en ' ||
           extract(epoch from (v_locked - now()))::int || ' segundos.';
  end if;

  if now() - v_started > interval '60 seconds' then
    v_attempts := 0;
    v_started := now();
  end if;

  v_attempts := v_attempts + 1;

  update public.pin_rate_limits
     set attempts = v_attempts, window_started_at = v_started
   where ip = v_ip;

  if v_attempts >= 5 then
    update public.pin_rate_limits
       set attempts = 0,
           window_started_at = now(),
           locked_until = now() + interval '15 minutes'
     where ip = v_ip;
    return 'Demasiados intentos fallidos. Espera 15 minutos.';
  end if;

  return null;
end $$;

create function public.rate_limit_clear()
returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  -- Un login correcto no debe heredar penalizaciones de intentos anteriores.
  delete from public.pin_rate_limits where ip = public.client_ip()::inet;
end $$;

-- ---------- login por PIN ----------
create function public.login_with_pin(p_pin text)
returns table (
  id        uuid,
  full_name text,
  role      text,
  ok        boolean,
  message   text
)
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_id    uuid;
  v_name  text;
  v_role  text;
  v_block text;
begin
  -- Solo validaciones de formato lanzan: son errores de cliente y no se cuentan.
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN no válido' using errcode = '22023';
  end if;

  v_block := public.rate_limit_register();
  if v_block is not null then
    return query select null::uuid, null::text, null::text, false, v_block;
    return;
  end if;

  select e.id, e.full_name, e.role
    into v_id, v_name, v_role
    from public.employees e
   where e.is_active
     and e.pin_hash = extensions.crypt(p_pin, e.pin_hash)
   limit 1;

  if v_id is not null then
    perform public.rate_limit_clear();
    return query select v_id, v_name, v_role, true, null::text;
    return;
  end if;

  return query select null::uuid, null::text, null::text, false, 'PIN no reconocido';
end $$;

-- ---------- autorizacion de admin ----------
-- Devuelve NULL en vez de lanzar, por el mismo motivo que el login: el contador
-- del path admin también debe confirmarse.
create function public.auth_admin(p_pin text)
returns uuid language plpgsql security definer
set search_path = public, extensions as $$
declare v_id uuid; v_block text;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return null;
  end if;

  v_block := public.rate_limit_register();
  if v_block is not null then
    return null;
  end if;

  select e.id into v_id
    from public.employees e
   where e.is_active
     and e.role = 'admin'
     and e.pin_hash = extensions.crypt(p_pin, e.pin_hash)
   limit 1;

  return v_id;
end $$;

-- ---------- gestion de empleados ----------
create function public.list_employees(p_admin_pin text)
returns table (
  id         uuid,
  full_name  text,
  role       text,
  is_active  boolean,
  created_at timestamptz
)
language plpgsql security definer
set search_path = public, extensions as $$
declare v_admin uuid;
begin
  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return;   -- sin filas: el cliente lo interpreta como autorizacion fallida
  end if;
  perform public.rate_limit_clear();
  return query
    select e.id, e.full_name, e.role, e.is_active, e.created_at
      from public.employees e
     order by e.created_at desc;
end $$;

create function public.create_employee(
  p_admin_pin text, p_full_name text, p_role text, p_pin text)
returns uuid language plpgsql security definer
set search_path = public, extensions as $$
declare v_admin uuid; v_id uuid;
begin
  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return null;
  end if;

  if p_role not in ('admin','cashier','waiter','kitchen') then
    raise exception 'Rol no válido' using errcode = '22023';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'El PIN debe tener 4 dígitos' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_full_name,''))) = 0 then
    raise exception 'El nombre es obligatorio' using errcode = '22023';
  end if;

  perform public.rate_limit_clear();
  insert into public.employees (full_name, role, pin_hash)
  values (btrim(p_full_name), p_role,
          extensions.crypt(p_pin, extensions.gen_salt('bf', 10)))
  returning id into v_id;
  return v_id;
end $$;

create function public.toggle_employee(p_admin_pin text, p_employee_id uuid)
returns boolean language plpgsql security definer
set search_path = public, extensions as $$
declare v_admin uuid; v_active boolean;
begin
  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return null;
  end if;
  if p_employee_id = v_admin then
    raise exception 'No puedes desactivar tu propio acceso' using errcode = 'P0001';
  end if;

  perform public.rate_limit_clear();
  update public.employees
     set is_active = not is_active
   where id = p_employee_id
  returning is_active into v_active;
  return v_active;
end $$;

-- ---------- RLS ----------
-- employees y pin_rate_limits: RLS activado y SIN políticas. La ausencia de
-- políticas es la protección; el revoke explícito es defensa en profundidad.
alter table public.employees enable row level security;
alter table public.pin_rate_limits enable row level security;

-- Supabase aplica ALTER DEFAULT PRIVILEGES y otorga TODO (incluido DELETE y
-- TRUNCATE) sobre las tablas nuevas de public. RLS impide el DELETE porque no
-- hay política para ese comando, pero TRUNCATE no está sujeto a RLS, así que el
-- privilegio heredado se revoca explícitamente.
revoke all on table public.employees from anon, authenticated;
revoke all on table public.pin_rate_limits from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.order_items from anon, authenticated;

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
grant select, insert, update on public.orders to anon;
grant select, insert, update on public.order_items to anon;

-- Solo anon. authenticated no recibe acceso a propósito: si alguien habilita
-- Supabase Auth más adelante, no hereda permisos por accidente.
create policy orders_anon_select on public.orders for select to anon using (true);
create policy orders_anon_insert on public.orders for insert to anon with check (true);
create policy orders_anon_update on public.orders for update to anon using (true) with check (true);
create policy order_items_anon_select on public.order_items for select to anon using (true);
create policy order_items_anon_insert on public.order_items for insert to anon with check (true);
create policy order_items_anon_update on public.order_items for update to anon using (true) with check (true);

-- ---------- permisos de funcion ----------
-- Postgres otorga EXECUTE a PUBLIC por defecto: revocar de PUBLIC es obligatorio.
-- Los tres RPC de autenticacion DEBEN ser ejecutables por anon (la llave viaja en
-- el bundle); cada uno revalida el PIN correspondiente en el servidor.
revoke all on function public.client_ip() from public;
revoke all on function public.touch_updated_at() from public;
revoke all on function public.rate_limit_register() from public, anon, authenticated;
revoke all on function public.rate_limit_clear() from public, anon, authenticated;
revoke all on function public.auth_admin(text) from public, anon, authenticated;

revoke all on function public.login_with_pin(text) from public, authenticated;
grant execute on function public.login_with_pin(text) to anon;
revoke all on function public.list_employees(text) from public, authenticated;
grant execute on function public.list_employees(text) to anon;
revoke all on function public.create_employee(text,text,text,text) from public, authenticated;
grant execute on function public.create_employee(text,text,text,text) to anon;
revoke all on function public.toggle_employee(text,uuid) from public, authenticated;
grant execute on function public.toggle_employee(text,uuid) to anon;

-- ---------- realtime para Kitchen ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime'
                   and schemaname='public' and tablename='orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

-- ---------- seed ----------
-- PINes de DESARROLLO. Rotarlos antes de cualquier despliegue real.
insert into public.employees (full_name, role, pin_hash)
select 'Gerente Sazón', 'admin', extensions.crypt('1234', extensions.gen_salt('bf', 10))
where not exists (select 1 from public.employees
                  where full_name='Gerente Sazón' and role='admin');

insert into public.employees (full_name, role, pin_hash)
select 'Mesero Demo', 'waiter', extensions.crypt('0000', extensions.gen_salt('bf', 10))
where not exists (select 1 from public.employees
                  where full_name='Mesero Demo' and role='waiter');
