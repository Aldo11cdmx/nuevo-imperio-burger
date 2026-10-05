/*
 * Bootstrap nativo (solo dentro de la APK).
 *
 * No se importa Capacitor en ninguna página: todo lo nativo vivo aquí y expone
 * eventos DOM ('app:online', 'app:resume') que el resto de la app consume. Así las
 * páginas corren igual en web (vite preview) y en Android.
 *
 * Responsabilidades:
 *  - SplashScreen.hide() cuando la web ya terminó de pintar (no antes), para que el
 *    splash cubra el tiempo de inicio de sesión + datos iniciales.
 *  - KeepAwake: pantalla encendida todo el turno (tablet de mostrador).
 *  - Network + appStateChange: mantener useConnectionStore al día y disparar la
 *    recuperación en las pantallas vía eventos DOM.
 *  - Heartbeat: cada 30 s marca una sync; las páginas vivas escuchan 'app:resume'
 *    para re-suscribirse si el canal cayó mientras la app dormía.
 */
import { App } from '@capacitor/app'
import { SplashScreen } from '@capacitor/splash-screen'
import { Network } from '@capacitor/network'
import { Capacitor } from '@capacitor/core'
import { KeepAwake } from '@capacitor-community/keep-awake'
import { useConnectionStore, CONNECTION_EVENTS } from '../store/useConnectionStore'
import { useAuthStore } from '../store/useAuthStore'

const isNative = Capacitor.isPluginAvailable('SplashScreen')

let heartbeatId = null
let cleanups = []

function dispatch(name) {
  window.dispatchEvent(new Event(name))
}

export async function initCapacitor() {
  if (!isNative) return () => {} // web: nada que hacer

  try {
    const { connected } = await Network.getStatus()
    useConnectionStore.getState().setOnline(connected)
  } catch {
    useConnectionStore.getState().setOnline(true)
  }
  try {
    if (Capacitor.isPluginAvailable('KeepAwake')) {
      await KeepAwake.keepAwake({ keepAwake: true })
    }
  } catch {}

  const netListener = Network.addListener('networkStatusChange', (status) => {
    useConnectionStore.getState().setOnline(status.connected)
    if (status.connected) {
      useConnectionStore.getState().setRecovering(true)
      dispatch(CONNECTION_EVENTS.ONLINE)
    } else {
      useConnectionStore.getState().setRecovering(false)
    }
  })

  const appListener = App.addListener('appStateChange', (state) => {
    if (state.isActive) {
      useAuthStore.getState().refreshSession()
      dispatch(CONNECTION_EVENTS.RESUME)
      useConnectionStore.getState().tickSync()
    }
  })

  heartbeatId = setInterval(() => {
    const { isOnline, isRecovering } = useConnectionStore.getState()
    if (isOnline && !isRecovering) {
      useConnectionStore.getState().tickSync()
    }
  }, 30_000)

  const hideSplash = async () => {
    try {
      await SplashScreen.hide()
    } catch {}
  }
  if (typeof document !== 'undefined' && document.readyState !== 'complete') {
    window.addEventListener('load', hideSplash)
    cleanups.push(() => window.removeEventListener('load', hideSplash))
  } else {
    setTimeout(hideSplash, 600)
  }

  cleanups.push(() => netListener.remove(), () => appListener.remove())
  return () => {
    cleanups.forEach((fn) => fn())
    cleanups = []
    if (heartbeatId) clearInterval(heartbeatId)
  }
}

export { isNative }
