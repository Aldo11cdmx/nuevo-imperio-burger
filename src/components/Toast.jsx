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

  const isError = toast.tone === 'error'

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      <div
        className={`pointer-events-auto flex w-full max-w-md animate-slide-up items-center gap-3 rounded-2xl border bg-ink-800/85 px-4 py-4 shadow-glass backdrop-blur-xl ${
          isError ? 'border-emberred-500/50' : 'border-jade-500/40'
        }`}
      >
        {isError ? (
          <AlertTriangle className="shrink-0 text-emberred-400" size={28} />
        ) : (
          <CheckCircle2 className="shrink-0 text-jade-400" size={30} />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-base leading-tight font-bold">{toast.title}</p>
          {toast.detail && <p className="mt-0.5 text-sm text-bone-muted">{toast.detail}</p>}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar aviso"
          className="-mr-1 shrink-0 rounded-xl p-3 text-bone-muted transition-colors active:bg-white/10"
        >
          <X size={20} />
        </button>
      </div>
    </div>
  )
}
