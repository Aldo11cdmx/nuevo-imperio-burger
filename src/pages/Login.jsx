import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
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
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-8 sm:gap-8">
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.4em] text-ember-500 sm:text-sm">
          Sazón &amp; Carbón
        </p>
        <h1 className="mt-2 text-2xl font-black sm:text-4xl">Ingreso de empleado</h1>
      </div>

      <div className="flex items-center gap-3" role="status" aria-live="polite">
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={`h-4 w-4 rounded-full transition-all duration-200 ${
              index < pin.length ? 'scale-110 bg-ember-500' : 'scale-100 bg-carbon-700'
            }`}
          />
        ))}
      </div>

      {error ? (
        <div
          role="alert"
          className="flex w-full max-w-sm animate-[shake_0.35s_ease-in-out] items-start gap-3 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3"
        >
          <AlertTriangle className="mt-0.5 shrink-0 text-red-400" size={20} />
          <p className="text-sm font-medium leading-snug text-red-200">{error}</p>
        </div>
      ) : (
        <p className="flex h-[3.25rem] items-center gap-2 text-sm text-ash-500">
          <ShieldCheck size={16} />
          Tu PIN no se almacena en texto plano
        </p>
      )}

      <div className="w-full max-w-sm">
        <PinKeypad
          disabled={loading}
          onDigit={handleDigit}
          onClear={handleClear}
          onBackspace={handleBackspace}
        />
      </div>

      <TouchButton
        variant="ghost"
        className="text-sm"
        disabled={pin.length !== PIN_LENGTH || loading}
        onClick={() => submit(pin)}
      >
        {loading ? 'Validando…' : 'Entrar'}
      </TouchButton>
    </main>
  )
}
