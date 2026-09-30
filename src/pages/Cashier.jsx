import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Loader2, LogOut, Wallet } from 'lucide-react'
import ScreenHeader from '../components/ScreenHeader'
import Toast from '../components/Toast'
import TouchButton from '../components/TouchButton'
import { INPUT, PANEL, PANEL_TITLE } from '../components/admin/fields'
import { formatMXN } from '../lib/format'
import { useAuthStore } from '../store/useAuthStore'
import { useShiftStore } from '../store/useShiftStore'

/**
 * Caja: apertura de turno, Corte X (lectura) y Corte Z (cierre).
 *
 * El POS depende de esta pantalla para poder cobrar, así que no es una vista opcional: sin
 * turno abierto, create_order falla y no hay venta.
 */

/** Los tres métodos de pago, en el orden en que aparecen en el corte. */
const METHOD_ROWS = [
  { key: 'cash_sales', label: 'Efectivo' },
  { key: 'card_sales', label: 'Tarjeta' },
  { key: 'transfer_sales', label: 'Transferencia' },
]

function OpenShiftForm({ onOpened }) {
  const openShift = useShiftStore((state) => state.openShift)
  const loading = useShiftStore((state) => state.loading)
  const error = useShiftStore((state) => state.error)
  const [amount, setAmount] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    const value = Number(amount)
    if (!Number.isFinite(value) || value < 0) return
    const shift = await openShift(Math.round(value * 100) / 100)
    if (shift) onOpened(shift)
  }

  return (
    <form onSubmit={submit} className={`${PANEL} max-w-md`}>
      <p className={`${PANEL_TITLE} mb-1`}>Apertura de turno</p>
      <h2 className="font-display text-2xl font-bold">¿Cuánto hay en la gaveta?</h2>
      <p className="mt-2 text-sm text-bone-muted">
        Es el fondo con el que arrancas. Al cerrar, la caja compara ese monto contra lo que
        dice el sistema. Si no cuentas bien, la diferencia aparece en el corte.
      </p>

      <div className="mt-5">
        <label htmlFor="opening-float" className="mb-1.5 block text-sm font-medium text-bone-muted">
          Fondo inicial
        </label>
        <input
          id="opening-float"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
          inputMode="decimal"
          placeholder="0.00"
          autoFocus
          className={`${INPUT} text-center font-ticket text-2xl`}
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-emberred-400">
          {error}
        </p>
      )}

      <TouchButton type="submit" className="mt-5 w-full" disabled={loading || amount === ''}>
        {loading ? (
          <>
            <Loader2 className="animate-spin" size={18} />
            Abriendo…
          </>
        ) : (
          <>
            <Wallet size={18} />
            Abrir turno
          </>
        )}
      </TouchButton>
    </form>
  )
}

