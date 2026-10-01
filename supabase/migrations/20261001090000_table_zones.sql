-- =============================================================================
-- 20261001090000_table_zones.sql
-- Zonas del salón: agrupar las mesas en bloques con nombre
-- =============================================================================
-- QUÉ FALTA Y POR QUÉ
--
-- El mapa del salón es un lienzo libre: cada mesa tiene su pos_x/pos_y y se arrastra
-- donde uno quiera. Eso funciona bien para decidir dónde va cada mesa, pero deja al cajero
-- sin una noción de "salón". En cuanto hay más de unas seis mesas, la pregunta que
-- aparece es "¿cuáles están en la fila de la ventana?", y la respuesta llega contando
-- posiciones sobre el lienzo.
--
-- Una zona es un nombre aplicado a un grupo de mesas: "Bloque A", "Terraza", "Barra".
-- Solo agrupa y etiqueta. NO cambia la posición de nada ni restringe el arrastre: el
-- lienzo sigue siendo libre y la zona es una capa de lectura encima.
--
-- POR QUÉ ES UNA COLUMNA Y NO UN AGRUPAMIENTO DERIVADO
--
-- Se podría deducir la zona de las coordenadas agrupando las mesas que quedan cerca,
-- pero eso se rompe en cuanto el administrador mueve una mesa medio metro: la mesa se
-- saltaría de bloque sin que nadie lo haya decidido. El nombre de la zona tiene que ser
-- una decisión guardada, no un cálculo sobre posiciones que el mismo usuario puede
-- cambiar arrastrando.
--
-- NULL ES UN VALOR LEGÍTIMO, NO UN FALLO
--
-- Las mesas virtuales (Barra y Para llevar) NO llevan zona: no ocupan un lugar del
-- salón, son un número que agrupa órdenes. Y una mesa real que aún no tiene zona
-- asignada debe poder existir sin ella. Por eso la columna admite NULL y el mapa dibuja
-- los bloques solo donde los hay.
--
-- LA SEMILLA
--
-- El salón actual ya es una retícula de dos filas: la de arriba (y≈25) con las mesas
-- 1 a 5, y la de abajo (y≈60) con las 6 a la 10. Se nombran Bloque A y Bloque B porque
-- el negocio los entiende de oídas. Es un punto de partida editable: cambiar "Bloque B"
-- por "Terraza" es un UPDATE de una fila.
-- =============================================================================

alter table public.restaurant_tables
  add column zone text
    check (zone is null or btrim(zone) <> '');

comment on column public.restaurant_tables.zone is
  'Nombre del bloque o zona del salón. NULL = sin zona; no es lo mismo que vacío.';

-- Índice parcial: solo entran las mesas que sí tienen zona. Con diez mesas da igual,
-- pero el mapa agrupa por esta columna en cada render, y no tiene sentido que el índice
-- cargue también las filas que no aportan nada al agrupamiento.
create index restaurant_tables_zone_idx
  on public.restaurant_tables (zone)
  where zone is not null;

-- =============================================================================
-- Semilla: los dos bloques que ya existen en el layout
-- =============================================================================
-- Se decide por la posición y no por el número para que la asignación siga siendo
-- cierta: si después se renumera una mesa, su zona no debería cambiar sola. La condición
-- usa rangos y no valores exactos porque las posiciones se arrastran a mano, y 25
-- frente a 25.11 es ruido de dedo, no dos filas distintas.

update public.restaurant_tables
   set zone = case
     when pos_y < 45 then 'Bloque A'
     else 'Bloque B'
   end
 where number not in (0, 999)
   and is_active;

-- =============================================================================
-- save_table: la zona se edita junto con el resto
-- =============================================================================
-- p_zone va AL FINAL de la lista de parámetros, y no es arbitrario: en PostgreSQL un
-- parámetro con DEFAULT ya no puede estar seguido de otro sin DEFAULT (error 42P13), así
-- que cualquier parámetro nuevo tiene que ir después del último que ya tenga default.
--
-- Es un caso "texto que puede no existir" disfrazado de campo normal: si el administrador
-- no toca el campo llega la cadena vacía, y vacía se guarda como NULL, que significa
-- "sin zona". Guardarla como texto en blanco produciría un bloque vacío dibujado en el
-- mapa y sin ninguna mesa adentro.

create or replace function public.save_table(
  p_admin_pin text,
  p_number    integer,
  p_table_id  uuid default null,
  p_label     text default null,
  p_seats     integer default 4,
  p_shape     text default 'square',
  p_pos_x     numeric default 50,
  p_pos_y     numeric default 50,
  p_is_active boolean default true,
  p_zone      text default null
)
returns uuid
language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_admin uuid;
  v_id    uuid;
  v_zone  text;
begin
  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return null;
  end if;

  if p_number is null or p_number < 0 or p_number > 999 then
    raise exception 'El número de mesa debe estar entre 0 y 999' using errcode = '22023';
  end if;
  if p_shape not in ('square','round','rect') then
    raise exception 'Forma no válida' using errcode = '22023';
  end if;
  if p_seats is null or p_seats < 0 then
    raise exception 'La capacidad no puede ser negativa' using errcode = '22023';
  end if;
  if p_pos_x < 0 or p_pos_x > 100 or p_pos_y < 0 or p_pos_y > 100 then
    raise exception 'La mesa se salió del salón' using errcode = '22023';
  end if;

  v_zone := nullif(btrim(coalesce(p_zone, '')), '');

  if p_table_id is null then
    insert into public.restaurant_tables (number, label, seats, shape, pos_x, pos_y, is_active, zone)
    values (p_number, coalesce(nullif(btrim(p_label), ''), 'Mesa ' || p_number),
            greatest(p_seats, 1), p_shape, p_pos_x, p_pos_y, p_is_active, v_zone)
    returning id into v_id;
  else
    update public.restaurant_tables
       set number = p_number,
           label = coalesce(nullif(btrim(p_label), ''), label),
           seats = p_seats,
           shape = p_shape,
           pos_x = p_pos_x,
           pos_y = p_pos_y,
           is_active = p_is_active,
           zone = v_zone
     where id = p_table_id
    returning id into v_id;

    if v_id is null then
      raise exception 'La mesa ya no existe' using errcode = 'P0001';
    end if;
  end if;

  return v_id;
