import { createClient } from 'jsr:@supabase/supabase-js@2'

// Sube una foto de producto al bucket "products", previa validación del PIN de admin.
//
// Por qué esto es una Edge Function y no una llamada desde el navegador: para escribir en
// Storage hace falta la service_role, y esa clave no puede viajar en el cliente. Si se
// filtrara, cualquiera con la URL del bundle podría subir y borrar todas las fotos del
// catálogo. Aquí la service_role se queda en el servidor, en una variable de entorno que
// Supabase no expone al navegador.
//
// El PIN se revalida contra la base con el mismo auth_admin() que usan las demás RPC del
// proyecto. Que el navegador ya haya pasado la pantalla de Administración no cuenta: aquí
// no se sabe nada del cliente, solo se cree el PIN.
//
// Límite práctico: 2 MB, que es lo que acepta el bucket y de sobra para una foto de
// celular comprimida. Se recortan las dimensiones del lado del cliente antes de subir, así
// que en la práctica casi nunca se llega al límite.
//
// Este endpoint también expone "action: cleanup", que borra archivos huérfanos del bucket:
// los que ningún producto referencia por image_url. Existe porque Supabase bloquea a
// propósito el DELETE de storage.objects por SQL para evitar pérdida accidental, así que
// la única vía para limpiar es la API de Storage.

const BUCKET = 'products'
const MAX_BYTES = 2 * 1024 * 1024

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // Cliente con service_role para escribir, y otro con anon para validar el PIN a través
  // de auth_admin, que es SECURITY DEFINER y por diseño solo acepta la clave anónima.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })
  const publicClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
  })

  try {
    const { pin, action, slug, filename, contentType, dataBase64 } = await req.json()

    if (!pin) return json({ error: 'Falta el PIN' }, 400)

    const { data: validated } = await publicClient.rpc('auth_admin', { p_pin: String(pin) })
    if (!validated || (Array.isArray(validated) ? validated.length === 0 : !validated)) {
      return json({ error: 'Autorización de administrador fallida' }, 401)
    }

    // ---------------------------------------------------------------------------------
    // Limpieza: borra del bucket los archivos que ningún producto referencia.
    // ---------------------------------------------------------------------------------
    if (action === 'cleanup') {
      const { data: files, error: listError } = await admin.storage.from(BUCKET).list('', {
        limit: 1000,
      })
      if (listError) return json({ error: listError.message }, 500)

      const { data: products } = await admin
        .from('products')
        .select('image_url')
        .not('image_url', 'is', null)

      // Se compara por nombre de archivo y no por URL completa: un producto puede
      // guardar la URL con otro host o con query string y aun así apuntar al mismo objeto.
      const enUso = new Set<string>()
      for (const p of products ?? []) {
        const match = String(p.image_url).match(/\/products\/([^?#]+)/)
        if (match) enUso.add(match[1])
      }

      const huerfanos = (files ?? [])
        .filter((f) => !enUso.has(f.name))
        .map((f) => f.name)

      if (huerfanos.length === 0) return json({ borrados: 0, nombres: [] })

      const { error: removeError } = await admin.storage.from(BUCKET).remove(huerfanos)
      if (removeError) return json({ error: removeError.message }, 500)

      return json({ borrados: huerfanos.length, nombres: huerfanos })
    }

    // ---------------------------------------------------------------------------------
    // Subida normal.
    // ---------------------------------------------------------------------------------
    if (!slug) return json({ error: 'Falta el producto' }, 400)
    if (!contentType?.startsWith('image/')) {
      return json({ error: 'Solo se aceptan imágenes' }, 400)
    }

    // El nombre del archivo se arma aquí, no se acepta del cliente. Si el slug viniera
    // manipulado, un "../" dejaría escribir fuera del bucket.
    //
    // OJO con la extensión: el sanitize reemplaza todo lo que no sea [a-z0-9-], así que
    // un punto acaba convertido en guion. La versión anterior hacía eso y guardaba
    // "alitas-jpg.jpg" cuando el cliente ya le había mandado "alitas.jpg", dejando la
    // foto anterior sin reemplazar y un archivo basura por cada producto.
    const safeSlug = String(slug)
      .toLowerCase()
      .replace(/\.(jpe?g|png|webp)$/, '') // quita la extensión si el cliente la incluyó
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    if (!safeSlug) return json({ error: 'El identificador del producto no es válido' }, 400)

    const extension = (filename?.match(/\.(jpe?g|png|webp)$/i)?.[1] ?? 'jpg').toLowerCase()
    const path = `${safeSlug}.${extension}`

    const bytes = Uint8Array.from(atob(String(dataBase64)), (c) => c.charCodeAt(0))
    if (bytes.byteLength > MAX_BYTES) {
      return json({ error: 'La imagen supera 2 MB' }, 413)
    }

    // upsert: si el archivo ya existía, se reemplaza en vez de dejar la anterior
    // huérfana ocupando espacio en el bucket.
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType,
      upsert: true,
      cacheControl: '3600',
    })

    if (uploadError) return json({ error: uploadError.message }, 500)

    // getPublicUrl no consulta la red: arma la URL a partir del endpoint y la ruta. Como
    // el bucket es público, esa URL ya sirve la imagen.
    const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(path)

    return json({ path, url: urlData.publicUrl })
  } catch (error) {
    return json({ error: (error as Error).message }, 500)
  }
})