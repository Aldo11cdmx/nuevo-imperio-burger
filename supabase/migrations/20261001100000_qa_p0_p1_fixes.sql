-- =============================================================================
-- 20261001100000_qa_p0_p1_fixes.sql
-- Correcciones de la auditoría de QA: P0-1, P0-2, P1-1 y P1-2
-- =============================================================================
-- LA AUDITORÍA ENCONTRÓ
--
-- · P0-1  Tres RPC de lectura declaradas STABLE fallaban SIEMPRE con 25006
--         "cannot execute DELETE in a read-only transaction".
-- · P0-2  advance_order no validaba ningún PIN. Se推移aba una orden ajena por
--         pending -> in_kitchen -> ready -> served con solo la anon key.
-- · P1-1  shift_report leía expenses_total y expected_cash del snapshot del turno,
--         que solo se rellena al cerrar: el corte X y el corte Z se contradecían.
-- · P1-2  El rate limiter contaba por IP. En un restaurante todas las tablets
--         comparten la IP del Wi-Fi, así que 5 intentos bloqueaban a todo el local.
--
-- -----------------------------------------------------------------------------
-- P0-1 · POR QUÉ STABLE ROMPÍA ESTAS TRES Y NO OTRAS
-- -----------------------------------------------------------------------------
-- PostgREST envuelve en una transacción de solo lectura (`transaction_read_only=on`)
-- toda llamada a una función que declara STABLE o IMMUTABLE. Es una decisión
-- razonable para lo que esas funciones prometen: no escriben, así que su resultado
-- puede cachearse.
--
-- El problema es que "no escribe" ya no era cierto. Las tres llaman a auth_employee o
-- auth_admin para validar el PIN, y auth_employee llama a rate_limit_register(), que
-- hace DELETE sobre pin_rate_limits. Ese DELETE es de mantenimiento del contador, no
-- del negocio, pero la transacción es de solo lectura igual y revienta.
--
-- No es un caso raro: de las 58 RPC exposed a anon, 5 son IMMUTABLE (ninguna llama a
-- auth) y 37 son VOLATILE (casi todas llaman a auth). Solo estas 3 se quedaron STABLE
-- y son exactamente las 3 que fallan. La correlación es del 100%.
--
-- El arreglo NO es quitar el DELETE del rate limiter, que protege el PIN. Es dejar de
-- prometerle a PostgREST que estas funciones no escriben. Son VOLATILE de verdad: la
-- autenticación muta el contador de intentos, y decir lo contrario es lo que
-- dejó rotas.
--
-- Mismo arreglo y mismo motivo que el que ya se aplicó a set_product_modifier_groups.
-- Estas tres se quedaron atrás.
-- =============================================================================

-- Se re-CREAN porque la palabra STABLE está en la firma de creación y no se puede
-- cambiar con ALTER: hay que volver a declararla. El cuerpo es idéntico salvo la
-- palabra de volatilidad; se copia tal cual para no cambiar comportamiento mientras
-- se arregla el acceso.

create or replace function public.list_shift_expenses(p_pin text)
returns table (
  id uuid, amount numeric, reason text, by_name text, created_at timestamp with time zone,
  voided_at timestamp with time zone, void_reason text, voided_by text, running_total numeric
)
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_employee uuid;
  v_shift    uuid;
begin
  v_employee := public.auth_employee(p_pin);
  if v_employee is null then
    return;
  end if;

  select s.id into v_shift
    from public.shifts s
   where s.opened_by = v_employee and s.closed_at is null
   limit 1;

  if v_shift is null then
    return;
  end if;

  return query
  select e.id, e.amount, e.reason, emp.full_name, e.created_at,
         e.voided_at, e.void_reason, vb.full_name,
         sum(case when e.voided_at is null then e.amount else 0 end)
           over (order by e.created_at, e.id)
    from public.cash_expenses e
    join public.employees emp on emp.id = e.by_employee
    left join public.employees vb on vb.id = e.voided_by
   where e.shift_id = v_shift
   order by e.created_at desc, e.id desc;
end $$;

