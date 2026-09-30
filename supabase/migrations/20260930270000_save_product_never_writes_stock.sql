-- =============================================================================
-- save_product: al actualizar, NUNCA escribe stock
-- =============================================================================
-- Intenté cerrarlo con una guarda condicional: "si el payload trae stock, lo escribe;
-- si no, no lo hace". La guarda respetaba la intención del cliente, no la intención del
-- sistema: un cliente hostil simplemente manda el campo y el stock se escribe igual.
-- Verificado: save_product con stock = 9999 dejó el producto en 9999.
--
-- La regla no puede depender del payload. Al actualizar, el stock no se toca, punto. El
-- inventario se mueve solo por:
--
--   · set_stock   -> conteo físico, fija el número absoluto
--   · adjust_stock -> merma o entrada de mercancía, mueve por delta
--
-- y las dos escriben en stock_movements, así que no queda ningún cambio de existencias
-- sin motivo registrado.
--
-- En ALTA el stock sí se acepta, porque ahí es el conteo inicial de lo que se puso en el
-- refri y el producto no existía antes: no hay ningún número previo que se pueda pisar.
-- =============================================================================

create or replace function public.save_product(p_admin_pin text, p_product jsonb)
returns uuid language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_admin uuid;
  v_id    uuid;
  v_name  text;
begin
  v_admin := public.auth_admin(p_admin_pin);
  if v_admin is null then
    return null;
  end if;

  v_name := btrim(coalesce(p_product->>'name', ''));
  if length(v_name) = 0 then
    raise exception 'El nombre es obligatorio' using errcode = '22023';
  end if;
  if coalesce((p_product->>'price')::numeric, -1) < 0 then
    raise exception 'El precio no puede ser negativo' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_product->>'category', ''))) = 0 then
    raise exception 'La categoría es obligatoria' using errcode = '22023';
  end if;
  if coalesce((p_product->>'low_stock_threshold')::int, 0) < 0 then
    raise exception 'El umbral no puede ser negativo' using errcode = '22023';
  end if;

  perform public.rate_limit_clear();

  v_id := nullif(p_product->>'id', '')::uuid;

  if v_id is null then
    insert into public.products (
      slug, name, price, category, is_active, tracks_stock,
      stock, low_stock_threshold, image_url, sort_order
    ) values (
      public.slugify(v_name),
      v_name,
      (p_product->>'price')::numeric,
      btrim(p_product->>'category'),
      coalesce((p_product->>'is_active')::boolean, true),
      coalesce((p_product->>'tracks_stock')::boolean, false),
      greatest(coalesce((p_product->>'stock')::int, 0), 0),
      coalesce((p_product->>'low_stock_threshold')::int, 0),
      nullif(btrim(coalesce(p_product->>'image_url', '')), ''),
      coalesce((p_product->>'sort_order')::int, 0)
    ) returning id into v_id;
  else
    -- No hay columna stock en este UPDATE, a propósito. Cualquier variante del tipo
    -- "si viene, escríbelo" depende de lo que mande el cliente.
    update public.products set
      name                = v_name,
      price               = (p_product->>'price')::numeric,
      category            = btrim(p_product->>'category'),
      is_active           = coalesce((p_product->>'is_active')::boolean, is_active),
      tracks_stock        = coalesce((p_product->>'tracks_stock')::boolean, tracks_stock),
      low_stock_threshold = coalesce((p_product->>'low_stock_threshold')::int, low_stock_threshold),
      image_url           = nullif(btrim(coalesce(p_product->>'image_url', image_url)), ''),
      sort_order          = coalesce((p_product->>'sort_order')::int, sort_order)
    where id = v_id;
    if not found then
      raise exception 'El producto no existe' using errcode = '22023';
    end if;
  end if;

  return v_id;
end $$;

revoke all on function public.save_product(text, jsonb) from public, authenticated;
grant execute on function public.save_product(text, jsonb) to anon;
