import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { CONNECTION_EVENTS } from '../store/useConnectionStore'

/**
 * Botón "atrás" del hardware en la tablet.
 *
 * Prioridad:
 *  1) Si un modal está abriendo (SplitPaymentDialog / TicketPreview), se cierra (el
 *     modal escucha 'app:backbutton' y llama a su onClose).
 *  2) Si el router tiene historial, retrocede.
 *  3) Si está en la raíz, pide confirmación antes de salir (nunca cierra por error).
 *
 * Solo se registra en la APK (no en web).
 */
export function useBackButton() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!Capacitor.isPluginAvailable('App')) return undefined

    const registrar = (evt) => {
      evt.preventDefault()
      // 1) Deja que los modales abiertos cierren el evento (cancelable).
      const handled = !window.dispatchEvent(
        new CustomEvent(CONNECTION_EVENTS.BACK, { cancelable: true }),
      )
      if (handled) return

      // 2) Historial del router.
      if (window.history.length > 1) {
        navigate(-1)
        return
      }

      // 3) Confirmación de salida.
      if (window.confirm('¿Salir de Nuevo Imperio Burger?')) {
        const exit = (e) => {
          if (e.detail?.canGoBack === false) App.exitApp()
        }
        window.addEventListener(CONNECTION_EVENTS.BACK, exit, { once: true })
      }
    }

    const sub = App.addListener('backButton', registrar)
    return () => sub.remove()
  }, [navigate])
}
