/*
 * Estado de conectividad compartido por toda la app.
 *
 * La mayoría de las pantallas sólo consultan `isOnline`; el bootstrap nativo
 * (src/lib/capacitorBoot.js) escribe aquí el estado real y dispara eventos DOM
 * para que cada pantalla rehaga su fetch. Mantener la lógica de red en un store
 * evita importar Capacitor en componentes que también corren en web.
 */
import { create } from 'zustand'
import { getJSON, setJSON } from '../lib/storage'
import supabase from '../lib/supabase'

const OFFLINE_QUEUE_KEY = 'nib:offline_orders'
const INITIAL_ONLINE =
  typeof navigator !== 'undefined' ? navigator.onLine !== false : true

export const useConnectionStore = create((set, get) => ({
  isOnline: INITIAL_ONLINE,
  isRecovering: false,
  lastSyncAt: null,
  pendingOfflineOrders: [],

  setOnline: (online) => {
    set((state) => ({
      isOnline: online,
      lastSyncAt: online && !state.lastSyncAt ? new Date().toISOString() : state.lastSyncAt,
    }))
    if (online) {
      get().syncOfflineOrders()
    }
  },

  setRecovering: (v) => set({ isRecovering: v }),
  tickSync: () => set({ lastSyncAt: new Date().toISOString() }),

  /** Carga la cola de órdenes offline guardadas localmente */
  loadOfflineOrders: async () => {
    const queue = await getJSON(OFFLINE_QUEUE_KEY, [])
    set({ pendingOfflineOrders: queue })
    return queue
  },

  /** Guarda una orden en la cola temporal cuando no hay red */
  saveOfflineOrder: async (orderPayload) => {
    const queue = await getJSON(OFFLINE_QUEUE_KEY, [])
    const updated = [...queue, { ...orderPayload, offline_id: Date.now() }]
    await setJSON(OFFLINE_QUEUE_KEY, updated)
    set({ pendingOfflineOrders: updated })
    return updated
  },

  /** Sincroniza las órdenes de la cola offline con Supabase al recuperar la red */
  syncOfflineOrders: async () => {
    const queue = await getJSON(OFFLINE_QUEUE_KEY, [])
    if (!queue || queue.length === 0) return

    set({ isRecovering: true })
    const remaining = []

    for (const item of queue) {
      try {
        const { data, error } = await supabase.rpc('create_order', item.payload)
        if (error) {
          remaining.push(item)
        }
      } catch {
        remaining.push(item)
      }
    }

    await setJSON(OFFLINE_QUEUE_KEY, remaining)
    set({ pendingOfflineOrders: remaining, isRecovering: false })
  },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useConnectionStore.getState().setOnline(true)
  })
  window.addEventListener('offline', () => {
    useConnectionStore.getState().setOnline(false)
  })
}

// Eventos de ventana que disparan la recuperación. Las pantallas escuchan estos
// eventos para re-fetch: evita que cada listener importe Capacitor.
export const CONNECTION_EVENTS = {
  ONLINE: 'app:online',
  RESUME: 'app:resume',
  BACK: 'app:backbutton',
}
