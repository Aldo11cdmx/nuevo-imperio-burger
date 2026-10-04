import { create } from 'zustand'
import supabase from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { useAuthStore } from './useAuthStore'
import { useShiftStore } from './useShiftStore'

export const ORDER_STATUS = {
  PENDING: 'pending',
  IN_KITCHEN: 'in_kitchen',
  READY: 'ready',
  SERVED: 'served',
  // Cobrada a medias: la orden ya salió de cocina pero le falta dinero. Sigue en
  // el tablero para poder cobrarle el resto.
  PARTIALLY_PAID: 'partially_paid',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
}

/**
 * Órdenes que siguen en el tablero: todo lo que aún no se cobró del todo ni se
 * anuló. partially_paid entra porque una cuenta dividida a medias todavía tiene
 * un turno abierto que atender; si saliera del tablero, el resto quedaría sin
 * forma de cobrarlo desde la cocina.
 */
export const OPEN_STATUSES = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.IN_KITCHEN,
  ORDER_STATUS.READY,
  ORDER_STATUS.SERVED,
  ORDER_STATUS.PARTIALLY_PAID,
]

/** Transiciones que no exigen método de pago. Cerrar la orden es un paso aparte. */
export const KITCHEN_FLOW = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.IN_KITCHEN,
  ORDER_STATUS.READY,
  ORDER_STATUS.SERVED,
]

/**
 * Estados que la pantalla de Cocina muestra como "preparación activa".
 *
 * `ready` sale deliberadamente: cuando una orden pasa a 'ready' (cocina lista) se
 * marca con un aviso para el mesero y desaparece del tablero activo, pero la orden
 * se queda en la base de datos para consultarse y cobrarse desde Tables.jsx. Si el
 * KDS volviera a incluir 'ready', un refresco de Realtime traería la comanda de vuelta
 * justo después de marcarla lista. No incluye tampoco 'served'/'partially_paid':
 * son estados de cobro, no de preparación.
 */
export const KDS_VIEW_STATUSES = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.IN_KITCHEN,
]

export const PAYMENT_METHODS = ['cash', 'card', 'transfer']