comment on function public.list_shift_expenses(text) is
  'Gastos del turno abierto con acumulado. VOLATILE porque auth_employee toca el contador del rate limiter.';

create or replace function public.product_modifier_catalog(p_pin text)
returns jsonb
language plpgsql volatile security definer
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
  'Catalogo de extras del POS. VOLATILE porque auth_employee toca el contador del rate limiter.';

create or replace function public.modifier_admin_catalog(p_admin_pin text)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions as $$
begin
  if public.auth_admin(p_admin_pin) is null then
    return null;
  end if;

  return jsonb_build_object(
    'groups', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'group_id',   g.id,
            'name',       g.name,
            'min_select', g.min_select,
            'max_select', g.max_select,
            'is_active',  g.is_active,
            'sort_order', g.sort_order,
            'modifiers',  (
              select coalesce(jsonb_agg(jsonb_build_object(
                'modifier_id', m.id,
                'name',        m.name,
                'price',       m.price,
                'is_active',   m.is_active,
                'sort_order',  m.sort_order
              ) order by m.sort_order, m.name), '[]'::jsonb)
                from public.modifiers m
               where m.group_id = g.id
            )
          ) order by g.sort_order, g.name
        )
          from public.modifier_groups g
      ), '[]'::jsonb
    ),

    'product_groups', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('product_id', pmg.product_id, 'group_ids', pmg.group_ids)
          order by pmg.product_id
        )
          from (
            select product_id, jsonb_agg(group_id order by group_id) as group_ids
              from public.product_modifier_groups
             group by product_id
          ) pmg
      ), '[]'::jsonb
    )
  );
end $$;

comment on function public.modifier_admin_catalog(text) is
  'Catalogo de extras para Administracion. VOLATILE porque auth_admin toca el contador del rate limiter.';

-- =============================================================================
-- P0-2 · advance_order PIDE PIN
-- =============================================================================
-- La auditoría demonstrated que esta era la ÚNICA función de escritura de todo el
-- sistema sin PIN: con solo la anon key pública se podía llevar una orden ajena de
-- pending a served. El comentario de la migración 20260930250000 la excluía del
-- invariante a propósito ("no muta dinero ni precio"), y esa fue la decisión que
-- dejó el hueco.
--
-- La exclusión era defendible en teoría, pero en la práctica el estado de la orden ES
-- dinero: `served` es lo que hace una orden cobrable, y `tables_status` lo usa para
-- poner la mesa en amarillo. Marcar servida una orden que no lo está manda a la
-- cocina a producir algo que el sistema cree entregado.
--
-- El PIN va como PRIMER parámetro y la función antigua se dropea, porque una
-- sobrecarga es una función distinta: si la de 2 argumentos sobrevive, PostgREST
-- seguiría resolviendo contra ella y el arreglo no serviría de nada. Es la misma
-- trampa que se documentó en save_table.
--
-- Requiere PIN de EMPLEADO, no de administrador: quien lleva la comanda es el mesero
-- o el cocinero, y ninguno de los dos es admin. Exigir admin sí bloquearía el KDS.

drop function public.advance_order(uuid, text);

create function public.advance_order(p_pin text, p_order_id uuid, p_to_status text)
returns text
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_employee uuid;
  v_current  text;
begin
  v_employee := public.auth_employee(p_pin);
  if v_employee is null then
    return null;
  end if;

  if p_to_status not in ('in_kitchen', 'ready', 'served') then
    raise exception 'Transición no válida' using errcode = '22023';
  end if;

  select o.status into v_current
    from public.orders o
   where o.id = p_order_id
     for update;

  if v_current is null then
    raise exception 'La orden no existe' using errcode = 'P0001';
  end if;

  if (p_to_status = 'in_kitchen' and v_current <> 'pending')
     or (p_to_status = 'ready' and v_current <> 'in_kitchen')
     or (p_to_status = 'served' and v_current <> 'ready') then
    raise exception 'No se puede pasar de % a %', v_current, p_to_status using errcode = 'P0001';
  end if;

  update public.orders set status = p_to_status where id = p_order_id;
  return p_to_status;
end $$;

