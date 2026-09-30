import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Flame, ShieldCheck } from 'lucide-react'
import PinKeypad from '../components/PinKeypad'
import TouchButton from '../components/TouchButton'
import { useAuthStore } from '../store/useAuthStore'

const PIN_LENGTH = 4

export default function Login() {
  const [pin, setPin] = useState('')
  const { signInWithPin, loading, error, clearError } = useAuthStore()
  const navigate = useNavigate()
  const timerRef = useRef(null)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const submit = useCallback(
    async (value) => {
      const { data } = await signInWithPin(value)

      if (data) {
        navigate(data.role === 'admin' ? '/admin' : '/pos')
        return
      }

      // Un PIN fallido se borra solo: en un POS hay que poder reintentar al instante
      // sin tocar "limpiar" primero.
      timerRef.current = setTimeout(() => setPin(''), 650)
    },
    [signInWithPin, navigate],
  )

  const handleDigit = (digit) => {
    if (pin.length >= PIN_LENGTH || loading) return
    clearError()
    const next = pin + digit
    setPin(next)
    if (next.length === PIN_LENGTH) submit(next)
  }

  const handleBackspace = () => {
    if (loading) return
    clearError()
    setPin((value) => value.slice(0, -1))
  }

  const handleClear = () => {
    if (loading) return
    clearError()
    setPin('')
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-saffron-grad shadow-glow">
            <Flame className="text-ink-950" size={34} strokeWidth={2.4} />
          </span>
          <p className="font-display text-3xl leading-none font-bold tracking-tight sm:text-4xl">
            Nuevo Imperio
          </p>
          <p className="mt-2 text-sm font-semibold tracking-[0.36em] text-saffron-400 uppercase">Burger</p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 shadow-glass backdrop-blur-2xl sm:p-7">
          <h1 className="text-center text-sm font-medium tracking-wide text-bone-muted">
            Ingreso de empleado
          </h1>

          <div className="mt-5 mb-6 flex items-center justify-center gap-3" role="status" aria-live="polite">
            {Array.from({ length: PIN_LENGTH }, (_, index) => (
              <span
                key={index}
                aria-hidden="true"
                className={`h-3.5 w-3.5 rounded-full transition-all duration-200 ${
                  index < pin.length ? 'scale-110 bg-saffron-400' : 'scale-100 bg-white/15'
                }`}
              />
            ))}
          </div>

          <div className="mb-5 flex min-h-[3.25rem] items-center justify-center">
            {error ? (
              <div
                role="alert"
                className="flex animate-shake items-start gap-2.5 rounded-2xl border border-emberred-500/40 bg-emberred-500/10 px-4 py-2.5"
              >
                <AlertTriangle className="mt-0.5 shrink-0 text-emberred-400" size={18} />
                <p className="text-sm leading-snug font-medium text-emberred-400">{error}</p>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-xs text-bone-muted">
                <ShieldCheck size={15} />
                Tu PIN no se almacena en texto plano
              </p>
            )}
          </div>

          <PinKeypad
            disabled={loading}
            onDigit={handleDigit}
            onClear={handleClear}
            onBackspace={handleBackspace}
          />

          <TouchButton
            variant="ghost"
            className="mt-4 w-full text-sm"
            disabled={pin.length !== PIN_LENGTH || loading}
            onClick={() => submit(pin)}
          >
            {loading ? 'Validando…' : 'Entrar'}
          </TouchButton>
        </div>
      </div>
    </main>
  )
}
