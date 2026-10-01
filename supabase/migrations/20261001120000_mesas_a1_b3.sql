-- =============================================================================
-- 20261001120000_mesas_a1_b3.sql
-- El salón real es de 6 mesas: A1, A2, A3 en un bloque y B1, B2, B3 en otro.
-- =============================================================================
-- QUÉ CAMBIA
--
-- El layout que había en la base era un salón de 10 mesas numeradas 1..10 y partida
-- en "Bloque A" (1-5) y "Bloque B" (6-10), de las cuales 4 ya estaban desactivadas.
-- El local no es ese: son dos filas de tres. Se deja el salón como es de verdad.
--
--   Bloque A:  A1  A2  A3
--   Bloque B:  B1  B2  B3
--
-- Las mesas 4, 5, 8 y 9 no existen en el local, así que se BORRAN y no se desactivan.
-- Desactivarlas habría dejado cuatro filas muertas en el editor de layout que alguien
-- iba a volver a activar sin querer creyendo que eran mesas que faltaban.
--
-- POR QUÉ SE RENUMERAN A 1..6 Y NO SE DEJA 1,2,3,6,7,10
--
-- El panel de Administración muestra el número junto al nombre (#6 · 4 lug.). Con los
-- números originales, la mesa A1 aparecía como "#1" pero B1 como "#6" y B3 como "#10",
-- o sea que el número ya no significaba nada y solo servía para confundir. Como no hay
-- una sola venta registrada, no hay historial que ata un número a algo: renumerar no
-- puede descuadrar nada.
--
-- El renumerado va DE MENOR A MAYOR (6, luego 7, luego 10) porque `number` es UNIQUE y
-- el destino siempre tiene que estar libre antes del movimiento. 6 se corre a 4 antes
-- de que 10 intente ocupar el 6; al revés, el 10 revienta la restricción a medio
-- camino y la migración entera se deshace.
--
-- Las mesas virtuales 0 (Barra) y 999 (Para llevar) se conservan tal cual: su número
-- está cableado en el código (TAKEAWAY_TABLE en useCartStore) y tables_status anula
-- la zona justamente para esos dos números.
--
-- -----------------------------------------------------------------------------
-- LAS POSICIONES
-- -----------------------------------------------------------------------------
-- Tres columnas en 20 / 50 / 80 y dos filas en y=25 y y=60.
--
-- Con las tres mesas de una zona en la misma fila, el bloque que dibuja TableMap sale
-- con 32% de alto (BLOCK_PAD_Y * 2) y no una franja de cero, así que el encabezado del
-- bloque sigue teniendo dónde caerse. Los bloques quedan en 9-41% y 44-76% de alto, y
-- las virtuales (Barra y Para llevar, en y=0 y sin zona) no se solapan con ninguno.
-- =============================================================================

-- Primero se borran las que no existen en el local. Al borrarlas aquí se liberan los
-- números 4, 5, 8 y 9, que es lo que permite el renumerado de abajo.
delete from public.restaurant_tables where number in (4, 5, 8, 9);

-- El renumerado, del número más alto al más bajo, para no chocar con la restricción
-- de unicidad a medio camino: 10 -> 6 antes de que 6 se mueva a 4.
update public.restaurant_tables set number = 4 where number = 6;
update public.restaurant_tables set number = 5 where number = 7;
update public.restaurant_tables set number = 6 where number = 10;

-- Bloque A: tres columnas en la fila de arriba.
update public.restaurant_tables set
  label = 'A1', zone = 'A', sort_order = 1, pos_x = 20, pos_y = 25, seats = 4
 where number = 1;

update public.restaurant_tables set
  label = 'A2', zone = 'A', sort_order = 2, pos_x = 50, pos_y = 25, seats = 4
 where number = 2;

update public.restaurant_tables set
  label = 'A3', zone = 'A', sort_order = 3, pos_x = 80, pos_y = 25, seats = 4
 where number = 3;

-- Bloque B: las mismas tres columnas en la fila de abajo.
update public.restaurant_tables set
  label = 'B1', zone = 'B', sort_order = 4, pos_x = 20, pos_y = 60, seats = 4
 where number = 4;

update public.restaurant_tables set
  label = 'B2', zone = 'B', sort_order = 5, pos_x = 50, pos_y = 60, seats = 4
 where number = 5;

update public.restaurant_tables set
  label = 'B3', zone = 'B', sort_order = 6, pos_x = 80, pos_y = 60, seats = 4
 where number = 6;

-- El salón tiene que quedar completo. Si algo quedó sin nombre, la migración no
-- termina en silencio y alguien se entera ahora, no el día que falte una mesa.
do $$
declare
  v_ok int;
begin
  select count(*) into v_ok
    from public.restaurant_tables
   where number in (1, 2, 3, 4, 5, 6)
     and label in ('A1', 'A2', 'A3', 'B1', 'B2', 'B3')
     and zone in ('A', 'B')
     and is_active;

  if v_ok <> 6 then
    raise exception 'El salón quedó con % mesas de las 6 esperadas', v_ok;
  end if;

  if (select count(*) from public.restaurant_tables where number in (0, 999)) <> 2 then
    raise exception 'Las mesas virtuales 0 y 999 no quedaron';
  end if;
end $$;
