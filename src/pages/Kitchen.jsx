import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BellRing, Flame, Loader2, Printer } from 'lucide-react'
import ScreenHeader from '../components/ScreenHeader'
import TouchButton from '../components/TouchButton'
import SplitPaymentDialog from '../components/payment/SplitPaymentDialog'
import { INPUT } from '../components/admin/fields'
import { formatMXN } from '../lib/format'
import { alertNewOrder, beepDone, unlockAudio } from '../lib/kdsAudio'
import { buildKitchenText, printReceipt } from '../lib/receipt'
import { ORDER_STATUS, PAYMENT_METHODS, useOrderStore } from '../store/useOrderStore'
import { useShiftStore } from '../store/useShiftStore'

/**
 * Las dos estaciones. El identificador es el que viaja al servidor y al renglón, y no
 * son palabras bonitas: `cocina` y `barra` son valores del CHECK en order_items.
 */
const STATIONS = [
  { id: 'cocina', label: 'Cocina', icon: Flame },
  { id: 'barra', label: 'Barra', icon: BellRing },
]

const STATION_KEY = 'kds.station'

/** Estado de un renglón dentro de una estación. */
const ITEM_STATE = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  READY: 'ready',
}

/**
 * Qué pone el botón de la tarjeta.
 *
 * Con el estado por estación el rótulo sale del renglón, no de la orden: barra marca
 * "Listo" cuando su bebida termina, aunque la hamburguesa siga en la plancha.
 */
