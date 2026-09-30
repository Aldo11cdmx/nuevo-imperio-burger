import { create } from 'zustand'

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

  addItem: (product) =>
    set((state) => ({
      lines: [
        ...state.lines,
        {
          ...emptyLine(),
          productId: product.id,
          name: product.name,
          price: product.price,
        },
      ],
    })),

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

  totals: () => {
    const { lines } = get()
    const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0)
    const tax = subtotal * 0.08
    return { subtotal, tax, total: subtotal + tax, itemCount: lines.length }
  },
}))