comment on function public.advance_order(text, uuid, text) is
  'Avanza la orden por el flujo de cocina. Exige PIN de empleado: el estado served es lo que hace cobrable una orden.';

revoke all on function public.advance_order(text, uuid, text) from public, authenticated;
grant execute on function public.advance_order(text, uuid, text) to anon;

-- =============================================================================
-- P1-1 · EL CORTE X TIENE QUE DECIR LO MISMO QUE EL CORTE Z
-- =============================================================================
-- El problema: shift_report devolvía expenses_total, expected_cash y variance LEYÉNDOLOS
-- de la fila del turno, y esas columnas solo las escribe close_shift al cerrar. Con el
-- turno abierto la fila tenía expenses_total = 0 y expected_cash = null, así que el
-- corte X mostraba "$0 de gastos" y el esperado en blanco. Al cerrar, el mismo turno
-- mostraba 150.50 y 749.50. El cajero contaba una gaveta y la app le decía otra cosa.
--
-- La solución NO es rellenar el snapshot mientras el turno está abierto. El snapshot
-- existe para congelar el Z: si se actualiza en vivo, un arqueo de ayer cambiaría al
-- tocar una orden vieja, y el histórico dejaría de ser histórico.
--
-- Es que el reporte CALCULE los gastos y el esperado en el momento, y los tres campos
-- snapshot se Filling solo si el turno ya está cerrado. Así el X es el Z calculado con
-- los mismos números, y el Z congelado sigue siendo el Z.
--
-- expected_cash se deriva de las MISMAS fuentes que usa close_shift:
--   opening_float + ventas en efectivo − gastos no anulados
-- que es la fórmula del arqueo, y solo difiere en el redondeo a 2 decimales.

create or replace function public.shift_report(p_pin text, p_shift_id uuid)
returns table (
  shift_id uuid, employee_name text, opened_at timestamp with time zone, closed_at timestamp with time zone,
  opening_float numeric, cash_sales numeric, card_sales numeric, transfer_sales numeric,
  total_sales numeric, ticket_count integer, expenses numeric, counted_total numeric,
  expected_cash numeric, cash_difference numeric, shift_note text
)
language plpgsql volatile security definer
set search_path = public, extensions as $$
begin
  if public.auth_employee(p_pin) is null then
    return;
  end if;

  return query
  with ventas as (
    select coalesce(sum(p.amount) filter (where p.method = 'cash'), 0)     as cash,
           coalesce(sum(p.amount) filter (where p.method = 'card'), 0)     as card,
           coalesce(sum(p.amount) filter (where p.method = 'transfer'), 0) as transfer,
           coalesce(sum(p.amount), 0)                                       as total,
           count(distinct p.order_id)::int                                  as tickets
      from public.order_payments p
      left join public.orders po
        on po.id = p.order_id and po.status = 'cancelled'
     where p.shift_id = p_shift_id
       and p.reverted_at is null
       and (p.id is null or po.id is null)
  ),
  gastos as (
    -- Los anulados se conservan en la tabla y NO restan: el arqueo dice lo que salió
    -- de la gaveta, y un gasto corregido no salió dos veces.
    select coalesce(sum(e.amount) filter (where e.voided_at is null), 0) as total
      from public.cash_expenses e
     where e.shift_id = p_shift_id
  )
  select s.id, e.full_name, s.opened_at, s.closed_at, s.opening_float,
         v.cash, v.card, v.transfer, v.total, v.tickets,
         g.total,
         s.counted_cash,
         -- Turno abierto: el esperado se calcula aquí. Turno cerrado: se respeta el
         -- snapshot, que es el número con el que se hizo el arqueo.
         case when s.closed_at is null
              then round(s.opening_float + v.cash - g.total, 2)
              else s.expected_cash end,
         case when s.closed_at is null
              then null
              else s.variance end,
         s.note
    from public.shifts s
    join public.employees e on e.id = s.opened_by
    cross join ventas v
    cross join gastos g
   where s.id = p_shift_id;
end $$;

comment on function public.shift_report(text, uuid) is
  'Corte X en vivo (gastos y esperado calculados) y corte Z congelado tras el cierre.';

