-- =============================================================================
-- Fase 3 — Cierre de la escritura directa
-- =============================================================================
-- El POS y la cocina ya hablan solo por RPC (verificado: no queda ningún .insert(),
-- .update() ni .delete() sobre orders u order_items en el cliente). A partir de aquí
-- anon no puede escribir en órdenes por la puerta de atrás.
--
-- Motivo de fondo: con INSERT y UPDATE abiertos, la llave anon que viaja en el bundle
-- permitía poner total = 0 en una orden cobrada, marcarla completed sin payment_method,
-- o fabricar la venta de un producto que nunca existió. Las RPC cierran eso porque
-- calculan el total desde products.price y exigen turno, PIN y transición válida.
--
-- Verificado contra anon tras aplicar: INSERT y UPDATE sobre orders y order_items
-- devuelven HTTP 401 / 42501 "permission denied for table". SELECT sigue en 200.
-- =============================================================================

-- ---------- órdenes ----------
revoke insert, update, delete on table public.orders from anon, authenticated;
revoke insert, update, delete on table public.order_items from anon, authenticated;

-- Se conserva solo la lectura. El POS necesita ver las órdenes abiertas y la cocina
-- necesita el tablero, así que SELECT sigue abierto para anon.
grant select on table public.orders to anon;
grant select on table public.order_items to anon;

-- ---------- políticas: se conservan SOLO las de lectura ----------
--
-- La lectura tiene que quedar explícita, y no solo por el GRANT: con RLS habilitado, sin
-- ninguna política, RLS deniega TODO y el POS se queda sin ver el tablero de cocina. Por
-- eso se recrean las de SELECT en vez de confiar en el GRANT.
--
-- INSERT/UPDATE/DELETE quedan bloqueados por el privilegio, que es la capa que realmente
-- impide escribir: RLS no protege si el rol no tiene el privilegio en la tabla.
create policy orders_select_for_reading on public.orders
  for select to anon, authenticated
  using (true);

create policy order_items_select_for_reading on public.order_items
  for select to anon, authenticated
  using (true);

-- Cualquier otra política de estas tablas sobra sin los privilegios correspondientes.
-- Se quitan para que la intención quede explícita y no se reintroduzcan con un GRANT
-- futuro.
do $$
declare pol record;
begin
  for pol in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('orders', 'order_items')
       and policyname not in ('orders_select_for_reading', 'order_items_select_for_reading')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- ---------- rls_auto_enable ----------
-- Es una función de la plataforma que habilita RLS sobre tablas. Executable por anon no
-- significa que sirva para algo útil por sí sola, pero no tiene por qué seguir siendo
-- parte del API público: se revoca por superficie, no por exploit.
--
-- El revoke va contra PUBLIC, no contra anon. El privilegio venía de PUBLIC (aclitem
-- "=X/postgres") y anon lo heredaba por ser miembro: revoke ... from anon no tenía nada
-- que quitar y el permiso seguía en pie.
revoke execute on function public.rls_auto_enable() from public;

-- =============================================================================
-- Advisor: "Public Can Execute SECURITY DEFINER Function" (WARN)
-- =============================================================================
-- Supabase marca como warning toda función SECURITY DEFINER que anon pueda invocar por
-- /rest/v1/rpc. Acá hay 17 y son intencionales: el proyecto no usa Supabase Auth, así que
-- la identidad se revalida con PIN dentro de cada función. Revocarlas rompería el POS.
--
-- Lo que hace segura a cada una no es el permiso, sino la comprobación de adentro:
--   · open_shift, close_shift, create_order, complete_order  -> auth_employee(p_pin)
--   · get_open_shifts, shift_report                          -> auth_employee(p_pin)
--   · cancel_order sobre venta cobrada                        -> auth_admin(p_admin_pin)
--   · save_product, adjust_stock, create_employee,
--     toggle_employee, list_employees, list_all_products       -> auth_admin(p_admin_pin)
--   · advance_order                                            -> no muta dinero ni precio;
--     solo mueve el estado de una orden, y rejecta saltos
--
-- La superficie se mantiene toda en el mismo sitio: no hay una función de alto privilegio
-- sin PIN en toda la base. Para confirmar que esto siga siendo cierto:
--
--   select proname, pg_get_function_identity_arguments(oid) as args
--     from pg_proc join pg_namespace on pg_namespace.oid = pronamespace
--    where nspname = 'public'
--      and proname not in ('auth_admin','auth_employee','client_ip',
--                          'rate_limit_register','rate_limit_clear','advance_order',
--                          'business_tz','slugify','touch_updated_at','rls_auto_enable')
--      and not exists (
--        select 1 from unnest(proargnames) n
--         where n like 'p\_%pin%'
--      );
--
-- Debe devolver cero filas. Si algún día devuelve algo, esa función escribe sin que nadie
-- se identifique. (rls_auto_enable queda excluida: no muta datos de negocio, y ya se le
-- revocó EXECUTE a PUBLIC justo arriba.)
-- =============================================================================