/** Corte X: lo que hay en la gaveta ahora mismo. Solo lectura, no cierra nada. */
function OpenShiftPanel({ shift, onClose }) {
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const closeShift = useShiftStore((state) => state.closeShift)
  const loading = useShiftStore((state) => state.loading)
  const error = useShiftStore((state) => state.error)
  const [receipt, setReceipt] = useState(null)

  const countedValue = Number(counted)
  const countedValid = counted !== '' && Number.isFinite(countedValue) && countedValue >= 0
  // La diferencia se calcula aquí para que el cajero vea el número mientras cuenta, no
  // después de confirmar. El servidor lo vuelve a calcular: esta vista es una ayuda, no
  // la fuente de verdad.
  const difference = countedValid ? Math.round((countedValue - shift.opening_float - shift.cash_sales) * 100) / 100 : null

  const submit = async (event) => {
    event.preventDefault()
    if (!countedValid) return
    const report = await closeShift(Math.round(countedValue * 100) / 100, note)
    if (report) setReceipt(report)
  }

  if (receipt) {
    return (
      <div className={`${PANEL} max-w-md`}>
        <div className="mb-4 flex items-center gap-2 text-jade-300">
          <CheckCircle2 size={22} />
          <h2 className="font-display text-xl font-bold">Turno cerrado</h2>
        </div>
        <p className="text-sm text-bone-muted">Este es el corte de caja de hoy.</p>

        <dl className="mt-4 space-y-1.5 text-sm">
          <Row label="Fondo inicial" value={formatMXN(receipt.opening_float)} />
          <Row label="Ventas en efectivo" value={formatMXN(receipt.cash_sales)} />
          <div className="flex justify-between border-t border-dashed border-white/15 pt-1.5 font-bold">
            <dt>Esperado en gaveta</dt>
            <dd className="font-ticket">{formatMXN(receipt.expected_cash)}</dd>
          </div>
          <Row label="Contado" value={formatMXN(receipt.counted_total)} />
          <Row
            label={receipt.cash_difference < 0 ? 'Faltante' : 'Sobrante'}
            value={formatMXN(Math.abs(receipt.cash_difference))}
            tone={receipt.cash_difference === 0 ? 'neutral' : receipt.cash_difference < 0 ? 'bad' : 'good'}
          />
        </dl>

        <TouchButton className="mt-5 w-full" onClick={onClose}>
          Abrir un turno nuevo
        </TouchButton>
      </div>
    )
  }

  return (
    <div className={`${PANEL} max-w-2xl`}>
      <p className={`${PANEL_TITLE} mb-1`}>Corte X · turno abierto</p>
      <h2 className="font-display text-2xl font-bold">Estado de la gaveta</h2>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Fondo" value={formatMXN(shift.opening_float)} />
        <Stat label="Efectivo" value={formatMXN(shift.cash_sales)} />
        <Stat label="Tarjeta" value={formatMXN(shift.card_sales)} />
        <Stat label="Tickets" value={shift.ticket_count} />
      </dl>

      <div className="mt-4 border-t border-white/10 pt-4">
        <p className="text-sm font-semibold">Detalle por método de pago</p>
        <ul className="mt-2 space-y-1 text-sm">
          {METHOD_ROWS.map((row) => (
            <li key={row.key} className="flex justify-between text-bone-muted">
              <span>{row.label}</span>
              <span className="font-ticket">{formatMXN(shift[row.key])}</span>
            </li>
          ))}
          <li className="flex justify-between border-t border-dashed border-white/15 pt-1 font-bold text-bone">
            <span>Total</span>
            <span className="font-ticket">{formatMXN(shift.total_sales)}</span>
          </li>
        </ul>
      </div>

      <form onSubmit={submit} className="mt-6 border-t border-dashed border-white/15 pt-5">
        <p className={`${PANEL_TITLE} mb-3`}>Corte Z · cerrar turno</p>
        <p className="mb-4 text-sm text-bone-muted">
          Cuenta el efectivo de la gaveta y captura el total. No hace falta contar por
          denominación: con una sola cifra el sistema hace la cuenta.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="counted" className="mb-1.5 block text-sm font-medium text-bone-muted">
              Efectivo contado
            </label>
            <input
              id="counted"
              value={counted}
              onChange={(event) => setCounted(event.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              placeholder="0.00"
              className={`${INPUT} text-center font-ticket text-2xl`}
            />
          </div>

          <div>
            <label htmlFor="note" className="mb-1.5 block text-sm font-medium text-bone-muted">
              Nota {difference !== null && difference !== 0 ? '(obligatoria si hay diferencia)' : '(opcional)'}
            </label>
            <input
              id="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Faltante, sobrante, cambio de turno…"
              className={INPUT}
            />
          </div>
        </div>

        {difference !== null && (
          <div
            role="status"
            className={`mt-4 rounded-xl border px-4 py-3 text-sm font-medium ${
              difference === 0
                ? 'border-jade-500/40 bg-jade-500/10 text-jade-300'
                : difference < 0
                  ? 'border-emberred-500/40 bg-emberred-500/10 text-emberred-400'
                  : 'border-saffron-400/40 bg-saffron-400/10 text-saffron-400'
            }`}
          >
            {difference === 0
              ? 'La caja cuadra exactamente.'
              : difference < 0
                ? `Faltan ${formatMXN(Math.abs(difference))} contra lo esperado.`
                : `Sobran ${formatMXN(difference)} sobre lo esperado.`}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-emberred-400">
            {error}
          </p>
        )}

        <TouchButton
          type="submit"
          variant="secondary"
          className="mt-4 w-full"
          disabled={loading || !countedValid}
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" size={18} />
              Cerrando…
            </>
          ) : (
            'Cerrar turno y hacer corte'
          )}
        </TouchButton>
      </form>
    </div>
  )
}

function Row({ label, value, tone = 'neutral' }) {
  const color = tone === 'bad' ? 'text-emberred-400' : tone === 'good' ? 'text-jade-300' : 'text-bone'
  return (
    <div className="flex justify-between">
      <dt className="text-bone-muted">{label}</dt>
      <dd className={`font-ticket ${color}`}>{value}</dd>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-ink-800/60 px-3 py-2.5">
      <dt className="text-[0.7rem] tracking-wider text-bone-muted uppercase">{label}</dt>
      <dd className="font-ticket text-lg font-bold text-saffron-400">{value}</dd>
    </div>
  )
}

export default function Cashier() {
  const employee = useAuthStore((state) => state.employee)
  const signOut = useAuthStore((state) => state.signOut)
  const shift = useShiftStore((state) => state.shift)
  const loading = useShiftStore((state) => state.loading)
  const error = useShiftStore((state) => state.error)
  const loadMyShift = useShiftStore((state) => state.loadMyShift)
  const [toast, setToast] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!employee) {
      navigate('/', { replace: true })
      return
    }
    loadMyShift()
  }, [employee, loadMyShift, navigate])

  if (!employee) return null

  return (
    <div className="flex min-h-dvh flex-col">
      <ScreenHeader
        title="Caja"
        subtitle={shift ? 'Turno abierto' : 'Sin turno abierto'}
        right={
          <div className="flex items-center gap-2">
            <Link to="/pos">
              <TouchButton variant="ghost" className="px-3" aria-label="Volver al punto de venta">
                <ArrowLeft size={18} />
              </TouchButton>
            </Link>
            <TouchButton
              variant="ghost"
              className="px-3"
              aria-label="Cerrar sesión"
              onClick={() => {
                signOut()
                navigate('/', { replace: true })
              }}
            >
              <LogOut size={18} />
            </TouchButton>
          </div>
        }
      />

      <main className="flex-1 p-4 md:p-5">
        {loading && !shift && <p className="py-20 text-center text-bone-muted">Buscando tu turno…</p>}

        {!loading && !shift && (
          <OpenShiftForm
            onOpened={() =>
              setToast({ tone: 'success', title: 'Turno abierto', detail: 'Ya puedes cobrar en el POS.' })
            }
          />
        )}

        {shift && <OpenShiftPanel shift={shift} onClose={() => loadMyShift()} />}

        {error && !shift && (
          <p role="alert" className="mt-4 text-sm font-medium text-emberred-400">
            {error}
          </p>
        )}
      </main>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