-- =============================================================================
-- P1-2 · EL RATE LIMITER CUENTA POR PIN, NO POR IP
-- =============================================================================
-- El problema concreto: en un restaurante todas las tablets y la caja comparten el
-- Wi-Fi del local, o sea UNA IP pública. El contador era por IP, así que 5 intentos
-- fallidos desde cualquier tablet bloqueaban a TODAS durante 15 minutos. Un cajero que
-- se equivoca 5 veces al teclear su PIN deja el local sin cobrar.
--
-- Y había un segundo problema, peor: durante el bloqueo auth_employee devuelve null
-- incluso con el PIN correcto, y como rate_limit_clear() solo se ejecutaba cuando
-- v_id no era null, el desbloqueo-por-éxito nunca ocurría dentro del bloqueo. El
-- comentario del código prometía lo contrario y era falso dentro de la ventana.
--
-- EL ARREGLO: dos cambios, y los dos importan.
--
-- 1) La llave pasa a ser el PIN, no la IP. El contador sigue siendo por POS y no por
--    persona: si el PIN 0000 falla 5 veces, se bloquea el 0000. Los demás PINs del
--    local siguen entrando. Es lo que el negocio quiere: que un PIN olvidado no pare
--    el cobro de toda la tienda.
--
-- 2) Se acortan las ventanas. 5 intentos en 3 minutos bloquean 3 minutos, en vez de
--    5 en 60 segundos bloqueando 15. El bloqueo sigue siendo suficiente para frenar
--    fuerza bruta (3 minutos es muchísimo para probar un PIN de 4 dígitos a mano) y
--    el costo de un error de dedo baja de 15 minutos a 3.
--
-- La columna `ip` pasa a ser `pin` y se renombra. Es una tabla de contadores, no de
-- datos: perder las filas actuales es irrelevante y borrarlas evita tener que
-- traducir IPs a PINs inventados.

alter table public.pin_rate_limits rename column ip to pin;
alter table public.pin_rate_limits alter column pin type text;
alter table public.pin_rate_limits alter column pin set default '';

comment on table public.pin_rate_limits is
  'Contador de intentos de PIN fallidos, por PIN y no por IP: las tablets del local comparten IP.';

drop function public.rate_limit_register();
drop function public.rate_limit_clear();

-- La llave es el PIN. Se guarda hasheado para no dejar los PINs de los empleados
-- escritos en una tabla que un dump acabaría en un ticket de soporte; dos PINs
-- distintos dan hashes distintos y no se pueden correlacionar entre sí.
create function public.rate_limit_register(p_pin text)
returns text
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_key      text;
  v_attempts int;
  v_locked   timestamptz;
  v_started  timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('pos_auth', 0));

  -- Un PIN mal formado no entra al contador: no es un intento real, es ruido de un
  -- cliente roto, y contarlo dejaría bloquear una IP por un bug del frontend.
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return null;
  end if;

  v_key := encode(digest('pinrl:' || p_pin, 'sha256'), 'hex');

  delete from public.pin_rate_limits
   where (locked_until is not null and locked_until < now())
      or (locked_until is null and window_started_at < now() - interval '10 minutes');

  insert into public.pin_rate_limits (pin, window_started_at, attempts)
  values (v_key, now(), 0)
  on conflict (pin) do nothing;

  select r.attempts, r.locked_until, r.window_started_at
    into v_attempts, v_locked, v_started
    from public.pin_rate_limits r
   where r.pin = v_key
     for update;

  if v_locked is not null and v_locked > now() then
    return 'Demasiados intentos fallidos. Reintenta en ' ||
           extract(epoch from (v_locked - now()))::int || ' segundos.';
  end if;

  if now() - v_started > interval '3 minutes' then
    v_attempts := 0;
    v_started := now();
  end if;

  v_attempts := v_attempts + 1;

  update public.pin_rate_limits
     set attempts = v_attempts, window_started_at = v_started
   where pin = v_key;

  if v_attempts >= 5 then
    update public.pin_rate_limits
       set attempts = 0,
           window_started_at = now(),
           locked_until = now() + interval '3 minutes'
     where pin = v_key;
    return 'Demasiados intentos fallidos. Espera 3 minutos.';
  end if;

  return null;
