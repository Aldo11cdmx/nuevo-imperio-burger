import { useEffect, useState } from 'react'
import ScreenHeader from '../components/ScreenHeader'
import TouchButton from '../components/TouchButton'
import { ORDER_STATUS, PAYMENT_METHODS, useOrderStore } from '../store/useOrderStore'

const NEXT_LABEL = {
  [ORDER_STATUS.PENDING]: 'Empezar',
  [ORDER_STATUS.IN_KITCHEN]: 'Marcar listo',
  [ORDER_STATUS.READY]: 'Servir',
  [ORDER_STATUS.SERVED]: 'Cobrar y cerrar',
}

const STATUS_STYLE = {
  [ORDER_STATUS.PENDING]: 'bg-ash-500',
  [ORDER_STATUS.IN_KITCHEN]: 'bg-ember-500',
  [ORDER_STATUS.READY]: 'bg-emerald-500',
  [ORDER_STATUS.SERVED]: 'bg-sky-400',
}

const STATUS_LABEL = {
  [ORDER_STATUS.PENDING]: 'Pendiente',
  [ORDER_STATUS.IN_KITCHEN]: 'En cocina',
  [ORDER_STATUS.READY]: 'Listo',
  [ORDER_STATUS.SERVED]: 'Servido',
}

const PAYMENT_LABEL = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
}

function OrderCard({ order, busy, onAdvance, onComplete, onCancel }) {
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const isServed = order.status === ORDER_STATUS.SERVED

  return (
    <article className="flex flex-col rounded-xl bg-carbon-900 p-4">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-lg font-bold">#{order.code}</p>
          <p className="text-xs text-ash-500">
            {order.customer_name ?? 'Mostrador'}
            {order.table_number ? ` · Mesa ${order.table_number}` : ''}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold text-carbon-950 ${STATUS_STYLE[order.status] ?? 'bg-ash-500'}`}
        >
          {STATUS_LABEL[order.status] ?? order.status}
        </span>
      </header>

      <ul className="mb-4 flex-1 space-y-1 text-sm">
        {(order.order_items ?? []).map((item) => (
          <li key={item.id} className="flex justify-between gap-2">
            <span>
              {item.quantity}× {item.product_name}
            </span>
            {item.notes && <span className="text-xs text-ember-500">{item.notes}</span>}
          </li>
        ))}
      </ul>

      {isServed && (
        <div className="mb-3 flex gap-2">
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
      )}

      <div className="flex gap-2">
        <TouchButton
          variant="secondary"
          className="px-4"
          disabled={busy}
          onClick={() => onCancel(order.id)}
        >
          Anular
        </TouchButton>
        {isServed ? (
          <TouchButton
            className="flex-1"
            disabled={busy}
            onClick={() => onComplete(order.id, paymentMethod)}
          >
            {NEXT_LABEL[ORDER_STATUS.SERVED]}
          </TouchButton>
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
    </article>
  )
}

export default function Kitchen() {
  const { orders, loading, error, busyOrderId, fetchOpenOrders, advanceOrder, completeOrder, cancelOrder, subscribe } =
    useOrderStore()

  useEffect(() => {
    fetchOpenOrders()
    return subscribe()
  }, [fetchOpenOrders, subscribe])

  return (
    <div className="flex min-h-screen flex-col">
      <ScreenHeader title="Cocina" subtitle={`${orders.length} órdenes abiertas`} />

      <main className="flex-1 space-y-4 p-6">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {loading && orders.length === 0 && <p className="text-ash-500">Cargando órdenes…</p>}
        {!loading && orders.length === 0 && (
          <p className="py-20 text-center text-ash-500">Sin órdenes pendientes</p>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              busy={busyOrderId === order.id}
              onAdvance={advanceOrder}
              onComplete={completeOrder}
              onCancel={cancelOrder}
            />
          ))}
        </div>
      </main>
    </div>
  )
}
