import { create } from 'zustand'
import supabase from '../lib/supabase'

export const ORDER_STATUS = {
  PENDING: 'pending',
  IN_KITCHEN: 'in_kitchen',
  READY: 'ready',
  SERVED: 'served',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
}

/** Órdenes que siguen en el tablero de cocina: todo lo que aún no se cobró ni se anuló. */
export const OPEN_STATUSES = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.IN_KITCHEN,
  ORDER_STATUS.READY,
  ORDER_STATUS.SERVED,
]

/** Transiciones que no exigen método de pago. Cerrar la orden es un paso aparte. */
export const KITCHEN_FLOW = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.IN_KITCHEN,
  ORDER_STATUS.READY,
  ORDER_STATUS.SERVED,
]

export const PAYMENT_METHODS = ['cash', 'card', 'transfer']

export const useOrderStore = create((set, get) => ({
  orders: [],
  loading: false,
  error: null,
  busyOrderId: null,

  setOrders: (orders) => set({ orders }),

  fetchOpenOrders: async () => {
    set({ loading: true, error: null })

    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .in('status', OPEN_STATUSES)
      .order('code', { ascending: true })

    set({ loading: false, error: error?.message ?? null, orders: data ?? [] })
    return data ?? []
  },

  /** pending → in_kitchen → ready → served. No mueve a completed: eso exige cobro. */
  advanceOrder: async (orderId) => {
    const current = get().orders.find((order) => order.id === orderId)
    if (!current) return

    const index = KITCHEN_FLOW.indexOf(current.status)
    if (index < 0 || index === KITCHEN_FLOW.length - 1) return

    await get().patchOrder(orderId, { status: KITCHEN_FLOW[index + 1] })
  },

  completeOrder: async (orderId, paymentMethod) => {
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
      set({ error: 'Método de pago no válido' })
      return
    }

    await get().patchOrder(orderId, {
      status: ORDER_STATUS.COMPLETED,
      payment_method: paymentMethod,
      paid_at: new Date().toISOString(),
    })
  },

  cancelOrder: async (orderId) => {
    await get().patchOrder(orderId, { status: ORDER_STATUS.CANCELLED })
  },

  patchOrder: async (orderId, patch) => {
    set({ busyOrderId: orderId, error: null })

    const { data, error } = await supabase
      .from('orders')
      .update(patch)
      .eq('id', orderId)
      .select()
      .single()

    if (error) {
      set({ busyOrderId: null, error: error.message })
      return
    }

    set((state) => ({
      busyOrderId: null,
      // Al cobrarse o anularse, la orden sale del tablero.
      orders: OPEN_STATUSES.includes(data.status)
        ? state.orders.map((order) => (order.id === orderId ? { ...order, ...data } : order))
        : state.orders.filter((order) => order.id !== orderId),
    }))
  },

  subscribe: (channelName = 'orders') => {
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        get().fetchOpenOrders()
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  },
}))
