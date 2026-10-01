import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import ScreenHeader from '../components/ScreenHeader'
import TouchButton from '../components/TouchButton'
import SplitPaymentDialog from '../components/payment/SplitPaymentDialog'
import { INPUT } from '../components/admin/fields'
import { formatMXN } from '../lib/format'
import { ORDER_STATUS, PAYMENT_METHODS, useOrderStore } from '../store/useOrderStore'
import { useShiftStore } from '../store/useShiftStore'

const NEXT_LABEL = {
  [ORDER_STATUS.PENDING]: 'Empezar',
  [ORDER_STATUS.IN_KITCHEN]: 'Marcar listo',
  [ORDER_STATUS.READY]: 'Servir',
  [ORDER_STATUS.SERVED]: 'Cobrar y cerrar',
  [ORDER_STATUS.PARTIALLY_PAID]: 'Cobrar y cerrar',
}

const STATUS_STYLE = {
  [ORDER_STATUS.PENDING]: 'bg-bone-faint',
  [ORDER_STATUS.IN_KITCHEN]: 'bg-saffron-400',
  [ORDER_STATUS.READY]: 'bg-jade-500',
  [ORDER_STATUS.SERVED]: 'bg-saffron-300',
  [ORDER_STATUS.PARTIALLY_PAID]: 'bg-emberred-400',
}

const STATUS_LABEL = {
  [ORDER_STATUS.PENDING]: 'Pendiente',
  [ORDER_STATUS.IN_KITCHEN]: 'En cocina',
  [ORDER_STATUS.READY]: 'Listo',
  [ORDER_STATUS.SERVED]: 'Servido',
  [ORDER_STATUS.PARTIALLY_PAID]: 'Parcial',
}

const PAYMENT_LABEL = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
}

/**
 * Minutos transcurridos desde que se envió la orden, para priorizar en el tablero.
 * Recibe `now` desde el padre en vez de llamar a Date.now() aquí: si se calculara en el
 * render, el valor quedaría congelado hasta que llegara algún evento de Supabase o
 * alguien tocara un botón, y un ticket de 30 min seguiría marcando "2 min" sin alerta.
 */
function minutesSince(iso, now) {
  if (!iso) return null
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))
}

