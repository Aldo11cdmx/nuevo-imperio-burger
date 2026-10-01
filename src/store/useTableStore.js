import { create } from 'zustand'
import supabase from '../lib/supabase'
import { useAuthStore } from './useAuthStore'

/**
 * Mapa de mesas.
 *
 * El estado de cada mesa (libre / ocupada / cobrando) NO se guarda en la base:
 * tables_status() lo deriva de las órdenes abiertas cada vez que se consulta. Aquí
 * solo hay un caché de pantalla que se refresca cuando algo cambia.
 *
 * Realtime más un polling de respaldo: si el wi-fi de la tablet se cae, el canal
 * deja de llegar eventos sin avisar y el mapa se quedaría congelado mostrando una
 * mesa libre que en realidad tiene gente comiendo. El polling no reemplaza al
 * Realtime, lo cubre cuando falla.
 *
 * Para leer no se pide PIN: cualquiera que abra el mapa ya ve el salón. Editar sí
 * exige PIN de administrador y revalida en el servidor.
 */

export const TABLE_STATES = {
  FREE: 'free',
  BUSY: 'busy',
  BILLING: 'billing',
}

const STATE_STYLE = {
  free: { dot: 'bg-jade-400', border: 'border-jade-400/50', badge: 'Libre', text: 'text-jade-300' },
  busy: { dot: 'bg-emberred-400', border: 'border-emberred-400/50', badge: 'Ocupada', text: 'text-emberred-300' },
  billing: { dot: 'bg-saffron-400', border: 'border-saffron-400/50', badge: 'Cobrando', text: 'text-saffron-300' },
}

export const tableStateStyle = (state) => STATE_STYLE[state] ?? STATE_STYLE.free

/** Cuánto espera el respaldo si Realtime no trae nada. */
const POLL_MS = 45_000

export const useTableStore = create((set, get) => ({
  tables: [],
  loading: false,
  error: null,
  saving: false,

  setTables: (tables) => set({ tables }),

  /**
   * Carga el mapa. Devuelve las filas ya normalizadas a números: el RPC devuelve
   * numeric, que PostgREST entrega como string, y comparar "50" con 50 en el
   * posicionado del lienzo daría resultados distintos en cada tablet.
   */
  fetchTables: async () => {
    set({ loading: true, error: null })

    const { data, error } = await supabase.rpc('tables_status')

    if (error) {
      set({ loading: false, error: error.message })
      return []
    }

    const rows = (data ?? []).map((row) => ({
      tableId: row.table_id,
      number: Number(row.number),
      label: row.label ?? `Mesa ${row.number}`,
      seats: Number(row.seats),
      shape: row.shape,
      posX: Number(row.pos_x),
      posY: Number(row.pos_y),
      sortOrder: Number(row.sort_order),
      isVirtual: row.is_virtual,
      state: row.state,
      openOrders: Number(row.open_orders),
      amountDue: Number(row.amount_due ?? 0),
      customerNames: row.customer_names ?? '',
    }))

    set({ loading: false, tables: rows })
    return rows
  },

  /**
   * Suscripción Realtime + respaldo por polling.
   *
   * Se escucha `orders` y `order_payments` porque lo que cambia el color de una
   * mesa es el avance o el cobro de una orden, no la mesa misma. Escuchar
   * restaurant_tables solo serviría para que un cambio de layout se refleje, que
   * es un evento mucho más raro.
   *
   * El interval se limpia junto con el canal: si la pantalla se desmonta y el canal
   * se queda, los eventos seguirían llegando a un componente que ya no existe.
   */
  subscribe: (channelName = 'tables') => {
    const refresh = () => {
      get().fetchTables()
    }

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_payments' }, refresh)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'restaurant_tables' },
        refresh,
      )
      .subscribe()

    const poll = setInterval(refresh, POLL_MS)

    return () => {
      clearInterval(poll)
      supabase.removeChannel(channel)
    }
  },

  /**
   * Crea o actualiza una mesa. Exige PIN de admin en el servidor.
   *
   * `adminPin` se puede pasar explícitamente para que el panel de Administración
   * use el PIN que ya validó al entrar; si no se pasa, usa el PIN del empleado
   * que inició sesión. En el POS bastaría el segundo, pero editar el layout es
   * una tarea de gerente.
   */
  saveTable: async ({ tableId = null, number, label, seats, shape, posX, posY, isActive, adminPin }) => {
    const pin = adminPin ?? useAuthStore.getState().pin
    if (!pin) {
      set({ error: 'Se necesita el PIN de administrador' })
      return false
    }

    set({ saving: true, error: null })

    const { error } = await supabase.rpc('save_table', {
      p_admin_pin: pin,
      p_number: number,
      p_table_id: tableId,
      p_label: label,
      p_seats: seats,
      p_shape: shape,
      p_pos_x: posX,
      p_pos_y: posY,
      p_is_active: isActive,
    })

    if (error) {
      set({ saving: false, error: error.message })
      return false
    }

    set({ saving: false })
    await get().fetchTables()
    return true
  },

  /**
   * Mueve una mesa. Se llama al SOLTAR, no durante el arrastre: mandar una ida a
   * la base por cada píxel del dedo saturaría la conexión en una tablet.
   */
  moveTable: async (tableId, posX, posY, adminPin) => {
    const pin = adminPin ?? useAuthStore.getState().pin
    if (!pin) {
      set({ error: 'Se necesita el PIN de administrador' })
      return false
    }

    // Optimista: la ficha se queda donde la dejó el dedo y se reconcilia al volver
    // la respuesta. Una tablet con wi-fi lento se sentiría pegada si esperara al
    // servidor en cada movimiento.
    set((state) => ({
      tables: state.tables.map((t) =>
        t.tableId === tableId ? { ...t, posX: Number(posX), posY: Number(posY) } : t,
      ),
    }))

    const { error } = await supabase.rpc('move_table', {
      p_admin_pin: pin,
      p_table_id: tableId,
      p_pos_x: posX,
      p_pos_y: posY,
    })

    if (error) {
      set({ error: error.message })
      await get().fetchTables()
      return false
    }

    return true
  },

  clearError: () => set({ error: null }),
}))