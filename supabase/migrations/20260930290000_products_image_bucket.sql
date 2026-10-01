-- =============================================================================
-- Bucket público para las fotos de producto
-- =============================================================================
-- products.image_url guarda una URL, no un archivo. Las tablets Android no comparten
-- sistema de archivos con el navegador de desarrollo, así que una ruta local nunca
-- llegaría al dispositivo: tiene que existir una URL en algún lado. Este bucket es ese
-- "lado".
--
-- Es público a propósito. El POS necesita LEER la imagen sin sesión: quien no ha iniciado
-- sesión igual ve el catálogo. Y aunque el bucket fuera privado, la foto de una hamburguesa
-- no es un secreto: abrirla al público no filtra nada que la carta no muestre ya.
--
-- Lo que sí se protege es ESCRIBIR. No se crea ninguna política de INSERT/UPDATE/DELETE
-- para anon ni authenticated: sin política no hay acceso, así que subir una foto exige la
-- service_role, que nunca viaja en el navegador. Lo hace la Edge Function
-- upload-product-image, que valida el PIN de admin en el servidor.
--
-- Verificado: con la anon key, un POST a /storage/v1/object/products/x.png responde 403
-- "new row violates row-level security policy".
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'products',
  'products',
  true,
  2097152,  -- 2 MB. Una foto de celular comprimida pesa menos; un video ya no es una foto.
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------------------------------
-- Políticas
-- ------------------------------------------------------------------------------------
-- Solo lectura, y explícita aunque el bucket ya sea public: hace la intención legible
-- en el esquema y sobrevive a que alguien cambie el flag sin darse cuenta.
drop policy if exists "products images are publicly readable" on storage.objects;
create policy "products images are publicly readable"
  on storage.objects
  for select
  to public
  using (bucket_id = 'products');

-- ------------------------------------------------------------------------------------
-- Permisos de auth_admin
-- ------------------------------------------------------------------------------------
-- La Edge Function upload-product-image valida el PIN con un cliente anon, porque
-- auth_admin es SECURITY DEFINER y está pensada para ser llamada sin sesión. Sin este
-- permiso la función respondía 401 en toda subida, aunque el PIN fuera correcto.
grant execute on function public.auth_admin(text) to anon, authenticated;