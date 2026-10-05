/*
 * Estado de conectividad compartido por toda la app.
 *
 * La mayoría de las pantallas sólo consultan `isOnline`; el bootstrap nativo
 * (src/lib/capacitorBoot.js) escribe aquí el estado real y dispara eventos DOM
 * para que cada pantalla rehaga su fetch. Mantener la lógica de red en un store
 * evita importar Capacitor en componentes que también corren en web.
 */
import { create } from 'zustand'

const INITIAL_ONLINE =
  typeof navigator !== 'undefined' ? navigator.onLine !== undefined : true

export const useConnectionStore = create((set) => ({
  isOnline: INITIAL_ONLINE,
  isRecovering: false,
  lastSyncAt: null,
  connecting: false,

  setOnline: (online) =>
    set((state) => ({
      isOnline: online,
      lastSyncAt: online && !state.lastSyncAt ? new Date().toISOString() : state.lastSyncAt,
    })),
  setRecovering: (v) => set({ isRecovering: v }),
  tickSync: () => set({ lastSyncAt: new Date().toISOString() }),
}))

// Eventos de ventana que disparan la recuperación. Las pantallas escuchan estos
// eventos para re-fetch: evita que cada listener importe Capacitor.
export const CONNECTION_EVENTS = {
  ONLINE: 'app:online',
  RESUME: 'app:resume',
  BACK: 'app:backbutton',
}