end $$;

comment on function public.save_table(text, integer, uuid, text, integer, text, numeric, numeric, boolean, text) is
  'Crea o actualiza una mesa. p_zone va al final porque PostgreSQL no admite un parámetro con DEFAULT seguido de otro sin DEFAULT (42P13).';

-- La firma de 9 parámetros sigue existiendo después del CREATE OR REPLACE (una
-- sobrecarga es una función distinta, no una versión nueva). Con las dos Alive,
-- PostgREST puede resolver la llamada de forma ambigua y la de 9 argumentos
-- aceptaría la llamada omitiendo p_zone en SILENCIO: el cliente creería estar
-- guardando la zona y no se guardaría. Se retira la vieja en vez de dejarla.
--
-- Solo es seguro porque save_table tiene un único call-site (useTableStore.js), que
-- se actualiza a enviar p_zone siempre.
drop function public.save_table(text, integer, uuid, text, integer, text, numeric, numeric, boolean);

-- =============================================================================
-- tables_status: que devuelva la zona
-- =============================================================================
-- Esta es la lectura que usa el mapa (useTableStore.fetchTables → supabase.rpc
-- 'tables_status'). No lleva PIN: cualquiera que abra el mapa ya ve el salón, igual
-- que los estados libre/ocupada/cobrando, que tampoco los pide.
--
-- Se dropea y se vuelve a crear porque el tipo de retorno cambia de verdad: se le
-- agrega una columna. CREATE OR REPLACE no puede alterar el tipo de retorno de una
-- función que ya existe, y omitir el DROP es el error 42P13.
--
-- La zona de las virtuales se anula AQUÍ y no en el cliente, para que la regla no
-- dependa de que cada renderer se acuerde de excluir a Barra y Para llevar.
--
-- De STABLE a VOLATILE: el cambio no es por los datos, sino porque un VOLATILE no
-- promete un resultado estable y es lo que corresponde cuando la función se apoya en
-- un LEFT JOIN agregado. tables_status ya se volátil de facto en cuanto se abre una
-- orden; declararlo stably solo hacía que el planificador tuviera menos información.

drop function public.tables_status();

create or replace function public.tables_status()
returns table (
  table_id uuid, number integer, label text, seats integer, shape text,
  pos_x numeric, pos_y numeric, zone text, sort_order integer, is_virtual boolean,
  state text, open_orders integer, amount_due numeric, customer_names text
)
language plpgsql volatile security definer
set search_path = public as $$
begin
  return query
  select t.id,
         t.number,
         nullif(btrim(t.label), ''),
         t.seats,
         t.shape,
         t.pos_x,
         t.pos_y,
         case when t.number in (0, 999) then null else nullif(btrim(t.zone), '') end,
         t.sort_order,
         (t.number in (0, 999)),
         case
           when count(*) filter (where o.status in ('pending','in_kitchen','ready')) > 0
             then 'busy'
           when count(*) filter (where o.status in ('served','partially_paid')) > 0
             then 'billing'
           else 'free'
         end,
         count(o.id)::int,
         coalesce(sum(o.total - coalesce(o.paid_total, 0))
                  filter (where o.status <> 'cancelled'), 0),
         nullif(string_agg(distinct coalesce(o.customer_name, ''), ', ')
                  filter (where o.customer_name is not null
                            and btrim(coalesce(o.customer_name, '')) <> ''
                            and o.status <> 'cancelled'), '')
    from public.restaurant_tables t
    left join public.orders o
      on o.table_number = t.number
     and o.status not in ('completed','cancelled')
   where t.is_active
   group by t.id
   order by t.sort_order, t.number;
end $$;

comment on function public.tables_status() is
  'Mapa del salón con la zona de cada mesa. Sin PIN: cualquiera que abra el mapa ya ve el salón.';

-- move_table NO se toca, y eso es deliberado: solo mueve. Si tocara la zona, arrastrar
-- una mesa un centímetro sería capaz de cambiarle el bloque, que es justo el bug que una
-- columna guardada evita. El comentario está para que el silencio se lea como decisión.

comment on function public.move_table(text, uuid, numeric, numeric) is
  'Mueve una mesa. No toca zone: la zona es una decisión guardada, no un cálculo sobre la posición.';

revoke all on function public.save_table(text, integer, uuid, text, integer, text, numeric, numeric, boolean, text) from public, authenticated;
grant execute on function public.save_table(text, integer, uuid, text, integer, text, numeric, numeric, boolean, text) to anon;

-- =============================================================================
-- Verificación post-migración
-- =============================================================================
--  1. Las mesas reales quedaron en dos bloques y las virtuales sin zona:
--       select number, label, pos_y, zone, is_virtual from public.tables_status();
--
--  2. save_table tiene UNA sola firma, la de 10 parámetros:
--       select pg_get_function_identity_arguments(oid)
--         from pg_proc where proname = 'save_table';
--
--  3. Guardar con la zona en blanco la deja en NULL, no en '':
--       select zone from public.save_table('1234', 1,
--         (select id from public.restaurant_tables where number = 1));
--       -> NULL
--
--  4. move_table NO menciona la zona, para que arrastrar no reasigne bloques:
--       select prosrc from pg_proc where proname = 'move_table';