const NEXT_ITEM_LABEL = {
  [ITEM_STATE.PENDING]: 'Empezar',
  [ITEM_STATE.IN_PROGRESS]: 'Marcar listo',
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

/**
 * Los renglones de una estación que todavía falta terminar.
 *
 * Se filtran AQUÍ y no en la consulta porque una sola orden puede tener comida y
 * bebida, y cada estación tiene que ver solo lo suyo. Es la razón de existir del
 * `station` copiado en el renglón.
 */
function stationItems(order, station) {
  return (order.order_items ?? []).filter((item) => item.station === station)
}

/**
 * Estado combinado de los renglones de una estación, para el botón.
 *
 * `allReady` gana sobre `allPending`: si ya no queda nada por hacer en esta estación,
 * el botón se deshabilita en vez de moverse a un "pendiente" que no existe.
 */
function stationState(items) {
  if (items.length === 0) return { allReady: true, label: null, started: false }
  const allReady = items.every((item) => item.status === ITEM_STATE.READY)
  const started = items.some((item) => item.status === ITEM_STATE.IN_PROGRESS)
  return {
    allReady,
    started,
    label: started ? NEXT_ITEM_LABEL[ITEM_STATE.IN_PROGRESS] : NEXT_ITEM_LABEL[ITEM_STATE.PENDING],
  }
}

function OrderCard({
  order,
  now,
  busy,
  station,
  isNew,
  onAdvance,
  onComplete,
  onCancel,
  onSplit,
  canCharge,
}) {
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

  const items = stationItems(order, station)
  const { allReady, label } = stationState(items)

  /**
   * Reimprime la comanda de esta orden COMPLETA.
   *
   * A diferencia de la comanda automática, que al agregar productos solo lleva lo
   * nuevo, aquí va todo. Cuando alguien dice "a cocina no le llegó nada", el cocinero
   * necesita la orden entera: si solo saliera el último agregado, no sabría qué falta
   * por cocina.
   *
   * Es también la red de seguridad de la impresión automática del POS: si el navegador
   * bloqueó el diálogo y la comanda nunca salió, aquí se recupera.
   */
  const printKitchen = () => {
    printReceipt(
      buildKitchenText({
        code: order.code,
        tableNumber: order.table_number,
        orderType: order.order_type,
        platform: order.platform,
        at: order.created_at,
        items: (order.order_items ?? []).map((item) => ({
          name: item.product_name,
          quantity: item.quantity,
          notes: item.notes,
          modifiers: (item.order_item_modifiers ?? []).map((mod) => ({
            name: mod.name,
            quantity: mod.quantity,
          })),
        })),
      }),
      { fontSize: 18, bold: true },
    )
  }

  // Una orden sin un solo renglón de esta estación no es una carta vacía: es una orden
  // que no es de esta estación. No se muestra, porque una barra llena de tarjetas con
  // puras hamburguesas es exactamente el problema que se vino a arreglar.
  if (items.length === 0) return null

  return (
    <article
      className={`flex flex-col rounded-3xl border p-4 shadow-glass-sm transition-colors ${
        isNew
          ? 'border-saffron-400 bg-saffron-400/15 ring-2 ring-saffron-400/60'
          : allReady
            ? 'border-jade-500/40 bg-jade-500/5'
            : 'border-white/10 bg-white/[0.06]'
      }`}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-ticket text-lg font-bold text-saffron-400">
            #{order.code}
            {isNew && (
              <span className="ml-2 align-middle rounded-full bg-saffron-400 px-2 py-0.5 text-[0.65rem] font-bold text-ink-950">
                NUEVA
              </span>
            )}
          </p>
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
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold text-ink-950 ${STATUS_STYLE[order.status] ?? 'bg-bone-faint'}`}
          >
            {STATUS_LABEL[order.status] ?? order.status}
          </span>
          {/* Va en la cabecera y no abajo porque abajo ya viven Anular, Dividir y
              Cobrar, y la fila se queda sin espacio útil en tablet. */}
          <TouchButton
            variant="ghost"
            className="px-2 py-1 text-xs"
            onClick={printKitchen}
            aria-label={`Imprimir comanda de la orden ${order.code}`}
          >
            <Printer size={13} />
            Comanda
          </TouchButton>
        </div>
      </header>

      <ul className="mb-4 flex-1 space-y-1.5 text-sm">
        {items.map((item) => (
          <li
            key={item.id}
            className={item.status === ITEM_STATE.READY ? 'opacity-45' : undefined}
          >
            <div className="flex items-baseline gap-2">
              <span className="font-ticket font-bold text-saffron-400">{item.quantity}×</span>
              <span
                className={`min-w-0 flex-1 ${item.status === ITEM_STATE.READY ? 'line-through' : ''}`}
              >
                {item.product_name}
              </span>
              {item.status === ITEM_STATE.IN_PROGRESS && (
                <span className="shrink-0 rounded-full bg-saffron-400/20 px-1.5 py-0.5 text-[0.65rem] font-semibold text-saffron-400">
                  en proceso
                </span>
              )}
            </div>
            {/* Los extras van debajo de su producto y SIN precio. En la estación no se
                cobra nada: lo que importa es qué se tiene que preparar. */}
            {(item.order_item_modifiers ?? []).map((mod) => (
              <p key={mod.id} className="ml-6 text-xs text-jade-300">
                + {mod.quantity > 1 ? `${mod.quantity}x ` : ''}
                {mod.name}
              </p>
            ))}
            {item.notes && <p className="ml-6 text-xs text-bone-muted italic">{item.notes}</p>}
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
              disabled={busy || allReady || !label}
              onClick={() => onAdvance(order.id, station)}
            >
              {allReady ? 'Listo' : label}
            </TouchButton>
          )}
        </div>
      )}
    </article>
  )
}

export default function Kitchen() {
  const { orders, loading, error, busyOrderId, fetchOpenOrders, completeOrder, cancelOrder, subscribe } =
    useOrderStore()

  // La orden cuyo diálogo de división está abierto. Vive aquí y no en la tarjeta
  // porque el diálogo tapa el tablero: si se cerrara por Realtime mientras el cajero
  // está cobrando, la orden desaparecería de debajo del dedo a mitad de la operación.
  const [splitOrder, setSplitOrder] = useState(null)

  // Cobrar es la única acción que exige gaveta abierta. Cocina puede seguir avanzando
  // pedidos sin ella, así que el bloqueo se aplica solo al botón de cobro, no a la pantalla.
  const shift = useShiftStore((state) => state.shift)

  // Un solo reloj para todo el tablero: refresca los minutos y la marca de retraso sin
  // que cada tarjeta tenga su propio intervalo.
  const [now, setNow] = useState(() => Date.now())

  /**
   * La estación vive en localStorage y no en un store.
   *
   * No hay dos personas en la misma tablet: la barra tiene su dispositivo y la cocina
   * el suyo. Persistirlo evita que al recargar la pantalla (y el KDS se recarga mucho)
   * una pantalla que estaba en barra vuelva a cocina y mezclara todo.
   */
  const [station, setStation] = useState(() => {
    const saved = localStorage.getItem(STATION_KEY)
    return STATIONS.some((s) => s.id === saved) ? saved : STATIONS[0].id
  })

  /**
   * Folios que ya se dijeron en voz alta.
   *
   * Sirve para distinguir "llegó una orden nueva" de "se actualizó una que ya estaba".
   * Con Realtime el tablero se relee por cada renglón que cambia, así que sin esto el
   * pitido sonaría cada vez que alguien toca un botón, que es el momento en que menos
   * debe sonar.
   */
  const seenCodes = useRef(new Set())
  const [newCodes, setNewCodes] = useState([])

  useEffect(() => {
    fetchOpenOrders()
    return subscribe()
  }, [fetchOpenOrders, subscribe])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])

  /**
   * Desbloquea el audio con el primer toque.
   *
   * Chrome deja el AudioContext suspendido hasta que hay un gesto del usuario, y un
   * sonido que se dispara antes de eso no suena nunca. Se engancha al contenedor, no al
   * botón: cualquier toque vale y así no hay que acordarse de tocar uno en concreto.
   */
  useEffect(() => {
    const node = document.getElementById('kds-root')
    if (!node) return undefined
    const unlock = () => {
      unlockAudio()
      node.removeEventListener('pointerdown', unlock)
    }
    node.addEventListener('pointerdown', unlock)
    return () => node.removeEventListener('pointerdown', unlock)
  }, [])

  /**
   * Detecta las órdenes nuevas y avisa.
   *
   * El primer ciclo es el de arranque y se ignora a propósito: al abrir la pantalla hay
   * veinte órdenes en el tablero y avisar de las veinte sería un ruido inútil. Solo
   * cuentan las que aparecen después.
   */
  const started = useRef(false)

  useEffect(() => {
    if (loading && orders.length === 0) return

    const incoming = orders
      .filter((order) => stationItems(order, station).length > 0)
      .map((order) => order.code)

    if (!started.current) {
      seenCodes.current = new Set(incoming)
      started.current = true
      return
    }

    const fresh = incoming.filter((code) => !seenCodes.current.has(code))
    if (fresh.length === 0) return

    seenCodes.current = new Set(incoming)
    setNewCodes(fresh)
    alertNewOrder()

    // La marca se quita sola: "NUEVA" con sentido es lo que llama la atención, y una
    // etiqueta permanente sería ruido igual que el sonido.
    const id = setTimeout(() => {
      setNewCodes((current) => current.filter((code) => !fresh.includes(code)))
    }, 20_000)
    return () => clearTimeout(id)
  }, [orders, loading, station])

  const visible = useMemo(
    () => orders.filter((order) => stationItems(order, station).length > 0),
    [orders, station],
  )

  const pendingCount = visible.filter((order) => {
    const items = stationItems(order, station)
    return items.some((item) => item.status !== ITEM_STATE.READY)
  }).length

  const advance = async (orderId, target) => {
    beepDone()
    await useOrderStore.getState().advanceStationItems(orderId, target)
  }

  return (
    <div id="kds-root" className="flex min-h-dvh flex-col">
      <ScreenHeader title="Cocina" subtitle={`${visible.length} órdenes en ${station}`} />

      <main className="flex-1 space-y-4 p-4 md:p-5">
        {error && <p className="text-sm text-emberred-400">{error}</p>}

        <div className="flex flex-wrap items-center gap-2">
          {STATIONS.map((option) => {
            const Icon = option.icon
            const active = option.id === station
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setStation(option.id)}
                aria-pressed={active}
                className={`flex min-h-touch items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-saffron-400 text-ink-950'
                    : 'bg-white/[0.06] text-bone-muted hover:bg-white/10'
                }`}
              >
                <Icon size={16} />
                {option.label}
              </button>
            )
          })}
          <span className="ml-auto text-xs text-bone-muted">
            {pendingCount === 0 ? 'Nada pendiente' : `${pendingCount} por terminar`}
          </span>
        </div>

        {loading && orders.length === 0 && <p className="text-bone-muted">Cargando órdenes…</p>}
        {!loading && visible.length === 0 && (
          <p className="py-20 text-center text-bone-muted">
            {station === 'barra' ? 'Sin bebidas pendientes' : 'Sin órdenes pendientes'}
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              now={now}
              busy={busyOrderId === order.id}
              station={station}
              isNew={newCodes.includes(order.code)}
              onAdvance={advance}
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