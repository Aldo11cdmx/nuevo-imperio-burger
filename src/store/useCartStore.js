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

  clear: () =>
    set({
      lines: [],
      customerName: '',
      tableNumber: null,
      orderType: 'dine_in',
      platform: null,
      discount: null,
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
