import { Fragment, useEffect, useState } from 'react'
import { Ban, Loader2, RefreshCw, Search } from 'lucide-react'
import TouchButton from '../../TouchButton'
import supabase from '../../../lib/supabase'
import { formatMXN } from '../../../lib/format'
import { INPUT, PANEL, PANEL_TITLE } from '../fields'
import RangePicker from './RangePicker'
import {
  buildPresets,
  defaultRange,
  localDateTime,
  rangeLabel,
} from './reportHelpers'

/**
 * Historial de órdenes con filtros y anulación.
 *
 * La anulación vive aquí, y no solo en la pantalla de cocina, porque la mayoría de los
 * errores de cobro se detectan horas después: el ticket ya salió del tablero y sin este
 * historial no había forma de arreglarlo.
 */

const STATUS_FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'completed', label: 'Cobradas' },
  { id: 'cancelled', label: 'Anuladas' },
]

const STATUS_STYLE = {
  completed: 'bg-jade-500/15 text-jade-300',
  cancelled: 'bg-emberred-500/15 text-emberred-400',
  pending: 'bg-saffron-400/15 text-saffron-400',
  in_kitchen: 'bg-saffron-400/15 text-saffron-400',
  ready: 'bg-jade-500/15 text-jade-300',
  served: 'bg-white/10 text-bone-muted',
}

const STATUS_LABEL = {
  completed: 'Cobrada',
  cancelled: 'Anulada',
  pending: 'Pendiente',
  in_kitchen: 'En cocina',
  ready: 'Lista',
  served: 'Servida',
}

const PAYMENT_LABEL = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' }

