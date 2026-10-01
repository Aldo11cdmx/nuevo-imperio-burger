import { create } from 'zustand'
import supabase from '../lib/supabase'
import { useAuthStore } from './useAuthStore'
import { useExpenseStore } from './useExpenseStore'

/**
 * Turno de caja del cajero actual.
 *
 * Existe porque create_order y complete_order exigen un turno abierto: sin gaveta no hay
 * contra qué conciliar el dinero. El POS consulta este store para saber si puede cobrar, y
 * la pantalla /caja usa las mismas acciones para abrir y cerrar.
 *
 * El PIN no se guarda aquí. Se lee del store de auth en el momento de la llamada, para que
 * exista en un solo lugar y no se duplique en dos stores.
 */

const EMPTY = {
  id: null,
  opened_at: null,
  opening_float: 0,
  cash_sales: 0,
  card_sales: 0,
  transfer_sales: 0,
  total_sales: 0,
  ticket_count: 0,
}

export const useShiftStore = create((set, get) => ({
  shift: null,
  loading: false,
  error: null,

  /**
   * Busca el turno abierto del cajero. get_open_shifts devuelve todos los abiertos, así que
   * se filtra por el id del empleado en vez de traer una RPC extra que solo devuelva el
   * propio. Sin turno devuelve null, que es el estado normal de quien entra a vender.
   *
   * Devolver null en vez de lanzar es intencional: que el PIN sea inválido y que simplemente
   * no haya turno son dos resultados distintos y la UI los trata distinto.
   */
  loadMyShift: async () => {
    const { employee, pin } = useAuthStore.getState()
    if (!employee || !pin) {
      set({ shift: null })
      return null
    }

    set({ loading: true, error: null })

    const { data, error } = await supabase.rpc('get_open_shifts', { p_pin: pin })
    const rows = Array.isArray(data) ? data : []

    if (error) {
      set({ loading: false, error: error.message })
      return null
    }

    const mine = rows.find((row) => row.opened_by === employee.id) ?? null
    set({ loading: false, shift: mine ? { ...EMPTY, ...mine } : null })
    return mine
  },

  /** Abre la gaveta. Devuelve el turno ya normalizado o null si el PIN no fue reconocido. */
  openShift: async (openingFloat) => {
    const { pin } = useAuthStore.getState()
    if (!pin) {
      set({ error: 'Ingresa con tu PIN para abrir caja' })
      return null
    }

    set({ loading: true, error: null })

    const { data, error } = await supabase.rpc('open_shift', {
      p_pin: pin,
      p_opening_float: openingFloat,
    })

    if (error) {
      set({ loading: false, error: error.message })
      return null
    }

    // open_shift devuelve el uuid pelado, o null si el PIN no existe o está bloqueado por
    // el rate limit. El store guarda el objeto completo, no solo el id, para que el POS
    // pueda mostrar el fondo sin una segunda ida al servidor.
    if (!data) {
      set({ loading: false, error: 'PIN no reconocido' })
      return null
    }

    const shift = { ...EMPTY, id: data, opening_float: openingFloat }
    set({ loading: false, shift, error: null })
    return shift
  },

  /**
   * Corte Z. Devuelve el reporte del turno ya cerrado para mostrarlo como recibo, o null si
   * el servidor lo rechazó.
   */
  closeShift: async (countedCash, note) => {
    const { pin } = useAuthStore.getState()
    if (!pin) {
      set({ error: 'Ingresa con tu PIN para cerrar caja' })
      return null
    }

    set({ loading: true, error: null })

    const { data, error } = await supabase.rpc('close_shift', {
      p_pin: pin,
      p_counted_cash: countedCash,
      p_note: note?.trim() ? note.trim() : null,
    })

    if (error) {
      set({ loading: false, error: error.message })
      return null
    }

    const report = Array.isArray(data) ? data[0] : data
    if (!report) {
      set({ loading: false, error: 'No se pudo cerrar el turno' })
      return null
    }

    set({ loading: false, shift: null, error: null })
    // Los gastos del turno que se acaba de cerrar se vacían junto con él. Dejarlos puestos
    // haría que la pantalla del turno nuevo mostrara el total de gastos del anterior y el
    // efectivo esperado saliera descuamentado por dinero que ya se contó.
    useExpenseStore.setState({ expenses: [], error: null })
    return report
  },

  /**
   * Corte X: relee los totales en vivo sin tocar nada. El POS lo llama tras cobrar para que
   * el fondo y la venta del momento no queden desactualizados en la cabecera.
   */
  refreshTotals: async () => {
    const previous = get().shift
    if (!previous) return null
    await get().loadMyShift()
    return get().shift
  },

  clearError: () => set({ error: null }),
}))
