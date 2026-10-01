import { create } from 'zustand'
import supabase from '../lib/supabase'
import { useAuthStore } from './useAuthStore'
import { useShiftStore } from './useShiftStore'
import { useOrderStore } from './useOrderStore'

/**
 * Cobros de una orden: pagos parciales, división de cuenta y reversas.
 *
 * Vive aparte de useOrderStore porque las órdenes son el tablero de cocina y
 * esto es dinero. Separarlos evita que un error al cobrar filtration el tablero
 * y, más importante, deja claro que ningún cobro escribe en `orders` desde el
 * cliente: todo pasa por add_payment, que es la única función que escribe en
 * order_payments.
 *
 * El PIN se lee de useAuthStore en el momento de la llamada, igual que en
 * useShiftStore: existe en un solo lugar y no se duplica.
 */
export const PAYMENT_LABELS = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
}

export const usePaymentStore = create((set) => ({
  /** Pago en curso: evita el doble toque que cobraría dos veces. */
  busyOrderId: null,
  error: null,

  clearError: () => set({ error: null }),

  /**
   * Previsualiza un reparto SIN cobrar. Llama a split_amount, que es la función
   * que hace el reparto real: el cliente solo muestra lo que el servidor dice.
   *
   * Calcularlo en JavaScript duplicaría la regla de los centavos y tarde o
   * temprano las dos copias discreparían. Aquí la única fuente de verdad es la
   * base.
   *
   * Devuelve el arreglo de montos ya limpio, o null si no se pudo calcular.
   */
  previewSplit: async (total, parts) => {
    const { data, error } = await supabase.rpc('split_amount', {
      p_total: total,
      p_parts: parts,
    })

    if (error || !data) return null
    return data.map((row) => Number(row.amount))
  },

  /**
   * Registra un cobro. Es la operación que mueve dinero: no se reintenta sola ni
   * se traga errores, porque un reintento a ciegas tras un timeout de red podría
   * cobrar dos veces si el primer intento sí llegó al servidor.
   *
   * Devuelve true si el cobro quedó registrado.
   */
  addPayment: async ({ orderId, method, amount, note = null }) => {
    const { pin } = useAuthStore.getState()
    const shift = useShiftStore.getState().shift

    if (!pin) {
      set({ error: 'Ingresa con tu PIN para cobrar' })
      return false
    }
    if (!shift) {
      set({ error: 'No hay una caja abierta. Abre tu turno en Caja antes de cobrar.' })
      return false
    }

    set({ busyOrderId: orderId, error: null })

    const { data, error } = await supabase.rpc('add_payment', {
      p_order_id: orderId,
      p_pin: pin,
      p_shift_id: shift.id,
      p_payment_method: method,
      p_amount: amount,
      p_note: note,
    })

    if (error) {
      set({ busyOrderId: null, error: error.message })
      return false
    }

    // add_payment devuelve vacío, no error, cuando el PIN no cuadra: es el mismo
    // camino que el rate limit, y abortar la transacción tiraría el contador.
    if (!data || data.length === 0) {
      set({ busyOrderId: null, error: 'PIN no reconocido' })
      return false
    }

    const result = data[0]
    set({ busyOrderId: null })

    // El corte X y el saldo de la orden cambian con cada cobro.
    useShiftStore.getState().refreshTotals()
    await useOrderStore.getState().fetchOpenOrders()

    return { status: result.status, remaining: Number(result.remaining) }
  },

  /** Total, pagado y qué falta. Para el badge "Faltan $X" del tablero. */
  fetchPaymentStatus: async (orderId) => {
    const { pin } = useAuthStore.getState()
    if (!pin) return null

    const { data } = await supabase.rpc('order_payment_status', {
      p_pin: pin,
      p_order_id: orderId,
    })

    const row = Array.isArray(data) ? data[0] : data
    if (!row) return null

    return {
      total: Number(row.total),
      paid: Number(row.paid_total),
      remaining: Number(row.remaining),
      status: row.status,
      payments: row.payments,
    }
  },

  /** Detalle de los cobros: para el resumen del ticket y para revertir. */
  listPayments: async (orderId) => {
    const { pin } = useAuthStore.getState()
    if (!pin) return []

    const { data } = await supabase.rpc('list_order_payments', {
      p_pin: pin,
      p_order_id: orderId,
    })

    return (data ?? []).map((row) => ({
      id: row.payment_id,
      amount: Number(row.amount),
      method: row.method,
      paidAt: row.paid_at,
      paidBy: row.paid_by,
      note: row.note,
      reverted: row.reverted,
    }))
  },

  /**
   * Reversa de un cobro mal hecho. Exige PIN de administrador y motivo: el
   * dinero ya se movió, así que la conversación es con el gerente, no con el
   * turno. Devuelve false sin error cuando el PIN no cuadra, para que la UI
   * pueda pedirlo sin perder el motivo ya escrito.
   */
  voidPayment: async (paymentId, reason, adminPin) => {
    const { data, error } = await supabase.rpc('void_payment', {
      p_payment_id: paymentId,
      p_reason: reason,
      p_admin_pin: adminPin,
    })

    if (error) {
      set({ error: error.message })
      return false
    }
    if (!data || data.length === 0) {
      set({ error: 'Se necesita PIN de administrador para revertir un cobro' })
      return false
    }

    useShiftStore.getState().refreshTotals()
    await useOrderStore.getState().fetchOpenOrders()
    return true
  },
}))