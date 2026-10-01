import { create } from 'zustand'
import { PRICES_INCLUDE_TAX, TAX_RATE, round2 } from '../lib/format'

const emptyLine = () => ({
  id: crypto.randomUUID(),
  productId: null,
  name: '',
  price: 0,
  quantity: 1,
  notes: '',
  status: 'pending',
})

export const ORDER_TYPES = [
  { id: 'dine_in', label: 'En local', emoji: '🍽️' },
  { id: 'takeout', label: 'Para llevar', emoji: '🥡' },
  { id: 'platform', label: 'Domicilio', emoji: '🛵' },
]

export const PLATFORMS = [
  { id: 'uber', label: 'Uber' },
  { id: 'rappi', label: 'Rappi' },
  { id: 'didi', label: 'DiDi' },
]

/** Mesa virtual que agrupa los pedidos que no ocupan salón. */
export const TAKEAWAY_TABLE = 999

export const useCartStore = create((set, get) => ({
  lines: [],
  customerName: '',
  tableNumber: null,
  orderType: 'dine_in',
  platform: null,
  /**
   * Descuento ya autorizado por un administrador. Guarda el monto y el motivo, pero
   * NUNCA el PIN: ese vive en el estado local del POS y se manda directo en la
   * llamada, para que un PIN de gerente no quede dando vueltas en un store global.
   */
  discount: null,

  /**
   * Cuenta abierta a la que se le están AGREGANDO productos, o null si el carrito es
   * un pedido nuevo.
   *
   * Los productos ya pedidos NO se meten en `lines`: viven aquí, aparte y solo para
   * lectura. Es la forma de que "solo se puede agregar" sea una regla estructural y no
   * algo que haya que recordar en cada botón: los controles de cantidad y de eliminar
   * simplemente no existen para lo viejo, porque no está en el carrito. Si se metieran
   * en `lines` habría que acordarse de bloquearlos, y un botón sin bloquear es una
   * cuenta cobrada mal.
   */
  existingOrder: null,

  /**
   * Tocar de nuevo un producto que ya está en la cuenta suma cantidad en vez de crear
   * otra línea. Con una carta de 65 productos, tres veces la misma hamburguesa es lo
   * más común y una línea por unidad llena el ticket de basura.
   *
   * Solo se funden líneas idénticas: si la nota de cocina difiere, son preparaciones
   * distintas y deben quedar separadas.
   */
  addItem: (product) =>
    set((state) => {
      const existing = state.lines.find(
        (line) => line.productId === product.id && line.notes.trim() === '',
      )

      if (existing) {
        return {
          lines: state.lines.map((line) =>
            line.id === existing.id ? { ...line, quantity: line.quantity + 1 } : line,
          ),
        }
      }

      return {
        lines: [
          ...state.lines,
          {
            ...emptyLine(),
            productId: product.id,
            name: product.name,
            price: product.price,
          },
        ],
      }
    }),

  increase: (lineId) =>
    set((state) => ({
      lines: state.lines.map((line) =>
        line.id === lineId ? { ...line, quantity: line.quantity + 1 } : line,
      ),
    })),

  decrease: (lineId) =>
    set((state) => ({
      lines: state.lines.flatMap((line) => {
        if (line.id !== lineId) return [line]
        return line.quantity > 1 ? [{ ...line, quantity: line.quantity - 1 }] : []
      }),
    })),

  removeLine: (lineId) => set((state) => ({ lines: state.lines.filter((line) => line.id !== lineId) })),

  setNotes: (lineId, notes) =>
    set((state) => ({
      lines: state.lines.map((line) => (line.id === lineId ? { ...line, notes } : line)),
    })),

  setCustomer: (customerName) => set({ customerName }),
  setTable: (tableNumber) => set({ tableNumber }),
  setOrderType: (orderType) =>
    // Cambiar a algo que no sea domicilio limpia la plataforma: dejarla puesta haría
    // que la orden fuera rechazada por el CHECK de orders_platform_matches_type.
    set({ orderType, platform: orderType === 'platform' ? get().platform : null }),
  setPlatform: (platform) => set({ platform }),
  setDiscount: (discount) => set({ discount }),

  /**
   * Carga una cuenta abierta para seguir agregando productos.
   *
   * El pedido nuevo en curso se descarta: mezclar productos de una cuenta anterior con
   * los que el mesero está capturando sería imposible de explicar después en el corte.
   *
   * El saldo se calcula como total - paid_total aunque se mande ya hecho, porque el
   * total de la orden pudo cambiar desde que se leyó.
   */
  loadExisting: (order) =>
    set({
      existingOrder: {
        id: order.id,
        code: order.code,
        total: Number(order.total ?? 0),
        paidTotal: Number(order.paid_total ?? 0),
        // La comanda del agregado rotula la mesa y el tipo de pedido con estos, y no
        // con los del carrito: la cuenta ya existe y su tipo no se está cambiando.
        orderType: order.order_type ?? 'dine_in',
        platform: order.platform ?? null,
        tableNumber: order.table_number ?? null,
        items: (order.order_items ?? []).map((item) => ({
          id: item.id,
          name: item.product_name,
          quantity: item.quantity,
          notes: item.notes ?? '',
        })),
      },
      // La cuenta manda sobre el tipo de pedido: agregar no puede volver domicilio una
      // orden que se creó en local, y el servidor no aceptaría la plataforma.
      orderType: order.order_type ?? 'dine_in',
      platform: order.platform ?? null,
      tableNumber: order.table_number ?? null,
      customerName: order.customer_name ?? '',
      // El descuento no viaja al agregar: append_order_items no lo toca. Se aplica por
      // su propio camino, sobre la cuenta completa.
      discount: null,
      lines: [],
    }),

  /** Sale del modo cuenta y vuelve a ser un pedido nuevo. */
  exitExisting: () =>
    set({
      existingOrder: null,
      lines: [],
      customerName: '',
      discount: null,
    }),

  /**
   * Vacía el carrito sin salir de la cuenta a la que se está agregando.
   *
   * Es lo que pasa después de un agregado exitoso: los productos nuevos ya son parte de
   * la cuenta y ya se mandaron a cocina, así que el carrito se limpia pero la cuenta
   * sigue ahí para agregar otra cosa. Usar `clear()` aquí sacaría al mesero del modo
   * cuenta y lo dejaría armando un pedido nuevo sobre la misma mesa.
   */
  clearLines: () => set({ lines: [], discount: null }),

  clear: () =>
    set({
      lines: [],
      customerName: '',
      tableNumber: null,
      orderType: 'dine_in',
      platform: null,
      discount: null,
      existingOrder: null,
    }),

  /**
   * Los precios del menú ya traen el IVA, igual que la carta. Por eso el total es la
   * suma simple y el impuesto se guarda en 0. Si algún día se carga el precio sin IVA,
   * basta con poner PRICES_INCLUDE_TAX en false en src/lib/format.js.
   *
   * El descuento se RESTA del total y se guarda ya aplicado: el total que se cobró y
   * se imprimió es el que queda, aunque después cambie la carta.
   *
   * `itemCount` son renglones del ticket y `unitCount` son unidades cobradas. No son lo
   * mismo: como `addItem` funde toques repetidos del mismo producto, tres hamburguesas
   * iguales ocupan un renglón y son tres unidades. Confundirlos hacía que el toast de
   * confirmación anunciara "1 producto" tras vender tres.
   */
  totals: () => {
    const { lines, discount } = get()
    const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0)
    const tax = PRICES_INCLUDE_TAX ? 0 : subtotal * TAX_RATE
    // No se deja que el descuento baje el total de cero: un total negativo lo
    // rechazaría el CHECK de orders con un error técnico en vez de uno entendible.
    const discountAmount = Math.min(discount?.amount ?? 0, subtotal + tax)

    return {
      subtotal: round2(subtotal),
      tax: round2(tax),
      discount: round2(discountAmount),
      total: round2(subtotal + tax - discountAmount),
      itemCount: lines.length,
      unitCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    }
  },
}))