export default function OrderHistoryPanel({ adminPin }) {
  const [range, setRange] = useState(() => defaultRange())
  const [status, setStatus] = useState('completed')
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [detailFor, setDetailFor] = useState(null)
  const [detail, setDetail] = useState([])
  const [voiding, setVoiding] = useState(null)

  const presets = buildPresets()

  const load = async () => {
    setLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('search_orders', {
      p_admin_pin: adminPin,
      p_query: appliedQuery,
      p_from: range.from,
      p_to: range.to,
      p_status: status === 'all' ? null : status,
      p_limit: 50,
    })

    setLoading(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    if (data === null) {
      setError('Autorización de administrador fallida')
      return
    }
    setOrders(data)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminPin, range.from, range.to, status, appliedQuery])

  const openDetail = async (order) => {
    if (detailFor === order.id) {
      setDetailFor(null)
      return
    }
    setDetailFor(order.id)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('order_detail', {
      p_admin_pin: adminPin,
      p_order_id: order.id,
    })

    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setDetail(data ?? [])
  }

  return (
    <div className="space-y-4">
      <section className={PANEL}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className={PANEL_TITLE}>Historial de órdenes</h2>
          <TouchButton variant="ghost" onClick={load} disabled={loading} className="px-3 py-2 text-xs">
            <RefreshCw size={14} /> Recargar
          </TouchButton>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <form
            className="flex min-w-[15rem] flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setAppliedQuery(query.trim())
            }}
          >
            <div className="relative flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-bone-faint"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ticket, mesa o cliente"
                aria-label="Buscar orden por ticket, mesa o cliente"
                className={`${INPUT} py-2 pl-9 text-sm`}
              />
            </div>
            <TouchButton type="submit" variant="secondary" className="min-h-0 px-3 py-2 text-xs">
              Buscar
            </TouchButton>
          </form>

          <div className="flex gap-1.5">
            {STATUS_FILTERS.map((filter) => (
              <TouchButton
                key={filter.id}
                variant="secondary"
                onClick={() => setStatus(filter.id)}
                aria-pressed={status === filter.id}
                className={`min-h-0 rounded-lg px-3 py-2 text-xs ${
                  status === filter.id ? 'border-saffron-400/60 text-saffron-400' : ''
                }`}
              >
                {filter.label}
              </TouchButton>
            ))}
          </div>
        </div>

        <RangePicker range={range} onChange={setRange} presets={presets} />

        {error && (
          <p role="alert" className="mt-4 text-sm font-medium text-emberred-400">
            {error}
          </p>
        )}

        {loading ? (
          <p className="flex items-center justify-center gap-2 py-16 text-bone-muted">
            <Loader2 className="animate-spin" size={18} /> Buscando…
          </p>
        ) : orders.length === 0 ? (
          <p className="py-16 text-center text-sm text-bone-muted">
            No hay órdenes con esos filtros en {rangeLabel(range.from, range.to)}.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className={PANEL_TITLE}>
                <tr>
                  <th className="px-2 py-3">Ticket</th>
                  <th className="px-2 py-3">Estado</th>
                  <th className="px-2 py-3">Cliente</th>
                  <th className="px-2 py-3">Cobro</th>
                  <th className="px-2 py-3">Total</th>
                  <th className="px-2 py-3">Fecha</th>
                  <th className="px-2 py-3">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  // El fragmento lleva la key, no el <tr>: la fila y su detalle se pintan
                  // siempre juntos y React necesita un solo nodo identificado por orden.
                  <Fragment key={order.id}>
                    <tr className="border-b border-white/5">
                      <td className="px-2 py-3">
                        <button
                          type="button"
                          onClick={() => openDetail(order)}
                          aria-expanded={detailFor === order.id}
                          className="font-ticket font-bold text-saffron-400 underline-offset-2 hover:underline"
                        >
                          #{order.code}
                        </button>
                        <span className="ml-2 text-xs text-bone-faint">
                          {order.table_number ? `Mesa ${order.table_number}` : ''}
                        </span>
                      </td>
                      <td className="px-2 py-3">
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[0.7rem] font-semibold ${STATUS_STYLE[order.status] ?? 'bg-white/10 text-bone-muted'}`}
                        >
                          {STATUS_LABEL[order.status] ?? order.status}
                        </span>
                        {order.void_reason && (
                          <span className="mt-1 block text-xs text-bone-muted">{order.void_reason}</span>
                        )}
                      </td>
                      <td className="px-2 py-3 text-bone-muted">
                        {order.customer_name ?? '—'}
                        {order.employee_name && (
                          <span className="block text-xs text-bone-faint">{order.employee_name}</span>
                        )}
                      </td>
                      <td className="px-2 py-3 text-bone-muted">
                        {order.payment_method ? PAYMENT_LABEL[order.payment_method] : '—'}
                      </td>
                      <td className="px-2 py-3 font-ticket font-bold">{formatMXN(order.total)}</td>
                      <td className="px-2 py-3 text-xs text-bone-faint">
                        {order.paid_at ? localDateTime(order.paid_at) : '—'}
                      </td>
                      <td className="px-2 py-3 text-right">
                        {order.status !== 'cancelled' && (
                          <TouchButton
                            variant="ghost"
                            onClick={() => setVoiding(order)}
                            aria-label={`Anular el ticket ${order.code}`}
                            className="min-h-0 rounded-lg px-2.5 py-2 text-xs text-emberred-400"
                          >
                            <Ban size={15} />
                          </TouchButton>
                        )}
                      </td>
                    </tr>

                    {detailFor === order.id && (
                      <tr>
                        <td colSpan={7} className="bg-ink-900/60 px-4 py-3">
                          {detail.length === 0 ? (
                            <p className="text-sm text-bone-muted">Cargando detalle…</p>
                          ) : (
                            <ul className="space-y-1 text-sm">
                              {detail.map((line) => (
                                <li key={line.item_id} className="flex justify-between gap-3">
                                  <span className="text-bone-muted">
                                    {line.quantity} × {line.current_name ?? line.item_name}
                                    {line.current_name && line.current_name !== line.item_name && (
                                      <span className="ml-1 text-xs text-bone-faint">
                                        (antes: {line.item_name})
                                      </span>
                                    )}
                                    {line.notes && (
                                      <span className="ml-1 text-xs text-saffron-400">“{line.notes}”</span>
                                    )}
                                  </span>
                                  <span className="shrink-0 font-ticket">
                                    {formatMXN(Number(line.quantity) * Number(line.price))}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {voiding && (
        <VoidDialog
          order={voiding}
          onCancel={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null)
            setDetailFor(null)
            load()
          }}
        />
      )}
    </div>
  )
}

/**
 * Anulación.
 *
 * El motivo se pide siempre y es obligatorio: el servidor lo rechaza si viene vacío, y una
 * venta cobrada además exige PIN de administrador. Cuando void_order devuelve una fila
 * vacía, el motivo es que el PIN no cuadró; no es un error, así que la UI pide el PIN y
 * reintenta sin perder lo que el usuario ya escribió.
 */
function VoidDialog({ order, onCancel, onDone }) {
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [needsPin, setNeedsPin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    if (!reason.trim()) {
      setError('Escribe el motivo de la anulación')
      return
    }
    if (needsPin && !pin) {
      setError('Escribe el PIN de administrador')
      return
    }

    setBusy(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('void_order', {
      p_order_id: order.id,
      p_reason: reason.trim(),
      p_admin_pin: needsPin ? pin : null,
    })

    if (rpcError) {
      setBusy(false)
      setError(rpcError.message)
      return
    }
    if (!data || data.length === 0) {
      // Fila vacía: la orden estaba cobrada y el PIN no sirvió. Se pide y se reintenta.
      setBusy(false)
      setNeedsPin(true)
      setError('El PIN de administrador no es correcto')
      return
    }

    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/80 p-4">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-ink-800 p-5 shadow-glass">
        <h3 className="font-display text-xl font-bold">Anular ticket #{order.code}</h3>
        <p className="mt-1 text-sm text-bone-muted">
          {formatMXN(order.total)} · {order.customer_name ?? 'sin nombre'}
        </p>

        <p className="mt-3 text-sm text-bone-muted">
          El motivo queda guardado en el historial y es la única explicación que verá el
          administrador. Si el ticket ya se cobró, el stock del producto vuelve a existir.
        </p>

        <div className="mt-4">
          <label htmlFor="void-reason" className="mb-1.5 block text-sm font-medium text-bone-muted">
            Motivo
          </label>
          <input
            id="void-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Error de comanda, cobro doble…"
            autoFocus
            className={INPUT}
          />
        </div>

        {needsPin && (
          <div className="mt-3">
            <label htmlFor="void-pin" className="mb-1.5 block text-sm font-medium text-bone-muted">
              PIN de administrador
            </label>
            <input
              id="void-pin"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              maxLength={4}
              placeholder="PIN"
              className={`${INPUT} text-center font-ticket text-xl tracking-[0.4em]`}
            />
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-emberred-400">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <TouchButton variant="ghost" onClick={onCancel} disabled={busy} className="flex-1">
            Cancelar
          </TouchButton>
          <TouchButton
            onClick={submit}
            disabled={busy || !reason.trim()}
            className="flex-1 bg-emberred-500 text-ink-900 hover:bg-emberred-400"
          >
            {busy ? <Loader2 className="animate-spin" size={16} /> : 'Anular'}
          </TouchButton>
        </div>
      </div>
    </div>
  )
}
