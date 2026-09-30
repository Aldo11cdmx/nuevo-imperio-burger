import { useEffect } from 'react'
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'

/**
 * Aviso táctil de confirmación. Se cierra solo tras `duration` ms o al tocar la X.
 * onDismiss debe ser estable (useCallback) para no reiniciar el temporizador.
 */
export default function Toast({ toast, onDismiss, duration = 4500 }) {
  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(onDismiss, duration)
    return () => clearTimeout(timer)
  }, [toast, onDismiss, duration])

  if (!toast) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      <div
        className={`pointer-events-auto flex w-full max-w-md animate-slide-up items-center gap-3 rounded-2xl border bg-carbon-800 px-4 py-4 shadow-2xl shadow-black/60 ${
          toast.tone === 'error' ? 'border-red-500/50' : 'border-emerald-500/40'
        }`}
      >
        {toast.tone === 'error' ? (
          <AlertTriangle className="shrink-0 text-red-400" size={28} />
        ) : (
          <CheckCircle2 className="shrink-0 text-emerald-400" size={30} />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-tight">{toast.title}</p>
          {toast.detail && <p className="mt-0.5 text-sm text-ash-300">{toast.detail}</p>}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar aviso"
          className="-mr-1 shrink-0 rounded-lg p-3 text-ash-300 transition-colors active:bg-carbon-700"
        >
          <X size={20} />
        </button>
      </div>
    </div>
  )
}