function OrderCard({ order, now, busy, onAdvance, onComplete, onCancel, onSplit, canCharge }) {
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [askingReason, setAskingReason] = useState(false)
  const [reason, setReason] = useState('')
  const isServed = order.status === ORDER_STATUS.SERVED
  const isPartial = order.status === ORDER_STATUS.PARTIALLY_PAID
  const isChargeable = isServed || isPartial
  const minutes = minutesSince(order.created_at, now)
  const isLate = minutes !== null && minutes >= 15
  const total = Number(order.total ?? 0)
  const paid = Number(order.paid_total ?? 0)
  const remaining = Math.max(0, Math.round((total - paid) * 100) / 100)

  return (
    <article className="flex flex-col rounded-3xl border border-white/10 bg-white/[0.06] p-4 shadow-glass-sm">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-ticket text-lg font-bold text-saffron-400">#{order.code}</p>
          <p className="text-xs text-bone-muted">
            {order.customer_name ?? 'Mostrador'}
            {order.table_number ? ` · Mesa ${order.table_number}` : ''}
          </p>
          {minutes !== null && (
            <p className={`mt-1 font-ticket text-xs ${isLate ? 'text-emberred-400' : 'text-bone-faint'}`}>
              {isLate && '⚠ '}
              {minutes} min
            </p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-ink-950 ${STATUS_STYLE[order.status] ?? 'bg-bone-faint'}`}
        >
          {STATUS_LABEL[order.status] ?? order.status}
        </span>
      </header>

      <ul className="mb-4 flex-1 space-y-1.5 text-sm">
        {(order.order_items ?? []).map((item) => (
          <li key={item.id} className="flex items-baseline gap-2">
            <span className="font-ticket font-bold text-saffron-400">{item.quantity}×</span>
            <span className="min-w-0 flex-1">{item.product_name}</span>
            {item.notes && <span className="text-xs text-bone-muted italic">{item.notes}</span>}
          </li>
        ))}
      </ul>

      <p className="mb-3 border-t border-dashed border-white/15 pt-2 text-right font-ticket text-sm font-bold">
        {isPartial ? (
          <>
            <span className="text-bone-muted line-through">{formatMXN(total)}</span>{' '}
            <span className="text-emberred-400">faltan {formatMXN(remaining)}</span>
          </>
        ) : (
          formatMXN(total)
        )}
      </p>

      {isChargeable && (
        <div className="mb-3">
          {!canCharge ? (
            <p className="flex items-start gap-2 rounded-xl border border-saffron-400/40 bg-saffron-400/10 px-3 py-2.5 text-xs font-medium text-saffron-400">
              <AlertTriangle className="mt-0.5 shrink-0" size={15} />
              Orden servida. Se cobra desde el punto de venta, con caja abierta.
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                {PAYMENT_METHODS.map((method) => (
                  <TouchButton
                    key={method}
                    variant={paymentMethod === method ? 'primary' : 'secondary'}
                    onClick={() => setPaymentMethod(method)}
                    className="flex-1 px-2 text-xs"
                  >
                    {PAYMENT_LABEL[method]}
                  </TouchButton>
                ))}
              </div>
              {isPartial && (
                <TouchButton variant="secondary" className="mt-2 w-full text-xs" onClick={() => onSplit(order)}>
                  Dividir cuenta
                </TouchButton>
              )}
            </>
          )}
        </div>
      )}

      {askingReason ? (
        <div className="mb-3">
          <label
            htmlFor={`reason-${order.id}`}
            className="mb-1.5 block text-xs font-medium text-bone-muted"
          >
            Motivo de la anulación
          </label>
          <input
            id={`reason-${order.id}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Cliente se retiró, error de mesa…"
            autoFocus
            className={`${INPUT} text-sm`}
          />
          <div className="mt-2 flex gap-2">
            <TouchButton
              variant="ghost"
              className="flex-1 text-xs"
              onClick={() => {
                setAskingReason(false)
                setReason('')
              }}
            >
              Cancelar
            </TouchButton>
            <TouchButton
              variant="secondary"
              className="flex-1 text-xs"
              disabled={busy || !reason.trim()}
              onClick={() => onCancel(order.id, reason)}
            >
              {busy ? <Loader2 className="animate-spin" size={15} /> : 'Anular orden'}
            </TouchButton>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <TouchButton variant="secondary" className="px-4" disabled={busy} onClick={() => setAskingReason(true)}>
            Anular
          </TouchButton>
          {isChargeable ? (
            <>
              <TouchButton
                variant="secondary"
                className="px-4"
                disabled={busy || !canCharge}
                onClick={() => onSplit(order)}
              >
                Dividir
              </TouchButton>
              <TouchButton
                className="flex-1"
                disabled={busy || !canCharge}
                onClick={() => onComplete(order.id, paymentMethod)}
              >
                {canCharge ? (isPartial ? 'Cobrar resto' : 'Cobrar todo') : 'Cobrar en POS'}
              </TouchButton>
            </>
          ) : (
            <TouchButton
              className="flex-1"
              disabled={busy || !NEXT_LABEL[order.status]}
              onClick={() => onAdvance(order.id)}
            >
              {NEXT_LABEL[order.status] ?? 'Cerrado'}
            </TouchButton>
          )}
        </div>
      )}
    </article>
  )
}

export default function Kitchen() {
  const { orders, loading, error, busyOrderId, fetchOpenOrders, advanceOrder, completeOrder, cancelOrder, subscribe } =
    useOrderStore()

  // La orden cuyo diálogo de división está abierto. Vive aquí y no en la tarjeta
  // porque el diálogo tapa el tablero: si se cerrara por Realtime mientras el cajero
  // está cobrando, la orden desaparecería de debajo del dedo a mitad de la operación.
  const [splitOrder, setSplitOrder] = useState(null)

  // Cobrar es la única acción que exige gaveta abierta. Cocina puede seguir avanzando
  // pedidos sin ella, así que el bloqueo se aplica solo al botón de cobro, no a la pantalla.
  const shift = useShiftStore((state) => state.shift)

  // Un solo reloj para todo el tablero: refresca los minutos y la marca de retraso sin
  // que cada tarjeta tenga su propio intervalo. 30 s es suficiente para un contador de
  // minutos y no obliga a repintar el tablero cada segundo.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    fetchOpenOrders()
    return subscribe()
  }, [fetchOpenOrders, subscribe])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex min-h-dvh flex-col">
      <ScreenHeader title="Cocina" subtitle={`${orders.length} órdenes abiertas`} />

      <main className="flex-1 space-y-4 p-4 md:p-5">
        {error && <p className="text-sm text-emberred-400">{error}</p>}
        {loading && orders.length === 0 && <p className="text-bone-muted">Cargando órdenes…</p>}
        {!loading && orders.length === 0 && (
          <p className="py-20 text-center text-bone-muted">Sin órdenes pendientes</p>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              now={now}
              busy={busyOrderId === order.id}
              onAdvance={advanceOrder}
              onComplete={completeOrder}
              onCancel={cancelOrder}
              onSplit={setSplitOrder}
              canCharge={Boolean(shift)}
            />
          ))}
        </div>
      </main>

      {splitOrder && (
        <SplitPaymentDialog
          order={splitOrder}
          onClose={() => setSplitOrder(null)}
          onPaid={() => fetchOpenOrders()}
        />
      )}
    </div>
  )
}