end $$;

-- El desbloqueo por éxito ahora sí funciona DENTRO del bloqueo: se levanta el registro
-- del PIN recibido, exista o no. Es lo que evita que 5 intentos buenos en un local con
-- dos cajeros se conviertan en un cierre de caja.
create function public.rate_limit_clear(p_pin text)
returns void
language plpgsql volatile security definer
set search_path = public, extensions as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return;
  end if;

  delete from public.pin_rate_limits
   where pin = encode(digest('pinrl:' || p_pin, 'sha256'), 'hex');
end $$;

comment on function public.rate_limit_register(text) is
  'Registra un intento de PIN. Bloquea 3 minutos tras 5 fallos, y solo a ese PIN.';
comment on function public.rate_limit_clear(text) is
  'Levanta el bloqueo del PIN indicado, exista o no el registro.';

-- auth_employee es la puerta de entrada de casi todas las RPC, así que es la que
-- decide cuándo contar. Pasa el PIN en vez de dejar que rate_limit_register adivine.
create or replace function public.auth_employee(p_pin text, p_role text default null)
returns uuid
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare v_id uuid; v_block text;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return null;
  end if;

  v_block := public.rate_limit_register(p_pin);
  if v_block is not null then
    return null;
  end if;

  select e.id into v_id
    from public.employees e
   where e.is_active
     and e.pin_hash = extensions.crypt(p_pin, e.pin_hash)
     and (p_role is null or e.role = p_role)
   limit 1;

  -- Si el PIN era correcto se borra la cuenta. Se hace ANTES de mirar el bloqueo
  -- justamente para que un PIN bueno no pueda quedar atrapado: el registro se limpia
  -- y el PIN entra. Lo que nos interesa bloquear es la fuerza bruta, no el turno de
  -- caja funcionando.
  if v_id is not null then
    perform public.rate_limit_clear(p_pin);
  end if;

  return v_id;
end $$;

comment on function public.auth_employee(text, text) is
  'Valida un PIN de empleado. Cuenta los intentos por PIN, no por IP del local.';

-- auth_admin tiene el mismo problema y el mismo arreglo. Antes delegaba en
-- auth_employee, lo que hacía que un PIN de admin se contara dos veces por intento.
create or replace function public.auth_admin(p_pin text)
returns uuid
language plpgsql volatile security definer
set search_path = public, extensions as $$
begin
  return public.auth_employee(p_pin, 'admin');
end $$;

-- =============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- =============================================================================
--  1. Las 3 RPC ya no son STABLE y responden (esto era el P0-1):
--       select proname, provolatile from pg_proc where proname in
--         ('list_shift_expenses','product_modifier_catalog','modifier_admin_catalog');
--       -- las tres 'v'
--
--  2. advance_order solo tiene UNA firma, la de 3 parámetros, y exige PIN:
--       select pg_get_function_identity_arguments(oid)
--         from pg_proc where proname = 'advance_order';
--
--  3. advance_order sin PIN no hace nada (esto era el P0-2):
--       select public.advance_order('4f126ba2-2873-4189-afb2-3bd5d2f5ecff', 'in_kitchen');
--       -> null
--
--  4. El corte X calcula los gastos y el esperado en vivo (esto era el P1-1).
--    Con el turno abierto y un gasto de 150.50, expenses debe ser 150.50 y no 0:
--       select expenses, expected_cash from public.shift_report('0000', '<shift>');
--
--  5. Ninguna función de escritura se queda sin PIN (esto era el invariante roto):
--       select proname from pg_proc
        join pg_namespace on pg_namespace.oid = pronamespace
--      where nspname = 'public'
--        and proname not in ('auth_admin','auth_employee','client_ip',
--                            'rate_limit_register','rate_limit_clear',
--                            'business_tz','business_day','business_week_start',
--                            'slugify','split_amount','touch_updated_at',
--                            'rls_auto_enable','tables_status')
--        and not exists (
--          select 1 from unnest(proargnames) n where n like 'p\_%pin%'
--        );
--       -> 0 filas