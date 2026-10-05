import { useConnectionStore } from '../../store/useConnectionStore'

function WifiIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 20h.01M2 8l10 12 10-12" />
    </svg>
  )
}

function WifiOffIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="12" y1="20" x2="12.01" y2="20" />
      <path d="M2 8 4.94 11.47a10.27 10.27 0 0 1 3.38-2.1M7 15.5A11.05 11.05 0 0 1 12 14c2.32 0 4.45.85 6 2.23L22 20" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

export default function ConnectionBadge() {
  const { isOnline, isRecovering, tickSync } = useConnectionStore()
  const online = isOnline ?? true

  if (online && !isRecovering) return null

  return (
    <div
      aria-live="polite"
      className={`fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full
                  px-3 py-2 text-sm font-medium shadow-lg
                  ${online
        ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
        : 'bg-rose-50 text-rose-800 ring-1 ring-rose-200'}`}
    >
      {online ? (
        <>
          <WifiIcon className="h-4 w-4 animate-pulse" />
          Reconectando… {tickSync()}
        </>
      ) : (
        <>
          <WifiOffIcon className="h-4 w-4" />
          Sin conexión
        </>
      )}
    </div>
  )
}
