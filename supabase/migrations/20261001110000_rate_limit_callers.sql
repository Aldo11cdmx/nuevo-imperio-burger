-- =============================================================================
-- 20261001110000_rate_limit_callers.sql
-- Pasa los 9 llamadores de rate_limit_* a la versión con PIN
-- =============================================================================
-- POR QUÉ ESTA MIGRACIÓN EXISTE
--
-- La anterior cambió rate_limit_register() y rate_limit_clear() para que recibieran
-- el PIN y no tuvieran que deducirlo. Eso rompió nueve funciones que las llamaban sin
-- argumento, y lo rompió de la forma más insidiosa: open_shift devolvía
--
--   404  function public.rate_limit_clear() does not exist
--
-- o sea, TODA la apertura de caja dejó de funcionar. No salió ningún aviso al
-- desplegar: la migración aplicó bien porque cada `drop function` era válido, y el
-- error apareció después, en la primera caja del día.
--
-- POR QUÉ NO SE ESCRIBEN LAS NUEVE FUNCIONES A MANO
--
-- Son funciones largas —save_product y login_with_pin tienen treinta líneas cada una—
-- y copiarlas a mano es la forma más rápida de introducir un error que no se nota
-- hasta que alguien cobra mal. En vez de eso se reescriben solas: este bloque lee el
-- cuerpo real de cada una de pg_proc, le quita o le cambia la llamada exacta, y vuelve
-- a crearla con sus mismos atributos. Lo que se compara es el texto que Postgres
-- tiene guardado, no una transcripción.
--
-- -----------------------------------------------------------------------------
-- LAS DOS CLASES DE LLAMADOR, Y POR QUÉ NO SE TRATAN IGUAL
-- -----------------------------------------------------------------------------
-- login_with_pin: la llamada SE QUEDA, y se le pasa p_pin.
--
-- Es el único punto del sistema donde el rate limiter se usa sin que haya un
-- auth_employee detrás. El login es justamente el lugar donde se cuentan los intentos,
-- porque es el único momento en que alguien puede equivocar el PIN sin haber entrado
-- todavía a sesión. Si se quitara la llamada, el PIN quedaría sin límite de intentos y
-- se podría probar a fuerza bruta contra el hash.
--
-- Los otros ocho: la llamada SE QUITA, porque ya no hace nada.
--
-- Las ocho primero validan el PIN con auth_admin o auth_employee, y si eso falla
-- hacen `return` antes de llegar a la línea del clear. O sea: la línea solo se alcanzaba
-- con un PIN válido, y en ese caso auth_employee ya llamó a rate_limit_clear(p_pin) con
-- ese mismo PIN. Limpiaba dos veces lo mismo. Antes parecía que el segundo clear
-- limpiaba "por si acaso"; en realidad depended del orden dentro de auth_employee, que
-- se puede refactorizar sin que nadie lo note y romper el desbloqueo de un PIN.
--
-- La lista de los ocho, con el PIN que usan, para que se pueda revisar sin leer el
-- bloque de abajo:
--
--   adjust_stock        p_admin_pin      list_employees     p_admin_pin
--   create_employee     p_admin_pin      open_shift         p_pin
--   list_all_products   p_admin_pin      save_product       p_admin_pin
--   set_stock           p_admin_pin      toggle_employee    p_admin_pin
--
-- OJO con create_employee: tiene DOS parámetros de PIN. p_admin_pin es el del operador
-- que está creando a alguien, y p_pin es el PIN NUEVO del empleado que se está dando de
-- alta. La línea se quita en vez de cambiarse justamente para no borrar el contador del
-- PIN equivocado: si se hubiera cambiado a p_pin, el primer intento de un empleado
-- recién creado borraría su propio contador y el de su jefe se quedaría intacto.
--
-- -----------------------------------------------------------------------------
-- LA COMPROBACIÓN
-- -----------------------------------------------------------------------------
-- Al final se verifica que no quede ninguna llamada sin argumento. Si alguien vuelve a
-- llamar a rate_limit_clear() a secas, esta consulta devuelve filas y es el momento de
-- verlas, antes de que las descubra un cajero a las 8 de la mañana.
-- =============================================================================

do $do$
declare
  r          record;
  v_src      text;
  v_params   text;
  v_returns  text;
  v_sp       text;
  v_sql      text;
  v_fuera    int := 0;
