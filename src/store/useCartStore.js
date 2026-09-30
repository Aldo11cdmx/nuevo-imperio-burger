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

export const useCartStore = create((set, get) => ({
  lines: [],
  customerName: '',
  tableNumber: null,

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

  clear: () => set({ lines: [], customerName: '', tableNumber: null }),

  /**
   * Los precios del menú ya traen el IVA, igual que la carta. Por eso el total es la
   * suma simple y el impuesto se guarda en 0. Si algún día se carga el precio sin IVA,
   * basta con poner PRICES_INCLUDE_TAX en false en src/lib/format.js.
   */
  totals: () => {
    const { lines } = get()
    const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0)
    const tax = PRICES_INCLUDE_TAX ? 0 : subtotal * TAX_RATE
    return { subtotal: round2(subtotal), tax: round2(tax), total: round2(subtotal + tax), itemCount: lines.length }
  },
}))
