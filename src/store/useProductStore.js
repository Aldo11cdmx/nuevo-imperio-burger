import { create } from 'zustand'
import { CATEGORY_ORDER, getCategory } from '../data/categories'
import supabase from '../lib/supabase'
import { useAuthStore } from './useAuthStore'
import { notifyLowStock } from '../lib/notifications'

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
  /**
   * Catálogo de extras por producto: un arreglo de grupos, no un select anidado.
   *
   * Se guarda aparte de `products` a propósito. Los productos cambian con frecuencia
   * (Realtime los refresca en cada venta de un producto con stock) y recargar el
   * catálogo de extras en cada uno de esos refrescos sería pedir lo mismo siempre.
   * El catálogo cambia cuando el admin edita extras, que es una vez cada varios días.
   *
   * @type {Array<{group_id: string, name: string, modifiers: Array<{id: string, name: string, price: number}>}>}
   */
  modifierGroups: [],
  loading: false,
  error: null,
  loaded: false,
  modifiersLoaded: false,

  load: async ({ force = false } = {}) => {
    if (get().loading) return
    if (get().loaded && !force) return

    set({ loading: true, error: null })

    const { data, error } = await supabase
      .from('products')
      .select('id, slug, name, price, category, is_active, tracks_stock, stock, low_stock_threshold, image_url, sort_order, station')
      .order('sort_order', { ascending: true })

    if (error) {
      set({ loading: false, error: error.message })
      return
    }

    set({ products: data ?? [], loading: false, error: null, loaded: true })
  },

  /**
   * Una sola RPC trae el catálogo completo de extras y a qué productos aplica cada
   * grupo. Valida el PIN de EMPLEADO y no de administrador: quien arma la orden es un
   * mesero y necesita esto para trabajar, sin que le abra ningún privilegio.
   */
  loadModifierGroups: async ({ force = false } = {}) => {
    if (get().modifiersLoaded && !force) return

    const { pin } = useAuthStore.getState()
    if (!pin) return

    const { data, error } = await supabase.rpc('product_modifier_catalog', { p_pin: pin })

    if (error) {
      set({ error: error.message })
      return
    }

    // null es el PIN no reconocido. No es un fallo de carga: se deja como está y el POS
    // sigue mostrando la carta, solo que sin extras hasta que se recargue.
    set({ modifierGroups: Array.isArray(data) ? data : [], modifiersLoaded: true })
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
        { event: 'UPDATE', schema: 'public', table: 'products' },
        (payload) => {
          if (payload?.new && payload.new.tracks_stock) {
            const newStock = Number(payload.new.stock ?? 0)
            const threshold = Number(payload.new.low_stock_threshold ?? 5)
            const oldStock = Number(payload.old?.stock ?? 999)
            if (newStock <= threshold && oldStock > threshold) {
              notifyLowStock(payload.new)
            }
          }
          get().load({ force: true })
        },
      )
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

/**
 * Grupos de extras que ofrece un producto.
 *
 * Se recorre la lista de grupos y se filtra por `product_ids` en vez de montar un
 * índice invertido: son cuatro o cinco grupos y el recorrido es lineal. Montar un mapa
 * product_id -> grupos costaría más código del que ahorra.
 *
 * @param {Array} modifierGroups
 * @param {string} productId
 * @returns {Array} Los grupos que aplican, con sus modificadores.
 */
export function selectGroupsForProduct(modifierGroups, productId) {
  if (!productId || !Array.isArray(modifierGroups)) return []
  return modifierGroups.filter((group) => (group.product_ids ?? []).includes(productId))
}
