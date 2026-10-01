import { create } from 'zustand'
import supabase from '../lib/supabase'
import { useAuthStore } from './useAuthStore'

/**
 * Gastos de caja chica del turno abierto.
 *
 * Es un store aparte del de turnos aunque los dos hablen del turno, porque un gasto
 * tiene su propio ciclo de vida: se registra, se ve, y a veces se anula, y eso pasa
 * muchas veces dentro de un mismo turno. Meterlo en `useShiftStore` haría que cada
 * gasto reescribiera el objeto del turno, que es lo que el POS lee para mostrar el
 * fondo y las ventas.
 *
 * Y a diferencia de las ventas, un gasto no es dinero que entra: es dinero que salió de
 * la gaveta. Por eso vive aparte y su total se RESTA del efectivo esperado en el corte.
 */
export const useExpenseStore = create((set, get) => ({
  /** Gastos del turno abierto, del más reciente al más viejo. */
  expenses: [],
  loading: false,
  error: null,
  /** Id del gasto que se está anulando, para bloquear solo ese botón. */
  busyExpenseId: null,

  /**
   * Relee los gastos del turno abierto.
   *
   * Devuelve una lista VACÍA si no hay turno, y eso es un resultado normal y no un error:
   * quien abrió la app todavía no abrió caja y no tiene nada que registrar. La diferencia
   * importa porque la UI usa `expenses.length` para decidir si mostrar el formulario de
   * gasto, y tratarlo como fallo pondría un banner rojo en una pantalla que está bien.
   */
  load: async () => {
    const { pin } = useAuthStore.getState()
    if (!pin) {
      set({ expenses: [] })
      return []
    }

    set({ loading: true, error: null })

    const { data, error } = await supabase.rpc('list_shift_expenses', { p_pin: pin })
    const rows = Array.isArray(data) ? data : []

    if (error) {
      set({ loading: false, error: error.message })
      return []
    }

    set({ loading: false, expenses: rows, error: null })
    return rows
  },

  /**
   * Total de gastos VIGENTES del turno.
   *
   * No se suman los montos en JS: cada fila trae su `running_total` calculado por el
   * servidor sobre los gastos no anulados, y la fila más reciente trae el total completo
   * del turno. Sumar aquí en pantalla admitiría que un gasto anulado se cuente por
   * error, que es exactamente el error que el corte tiene que poder detectar.
   *
   * @returns {number} 0 si no hay gastos o todavía no se han cargado.
   */
  total: () => {
    const first = get().expenses[0]
    return first ? Number(first.running_total ?? 0) : 0
  },

  /**
   * Registra una salida de efectivo del turno abierto.
   *
   * Devuelve el id del gasto creado, o null si el servidor lo rechazó. El monto llega
   * redondeado a centavos porque el corte compara contra la gaveta y un 49.995 que se
   * guardó sin redondear daría una diferencia de un centavo que no existe en el mundo
   * real.
   *
   * @returns {Promise<string|null>}
   */
  register: async (amount, reason) => {
    const { pin } = useAuthStore.getState()
    if (!pin) {
      set({ error: 'Ingresa con tu PIN para registrar un gasto' })
      return null
    }

    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      set({ error: 'El monto del gasto debe ser mayor que cero' })
      return null
    }
    if (!reason || !reason.trim()) {
      set({ error: 'Escribe en qué se gastó el dinero' })
      return null
    }

    set({ loading: true, error: null })

    const { data, error } = await supabase.rpc('register_shift_expense', {
      p_pin: pin,
      p_amount: Math.round(value * 100) / 100,
      p_reason: reason.trim(),
    })

    if (error) {
      set({ loading: false, error: error.message })
      return null
    }

    // null es el PIN no reconocido. La RPC devuelve el id y nada más, así que no hay
    // dónde mirar: la única forma de que venga vacío es que el PIN no pasara.
    if (!data) {
      set({ loading: false, error: 'PIN no reconocido' })
      return null
    }

    set({ loading: false })
    await get().load()
    return data
  },

  /**
   * Anula un gasto mal capturado, sin borrarlo.
   *
   * Anular y no borrar es la diferencia entre "se capturó mal y se corregió" y "este
   * gasto nunca existió", que es un agujero del tamaño del error. El gasto queda en la
   * lista marcado como anulado, con su motivo y quién lo anuló, y deja de descontarse del
   * efectivo esperado.
   *
   * El turno tiene que seguir abierto: con el corte ya hecho, el dinero ya se contó
   * contra el cajero y tocar el gasto reescribe un cuadre que ya se firmó. El servidor
   * lo rechaza y esta función solo traduce el mensaje.
   *
   * @returns {Promise<boolean>} Si la anulación quedó hecha.
   */
  void: async (expenseId, reason) => {
    if (!reason || !reason.trim()) {
      set({ error: 'Escribe por qué se anula el gasto' })
      return false
    }

    set({ busyExpenseId: expenseId, error: null })

    const { pin } = useAuthStore.getState()
    const { error } = await supabase.rpc('void_shift_expense', {
      p_pin: pin,
      p_expense_id: expenseId,
      p_reason: reason.trim(),
    })

    if (error) {
      set({ busyExpenseId: null, error: error.message })
      return false
    }

    // void devuelve void, así que `data` es null SIEMPRE, incluso en el éxito. La única
    // señal de que algo salió mal es `error`, que ya se revisó arriba. Por eso lo que
    // decide es la recarga: si el gasto sigue apareciendo como vigente, no se anuló.
    set({ busyExpenseId: null })
    await get().load()
    return true
  },

  clearError: () => set({ error: null }),
}))