begin
  for r in
    select p.oid,
           p.proname,
           p.prosrc,
           pg_get_function_arguments(p.oid)      as params,
           pg_get_function_result(p.oid)         as returns,
           p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       -- login_with_pin conserva las llamadas: es el login, ahí sí se cuentan intentos.
       and p.proname = 'login_with_pin'
       -- Misma guarda que la de los ocho, para que aplicar dos veces la migración no
       -- intente "arreglar" una función ya corregida y reviente con la excepción.
       and p.prosrc like '%rate_limit_clear()%'
    union all
    select p.oid,
           p.proname,
           p.prosrc,
           pg_get_function_arguments(p.oid),
           pg_get_function_result(p.oid),
           p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('adjust_stock', 'create_employee', 'list_all_products',
                         'list_employees', 'open_shift', 'save_product',
                         'set_stock', 'toggle_employee')
       -- Se filtran las que ya用的是 versión con PIN, para que el bloque sea
       -- idempotente: aplicarlo dos veces no debe volver a tocar lo ya arreglado.
       and p.prosrc like '%rate_limit_clear()%'
  loop
    if r.proname = 'login_with_pin' then
      v_src := replace(r.prosrc, 'public.rate_limit_register()', 'public.rate_limit_register(p_pin)');
      v_src := replace(v_src,     'public.rate_limit_clear()',    'public.rate_limit_clear(p_pin)');
    else
      -- Se quita la línea entera junto con el espacio en blanco que la precede, para no
      -- dejar una línea en blanco en medio del cuerpo. Como se borra el blanco de después
      -- de la instrucción anterior, esa instrucción conserva su salto de línea y el
      -- cuerpo no se descuadra.
      --
      -- El patrón va entre comillas simples y sin barras invertidas a propósito. En un
      -- literal E'' los escapes \( y \) pierden la barra, se convierten en paréntesis
      -- desnudos y el patrón deja de coincidir en silencio -- que es justo lo que pasó la
      -- primera vez que se corrió esto. Con corchetes [.] y [(][)] no hay nada que
      -- escapar.
      v_src := regexp_replace(
                 r.prosrc,
                 '[[:space:]]+perform[[:space:]]+public[.]rate_limit_clear[(][)];',
                 '',
                 'g'
               );
    end if;

    if v_src = r.prosrc then
      raise exception 'No se encontró la llamada a rate_limit en %', r.proname;
    end if;

    -- El search_path se lee del propio catálogo en vez de fijarlo a mano, para que si
    -- alguna función tuviera uno distinto no se le cambie sin querer.
    select coalesce(
             (select unnest(p.proconfig)::text),
             'search_path=public, extensions'
           )
      into v_sp
      from pg_proc p
     where p.oid = r.oid;

    v_sp := replace(v_sp, 'search_path=', '');

    v_params  := r.params;
    v_returns := r.returns;

    v_sql := format(
      'create or replace function public.%I(%s) returns %s language plpgsql volatile security definer set search_path = %s as $fn$%s$fn$',
      r.proname, v_params, v_returns, v_sp, v_src
    );

    execute v_sql;
  end loop;

  -- Si alguna de las funciones era STABLE o IMMUTABLE, este bloque las habría
  -- recreated como VOLATILE sin querer. Se comprueba y se avisa.
  select count(*) into v_fuera
    from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('login_with_pin', 'adjust_stock', 'create_employee',
                       'list_all_products', 'list_employees', 'open_shift',
                       'save_product', 'set_stock', 'toggle_employee')
     and p.provolatile <> 'v';

  if v_fuera > 0 then
    raise exception 'Se esperaba que las 9 fueran VOLATILE y % no lo son', v_fuera;
  end if;
end $do$;

comment on function public.login_with_pin(text) is
  'Login por PIN. Es el unico punto donde el rate limiter corre sin auth_employee detras, asi que es el que cuenta los intentos de verdad.';

-- =============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- =============================================================================
--  1. No queda ninguna llamada sin argumento (esto era el 404 de open_shift):
--       select proname from pg_proc
--        join pg_namespace on pg_namespace.oid = pronamespace
--       where nspname = 'public' and prosrc ~ 'rate_limit_(clear|register)\(\)';
--       -> 0 filas
--
--  2. Las nueve siguen siendo VOLATILE y SECURITY DEFINER:
--       select proname, provolatile, prosecdef from pg_proc
--        join pg_namespace on pg_namespace.oid = pronamespace
--       where nspname = 'public'
--         and proname in ('login_with_pin','adjust_stock','create_employee',
--                          'list_all_products','list_employees','open_shift',
--                          'save_product','set_stock','toggle_employee');
--
--  3. La caja abre (esto es lo que se rompió):
--       select public.open_shift('0000', 500);