import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Loader2, LogOut, Receipt, Wallet, XCircle } from 'lucide-react'
import ScreenHeader from '../components/ScreenHeader'
import Toast from '../components/Toast'
import TouchButton from '../components/TouchButton'
import { INPUT, PANEL, PANEL_TITLE } from '../components/admin/fields'
import { formatMXN } from '../lib/format'
import { useAuthStore } from '../store/useAuthStore'
import { useExpenseStore } from '../store/useExpenseStore'
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

/**
 * Gastos de caja chica del turno.
 *
 * Salidas de efectivo: lo que se sacó de la gaveta para comprar hielo, una servilleta o
 * pagar el flete. No es una venta ni un descuento, es dinero que se fue, y por eso tiene
 * su propia lista y su propio formulario en vez de esconderse dentro del corte.
 *
 * Va arriba del corte Z a propósito. Quien va a cerrar necesita ver cuánto salió antes de
 * capturar lo contado, porque el esperado ya lo descuenta: si el gasto se anotara
 * después de contar, el cajero compararía su gaveta contra un número que todavía no
 * incluía el gasto y vería un faltante que no existe.
 */
function ExpensesPanel({ disabled }) {
  const expenses = useExpenseStore((state) => state.expenses)
  const loading = useExpenseStore((state) => state.loading)
  const busyExpenseId = useExpenseStore((state) => state.busyExpenseId)
  const total = useExpenseStore((state) => state.total())
  const register = useExpenseStore((state) => state.register)
  const voidExpense = useExpenseStore((state) => state.void)
  const load = useExpenseStore((state) => state.load)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [voiding, setVoiding] = useState(null)
  const [voidReason, setVoidReason] = useState('')

  // Un gasto anulado sigue en la lista pero tachado: se ve que se corrigió algo y quién
  // lo hizo, en vez de desaparecer. Ocultarlo haría que un gasto real y uno anulado
  // fueran indistinguibles al final del turno.
  const active = expenses.filter((expense) => !expense.voided_at)
  const voided = expenses.filter((expense) => expense.voided_at)

  const submit = async (event) => {
    event.preventDefault()
    const created = await register(amount, reason)
    if (created) {
      setAmount('')
      setReason('')
    }
  }

  const submitVoid = async (event) => {
    event.preventDefault()
    const done = await voidExpense(voiding, voidReason)
    if (done) {
      setVoiding(null)
      setVoidReason('')
    }
  }

  return (
    <section className="mt-4 border-t border-dashed border-white/15 pt-5">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <p className={PANEL_TITLE}>Gastos de caja</p>
        <span className="font-ticket text-lg font-bold text-emberred-400">
          −{formatMXN(total)}
        </span>
      </div>
      <p className="mb-4 text-sm text-bone-muted">
        Dinero que salió de la gaveta durante el turno. Se descuenta del efectivo esperado,
        así que anótalo antes de contar.
      </p>

      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[9rem_1fr]">
        <div>
          <label htmlFor="expense-amount" className="mb-1.5 block text-sm font-medium text-bone-muted">
            Monto
          </label>
          <input
            id="expense-amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            placeholder="0.00"
            className={`${INPUT} text-center font-ticket`}
          />
        </div>
        <div>
          <label htmlFor="expense-reason" className="mb-1.5 block text-sm font-medium text-bone-muted">
            En qué se gastó
          </label>
          <input
            id="expense-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Hielo, servilletas, flete…"
            className={INPUT}
          />
        </div>
        <TouchButton
          type="submit"
          variant="secondary"
          className="sm:col-span-2"
          disabled={disabled || loading || amount === '' || reason.trim() === ''}
        >
          Registrar gasto
        </TouchButton>
      </form>

      {active.length > 0 && (
        <ul className="mt-4 space-y-2">
          {active.map((expense) => (
            <li
              key={expense.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-ink-800/50 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{expense.reason}</p>
                <p className="text-xs text-bone-faint">
                  {expense.by_name} · {new Date(expense.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-ticket font-bold text-emberred-400">{formatMXN(expense.amount)}</span>
                {!disabled && (
                  <TouchButton
                    variant="ghost"
                    className="px-2 py-1.5 text-xs"
                    aria-label={`Anular el gasto ${expense.reason}`}
                    onClick={() => setVoiding(expense.id)}
                  >
                    <XCircle size={15} />
                  </TouchButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {voided.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-bone-faint">
            {voided.length} {voided.length === 1 ? 'gasto anulado' : 'gastos anulados'}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {voided.map((expense) => (
              <li key={expense.id} className="px-3 text-sm text-bone-faint">
                <span className="line-through">{expense.reason}</span> · {formatMXN(expense.amount)}
                {expense.void_reason && <span> — anulado: {expense.void_reason}</span>}
                {expense.voided_by && <span> ({expense.voided_by})</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {voiding && (
        <form onSubmit={submitVoid} className="mt-3 rounded-xl border border-emberred-500/40 bg-emberred-500/10 p-3">
          <p className="text-sm font-medium text-emberred-400">¿Por qué se anula este gasto?</p>
          <p className="mt-1 text-xs text-bone-muted">
            El gasto no se borra: queda registrado con el motivo para que el corte se pueda
            revisar después.
          </p>
          <input
            value={voidReason}
            onChange={(event) => setVoidReason(event.target.value)}
            placeholder="Motivo de la anulación"
            autoFocus
            className={`${INPUT} mt-2`}
          />
          <div className="mt-2 flex gap-2">
            <TouchButton variant="ghost" className="flex-1 py-2 text-sm" onClick={() => setVoiding(null)}>
              Cancelar
            </TouchButton>
            <TouchButton
              type="submit"
              variant="secondary"
              className="flex-1 py-2 text-sm"
              disabled={voidReason.trim() === '' || busyExpenseId === voiding}
            >
              {busyExpenseId === voiding ? 'Anulando…' : 'Anular gasto'}
            </TouchButton>
          </div>
        </form>
      )}

      {expenses.length === 0 && !disabled && (
        <p className="mt-3 text-xs text-bone-faint">
          Sin gastos registrados. Los gastos solo se pueden anotar con el turno abierto.
        </p>
      )}

      {disabled && expenses.length > 0 && (
        <p className="mt-3 text-xs text-bone-faint">
          El turno está cerrado: los gastos ya entraron en el corte y no se pueden modificar.
        </p>
      )}

      {!disabled && expenses.length > 0 && (
        <TouchButton variant="ghost" className="mt-3 px-3 py-1.5 text-xs" onClick={load} disabled={loading}>
          Recargar
        </TouchButton>
      )}
    </section>
  )
}

/** Corte X: lo que hay en la gaveta ahora mismo. Solo lectura, no cierra nada. */
function OpenShiftPanel({ shift, onClose }) {
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const closeShift = useShiftStore((state) => state.closeShift)
  const loading = useShiftStore((state) => state.loading)
  const error = useShiftStore((state) => state.error)
  const expenseTotal = useExpenseStore((state) => state.total())
  const [receipt, setReceipt] = useState(null)

  const countedValue = Number(counted)
  const countedValid = counted !== '' && Number.isFinite(countedValue) && countedValue >= 0
  // La diferencia se calcula aquí para que el cajero vea el número mientras cuenta, no
  // después de confirmar. El servidor lo vuelve a calcular: esta vista es una ayuda, no
  // la fuente de verdad.
  const expected = Math.round((Number(shift.opening_float) + Number(shift.cash_sales) - expenseTotal) * 100) / 100
  const difference = countedValid ? Math.round((countedValue - expected) * 100) / 100 : null

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
          {Number(receipt.expenses) !== 0 && (
            <Row label="Gastos de caja" value={`−${formatMXN(receipt.expenses)}`} tone="bad" />
          )}
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

      {expenseTotal !== 0 && (
        <p className="mt-3 flex items-center gap-2 rounded-xl border border-emberred-500/30 bg-emberred-500/5 px-3 py-2 text-sm text-emberred-400">
          <Receipt size={15} />
          Gastos de caja: −{formatMXN(expenseTotal)}. El efectivo esperado ya los descuenta.
        </p>
      )}

      <ExpensesPanel />

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
  const loadExpenses = useExpenseStore((state) => state.load)
  const expenseError = useExpenseStore((state) => state.error)
  const [toast, setToast] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!employee) {
      navigate('/', { replace: true })
      return
    }
    // Los gastos se piden después de que se resuelva el turno, y no en paralelo: sin turno
    // abierto la RPC no devuelve nada, así que llamarla antes solo gastaría una ida al
    // servidor para recibir una lista vacía.
    loadMyShift().then((mine) => {
      if (mine) loadExpenses()
    })
  }, [employee, loadMyShift, loadExpenses, navigate])

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
            onOpened={() => {
              // El turno recién abierto empieza con cero gastos, pero la lista se pide
              // igual: si el mismo empleado tenía un turno anterior del que quedó alguna
              // lectura en el store, esto lo reemplaza por la del turno nuevo.
              loadExpenses()
              setToast({ tone: 'success', title: 'Turno abierto', detail: 'Ya puedes cobrar en el POS.' })
            }}
          />
        )}

        {shift && <OpenShiftPanel shift={shift} onClose={() => loadMyShift()} />}

        {error && !shift && (
          <p role="alert" className="mt-4 text-sm font-medium text-emberred-400">
            {error}
          </p>
        )}

        {expenseError && shift && (
          <p role="alert" className="mt-4 text-sm font-medium text-emberred-400">
            {expenseError}
          </p>
        )}
      </main>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
