-- =============================================================================
-- Fix 7.1.a — split_amount repartía mal los centavos
-- =============================================================================
-- El bug: v_remainder estaba expresado en PESOS y se comparaba contra el índice
-- de la fila (1, 2, 3...). Como 0.02 < 1, la condición `v_i <= v_remainder` era
-- falsa siempre y ningún pago recibía el centavo extra.
--
--   split_amount(485, 3) devolvía 161.66 + 161.66 + 161.66 = 484.98
--
-- Eso es peor que dar un centavo de más: el sistema se QUEDABA con dos centavos
-- en cada cuenta dividida, y como add_payment liquida al llegar a total - 0.01,
-- la orden quedaba pagada con dos centavos menos de lo que el cliente debía.
-- Un corte Z no volvería a cuadrar.
--
-- El arreglo es trabajar en CENTAVOS enteros de punta a punta. Dividir en pesos
-- y después intentar recuperar el resto con un +0.01 es donde se pierde la
-- exactitud; sobre enteros no hay error de redondeo que acumular.
-- =============================================================================

create or replace function public.split_amount(p_total numeric, p_parts int)
returns table (part_no int, amount numeric)
language plpgsql immutable
set search_path = public as $$
declare
  v_total_cents      numeric;
  v_base_cents       numeric;
  v_remainder_cents  numeric;
  v_i                int;
begin
  if p_parts is null or p_parts < 1 then
    raise exception 'La cuenta se divide entre una o más personas' using errcode = '22023';
  end if;
  if p_total is null or p_total <= 0 then
    raise exception 'El total debe ser mayor a cero' using errcode = '22023';
  end if;

  -- Todo el reparto ocurre en centavos enteros. v_base_cents es el piso y
  -- v_remainder_cents son los centavos que sobran (siempre < p_parts).
  v_total_cents     := round(p_total * 100);
  v_base_cents      := trunc(v_total_cents / p_parts);
  v_remainder_cents := v_total_cents - v_base_cents * p_parts;

  -- Los primeros v_remainder_cents pagos reciben un centavo extra. Repartirlos
  -- entre los primeros (y no cargarle el ajuste al último) hace que la
  -- diferencia máxima entre dos personas sea un centavo.
  for v_i in 1..p_parts loop
    return query
      select v_i,
             (v_base_cents + case when v_i <= v_remainder_cents then 1 else 0 end) / 100;
  end loop;
end $$;

comment on function public.split_amount(numeric, int) is
  'Reparte un total entre n partes en centavos enteros. Los centavos sobrantes van a los primeros pagos. La suma es exactamente p_total.';

revoke all on function public.split_amount(numeric, int) from public, authenticated;
grant execute on function public.split_amount(numeric, int) to anon;