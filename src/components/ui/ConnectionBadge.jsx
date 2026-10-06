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
  const { isOnline, isRecovering, pendingOfflineOrders } = useConnectionStore()
  const online = isOnline ?? true
  const pendingCount = pendingOfflineOrders?.length ?? 0

  if (online && !isRecovering && pendingCount === 0) return null

  return (
    <div
      aria-live="polite"
      className={`fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-2xl
                  px-4 py-2.5 text-xs font-bold shadow-glass border backdrop-blur-xl transition-all
                  ${online
        ? 'bg-saffron-400/15 text-saffron-400 border-saffron-400/40'
        : 'bg-emberred-500/20 text-emberred-300 border-emberred-500/50'}`}
    >
      {online ? (
        <>
          <WifiIcon className="h-4 w-4 animate-pulse" />
          <span>Sincronizando {pendingCount > 0 ? `(${pendingCount} órdenes)` : ''}…</span>
        </>
      ) : (
        <>
          <WifiOffIcon className="h-4 w-4" />
          <span>Modo Offline {pendingCount > 0 ? `· ${pendingCount} pendiente(s)` : ''}</span>
        </>
      )}
    </div>
  )
}
