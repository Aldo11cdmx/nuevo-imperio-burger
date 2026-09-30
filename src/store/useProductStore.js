import { create } from 'zustand'
import { CATEGORY_ORDER, getCategory } from '../data/categories'
import supabase from '../lib/supabase'

/**
 * Carta viva. El POS ya no importa un archivo estático: lee de `products`, que solo
 * deja ver los productos is_active. El precio que se muestra y el que se cobra salen
 * de aquí, y create_order lo vuelve a leer en el servidor antes de insertar, así que
 * un cliente que manipule su copia no cambia lo que se cobra.
 *
 * El estado `products` se mantiene después de la primera carga: la carta no cambia
 * durante un turno y filtrar 65 filas en cada render no aporta nada. `reload` existe
 * para el botón de reintento y para cuando el admin acaba de editar el menú.
 */
export const useProductStore = create((set, get) => ({
  products: [],
  loading: false,
  error: null,
  loaded: false,

  load: async ({ force = false } = {}) => {
    if (get().loading) return
    if (get().loaded && !force) return

    set({ loading: true, error: null })

    const { data, error } = await supabase
      .from('products')
      .select('id, slug, name, price, category, is_active, tracks_stock, stock, low_stock_threshold, image_url, sort_order')
      .order('sort_order', { ascending: true })

    if (error) {
      set({ loading: false, error: error.message })
      return
    }

    set({ products: data ?? [], loading: false, error: null, loaded: true })
  },

  /**
   * El stock se descuenta en el servidor al crear la orden, así que dos tablets
   * vendiendo la última unidad a la vez necesitan ver el cambio. products está en la
   * publicación de realtime por eso.
   */
  subscribe: (channelName = 'products') => {
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        () => get().load({ force: true }),
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  },
}))

/**
 * Secciones visibles, en el orden de la carta. Las categorías que no estén en
 * CATEGORY_ORDER (una escrita a mano por el admin) se cuelgan al final en orden
 * alfabético, en vez de desaparecer del POS.
 */
export function selectCategories(products) {
  const seen = []
  const ids = new Set()
  for (const product of products) {
    if (!ids.has(product.category)) {
      ids.add(product.category)
      seen.push(product.category)
    }
  }

  const known = seen.filter((id) => CATEGORY_ORDER.includes(id)).sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b))
  const extra = seen.filter((id) => !CATEGORY_ORDER.includes(id)).sort()

  return [...known, ...extra].map((id) => ({ id, label: getCategory(id).label }))
}
