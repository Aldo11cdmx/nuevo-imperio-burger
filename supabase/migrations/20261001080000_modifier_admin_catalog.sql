-- =============================================================================
-- 20261001080000_modifier_admin_catalog.sql
-- Catálogo de extras para la pantalla de administración
-- =============================================================================
-- QUÉ FALTA Y POR QUÉ ESTA ES UNA MIGRACIÓN NUEVA
--
-- product_modifier_catalog ya existe y devuelve los extras, pero está hecha para el POS
-- y por eso hace exactamente lo que el POS necesita y nada más:
--
--   · filtra los grupos y extras inactivos, porque un mesero no debe ver en la carta
--     un extra que el restaurante decidió dejar de ofrecer;
--   · exige PIN de EMPLEADO, no de administrador, porque capturar no administra;
--   · y se salta los grupos que no están conectados a ningún producto, porque un grupo
--     huérfano no aparece en ninguna pantalla de venta.
--
-- Eso la hace inútil para administrar. Un grupo sin productos, o un extra que se
-- desactivó la semana pasada, no se ven en ningún lado, y el administrador no puede
-- reactivarlo ni conectarlo: lo único que le queda es entrar a la consola de Supabase a
-- escribir SQL, que es exactamente el agujero que esta migración cierra.
--
-- Así que aquí va una segunda RPC, con el criterio opuesto: devuelve TODO, pide PIN de
-- ADMINISTRADOR, e incluye qué grupos tiene cada producto para que la pantalla pueda
-- pre-marcarlos.
--
-- SE PARTE EN PRODUCTO Y EN GRUPO A PROPÓSITO
--
-- El mismo detalle sirve para dos Propósitos distintos y por eso viaja en dos llaves:
--
--   'groups'         → la pantalla de extras: nombre, precio, límites, si está activo.
--   'product_groups' → la pantalla de productos: qué productos ofrecen cuáles grupos.
--
-- Meter los productos dentro de cada grupo obligaría a la pantalla de productos a
-- recorrer todos los grupos y preguntar "¿este producto está en tu lista?", y obligaría
-- a la de extras a recibir una lista de productos que no usa. Con las dos llaves
-- separadas, cada pantalla lee solo lo suyo.
-- =============================================================================

create or replace function public.modifier_admin_catalog(p_admin_pin text)
returns jsonb
language plpgsql stable security definer
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

    -- El mapa va como arreglo de objetos y no como diccionario con claves: en jsonb un
    -- objeto no garantiza el orden de sus llaves, así que la misma lista de ids podría
    -- aparecer en otro orden entre una carga y otra. Un arreglo sí conserva el orden, y
    -- con eso la pantalla de productos se ve siempre igual.
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
  'Todos los grupos y extras, incluidos inactivos y huérfanos, más el mapa de productos por grupo. Exige PIN de administrador.';

-- =============================================================================
-- Permisos
-- =============================================================================
-- Mismo patrón que el resto de las RPC: sin acceso para public/authenticated y
-- ejecutable solo por anon, que es como entra la app. La autorización real la hace
-- auth_admin sobre el PIN, dentro de la función.

revoke all on function public.modifier_admin_catalog(text) from public, authenticated;
grant execute on function public.modifier_admin_catalog(text) to anon;

-- =============================================================================
-- Verificación post-migración
-- =============================================================================
--  1. Devuelve lo mismo para un admin válido, con los inactivos dentro:
--       select jsonb_array_length(
--                (select r->'groups' from public.modifier_admin_catalog('1234') r)
--              );
--
--  2. NULL para un PIN que no es de admin, y no lanza:
--       select public.modifier_admin_catalog('0000') is null;   -- true
--
--  3. La semilla de la migración anterior debe salir con el grupo Extras y sus cuatro
--     extras, y el mapa debe traer los productos de hamburguesa, burro y taco:
--       select jsonb_pretty(public.modifier_admin_catalog('1234'));
--
--  4. El POS NO puede usarla: recibe null porque el PIN de mesero no es admin.
--       select public.modifier_admin_catalog('1234') is null;   -- true