export const useOrderStore = create((set, get) => ({
  orders: [],
  loading: false,
  error: null,
  busyOrderId: null,

  setOrders: (orders) => set({ orders }),

  /**
   * Trae las órdenes abiertas con sus renglones.
   *
   * `order_items(*)` trae también `station` y `status`, que son las dos columnas que
   * hacen posible el KDS por estación: sin ellas la tarjeta no sabe qué renglones son
   * de barra y cuáles son de cocina, ni cuáles falta preparar.
   *
   * Los extras van anidados porque cada renglón puede colgar de la orden: un producto
   * no tiene extras propios.
   */
  fetchOpenOrders: async () => {
    set({ loading: true, error: null })

    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*, order_item_modifiers(name, price, quantity))')
      .in('status', KDS_VIEW_STATUSES)
      .order('code', { ascending: true })

    set({ loading: false, error: error?.message ?? null, orders: data ?? [] })
    return data ?? []
  },

  /**
   * Avanza los renglones de UNA estación un paso: pending → in_progress → ready.
   *
   * La RPC devuelve el estado agregado de la orden y cuántos renglones quedan sin
   * terminar en todas las estaciones, así que la tarjeta se actualiza sin releer la
   * orden entera. Cuando una orden se queda sin renglones pendientes en ninguna
   * estación, sale del tablero; la RPC no la borra, solo cambia su estado, y
   * `remaining` es la señal para decidirlo aquí.
   *
   * @returns {Promise<boolean>} Si la orden dejó de tener trabajo pendiente.
   */
  advanceStationItems: async (orderId, station) => {
    set({ busyOrderId: orderId, error: null })

    const { pin } = useAuthStore.getState()
    const { data, error } = await supabase.rpc('advance_station_items', {
      p_pin: pin,
      p_order_id: orderId,
      p_station: station,
    })

    if (error) {
      set({ busyOrderId: null, error: error.message })
      return false
    }

    // Sin filas: el PIN no pasó. Es el mismo patrón que complete_order: la RPC no lanza
    // excepción para no gastar el rate limit del intento fallido.
    if (!data || data.length === 0) {
      set({ busyOrderId: null, error: 'PIN no reconocido' })
      return false
    }

    const [result] = data
    const done = Number(result.remaining ?? 0) === 0

    set((state) => ({
      busyOrderId: null,
      // Al quedar sin renglones pendientes, la orden sale del tablero. El resto de los
      // estados de cobro (served, partially_paid) NO la sacan: una cuenta servida con
      // la bebida pendiente sigue siendo una cuenta por cobrar, y eso lo decide el
      // estado de la orden, no la cocina.
      orders: done
        ? state.orders.filter((order) => order.id !== orderId)
        : state.orders.map((order) =>
            order.id === orderId ? { ...order, status: result.order_status } : order,
          ),
    }))

    return done
  },

  /**
   * pending → in_kitchen → ready → served. No mueve a completed: eso exige cobro, y el
   * cobro es la única transición que necesita turno y PIN.
   */
  advanceOrder: async (orderId) => {
    const current = get().orders.find((order) => order.id === orderId)
    if (!current) return

    const index = KITCHEN_FLOW.indexOf(current.status)
    if (index < 0 || index === KITCHEN_FLOW.length - 1) return

    await get().patchOrder(orderId, { status: KITCHEN_FLOW[index + 1] })
  },

  /**
   * Cobro de una orden en un solo pago. Atajo que delega en add_payment (el
   * servidor): cobra lo que falta y liquida. Se conserva para el camino simple
   * (una persona, un método) en vez de obligar a siempre abrir el diálogo de
   * división.
   */
  completeOrder: async (orderId, paymentMethod) => {
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
      set({ error: 'Método de pago no válido' })
      return
    }

    // El turno se resuelve antes de tocar la red: sin gaveta abierta el servidor lo va a
    // rechazar igual, y es más barato no gastar el viaje.
    const { pin } = useAuthStore.getState()
    const shift = useShiftStore.getState().shift
    if (!shift) {
      set({ error: 'No hay una caja abierta. Abre tu turno en Caja antes de cobrar.' })
      return
    }

    set({ busyOrderId: orderId, error: null })

    const { data, error } = await supabase.rpc('complete_order', {
      p_order_id: orderId,
      p_pin: pin,
      p_shift_id: shift.id,
      p_payment_method: paymentMethod,
    })

    if (error) {
      set({ busyOrderId: null, error: error.message })
      return
    }

    // La RPC devuelve NULL, no un error, cuando el PIN no cuadra: es el mismo camino que
    // usa el rate limit, y abortar la transacción tiraría el contador.
    if (!data) {
      set({ busyOrderId: null, error: 'PIN no reconocido' })
      return
    }

    // complete_order también cubre una cuenta a medias: si la orden estaba
    // partially_paid, cobra el resto y la liquida (data = 'completed'), así que sale
    // del tablero. Si por alguna razón no liquidó, se queda con el status devuelto.
    if (data === 'completed' || data === 'cancelled') {
      set((state) => ({
        busyOrderId: null,
        orders: state.orders.filter((order) => order.id !== orderId),
      }))
    } else {
      set((state) => ({
        busyOrderId: null,
        orders: state.orders.map((order) =>
          order.id === orderId ? { ...order, status: data } : order,
        ),
      }))
    }

    // El corte X cambia con cada cobro. Se relee para que el fondo de la gaveta no quede
    // mostrando la venta anterior.
    useShiftStore.getState().refreshTotals()
  },

  cancelOrder: async (orderId, reason, adminPin = null) => {
    if (!reason || !reason.trim()) {
      set({ error: 'Escribe el motivo de la anulación' })
      return
    }

    set({ busyOrderId: orderId, error: null })

    const { data, error } = await supabase.rpc('cancel_order', {
      p_order_id: orderId,
      p_reason: reason.trim(),
      p_admin_pin: adminPin,
    })

    if (error) {
      set({ busyOrderId: null, error: error.message })
      return
    }

    // null acá significa que la orden ya estaba cobrada y el PIN de admin no pasó. No es
    // un error de servidor: es una decisión de negocio, y la UI tiene que poder pedir el
    // PIN y reintentar.
    if (!data) {
      set({ busyOrderId: null, error: 'Se necesita PIN de administrador para anular una venta cobrada' })
      return
    }

    set((state) => ({
      busyOrderId: null,
      orders: state.orders.filter((order) => order.id !== orderId),
    }))

    useShiftStore.getState().refreshTotals()
  },

  /**
   * Toda mutación pasa por una RPC. Ya no hay .insert() ni .update() sobre orders: desde la
   * migración de cierre de escritura directa, anon no tiene permiso, y aunque lo tuviera
   * el precio y el stock los calcula el servidor.
   */
  patchOrder: async (orderId, { status }) => {
    // El PIN se resuelve antes de tocar la red. advance_order lo exige desde la
    // corrección de QA: `served` es lo que hace una orden cobrable, así que sin PIN
    // cualquiera con la anon key podía marcar servida una orden ajena.
    const { pin } = useAuthStore.getState()
    if (!pin) {
      set({ error: 'Tu sesión venció. Vuelve a ingresar con tu PIN.' })
      return
    }

    set({ busyOrderId: orderId, error: null })

    const { data, error } = await supabase.rpc('advance_order', {
      p_pin: pin,
      p_order_id: orderId,
      p_to_status: status,
    })

    if (error) {
      set({ busyOrderId: null, error: friendlyError(error) })
      return
    }

    set((state) => ({
      busyOrderId: null,
      // Al cobrarse o anularse, la orden sale del tablero. advance_order nunca deja la
      // orden fuera de la lista: completed solo lo alcanza complete_order.
      orders: OPEN_STATUSES.includes(data)
        ? state.orders.map((order) => (order.id === orderId ? { ...order, status: data } : order))
        : state.orders.filter((order) => order.id !== orderId),
    }))
  },

  /**
   * Suscripción de Realtime para el tablero.
   *
   * Escucha `orders` y `order_items` por separado a propósito. Con solo `orders`, marcar
   * una bebida lista en barra actualizaría order_items sin tocar la orden, y el tablero
   * no se enteraría hasta que pasara otra cosa.
   *
   * Sin `filter` a propósito: cualquier cambio de estado de renglón obliga a releer, y
   * en el caso importante —el renglón queda listo— un filtro tipo "status distinto de
   * ready" justamente excluiría la actualización que hace falta.
   */
  subscribe: (channelName = 'orders') => {
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        get().fetchOpenOrders()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'order_items' }, () => {
        get().fetchOpenOrders()
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  },
}))
