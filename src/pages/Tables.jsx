import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LayoutGrid, Bell, Loader2, ReceiptText, Wallet } from 'lucide-react'
import ScreenHeader from '../components/ScreenHeader'
import TouchButton from '../components/TouchButton'
import Toast from '../components/Toast'
import TableMap from '../components/tables/TableMap'
import SplitPaymentDialog from '../components/payment/SplitPaymentDialog'
import TicketPreview from '../components/receipt/TicketPreview';
import { PANEL, PANEL_TITLE } from '../components/admin/fields'
import { formatMXN, round2 } from '../lib/format'
import { friendlyError } from '../lib/errors'
import supabase from '../lib/supabase'
import { useAuthStore } from '../store/useAuthStore'
import { tableStateStyle, useTableStore } from '../store/useTableStore'
import { OPEN_STATUSES, ORDER_STATUS } from '../store/useOrderStore'
import { useCartStore } from '../store/useCartStore'

const BUSINESS = {
  name: 'Nuevo Imperio Burger',
  tagline: 'Vuelve pronto',
}

const STATUS_LABEL = {
  pending: 'Tomando',
  in_kitchen: 'En cocina',
  ready: 'Listo',
  served: 'Servido',
  partially_paid: 'A medias',
}


const FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'busy', label: 'Ocupadas' },
  { id: 'billing', label: 'Cobrando' },
  { id: 'free', label: 'Libres' },
]

/**
 * Mapa de mesas, pantalla de solo lectura para el personal.
 *
 * Al tocar una mesa ocupada se abre su cuenta. Para cobrar hace falta caja
 * abierta y el mismo PIN de siempre: si no hay turno, el aviso explica que el cobro
 * es desde el punto de venta en vez de fallar en silencio al cobrar.
 */
export default function Tables() {
  const { tables, loading, error, fetchTables, subscribe } = useTableStore()
  const pin = useAuthStore((state) => state.pin)
  const staffName = useAuthStore((state) => state.employee?.full_name ?? '')
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [openOrders, setOpenOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [paying, setPaying] = useState(null)
  const [payingTab, setPayingTab] = useState('single')
  const [toast, setToast] = useState(null)
  const [unread, setUnread] = useState(0)
  const navigate = useNavigate()

  const addDishesToTable = (order) => {
    useCartStore.getState().setTable(order.table_number)
    navigate('/pos')
  }

  const markServed = async (order) => {
    if (!pin) {
      setToast({ tone: 'error', title: 'Sin sesión', detail: 'Ingresa con tu PIN.' })
      return
    }
    const { error } = await supabase.rpc('advance_order', {
      p_pin: pin,
      p_order_id: order.id,
      p_to_status: 'served',
    })
    if (error) {
      setToast({ tone: 'error', title: 'No se pudo marcar', detail: friendlyError(error) })
      return
    }
    await fetchTables()
    await openTable(selected)
  }
  // La pre-cuenta se previsualiza antes de imprimir: se abre como un portal a body
  // dentro de TablePreview, igual que el TicketPreview dentro del cobro. Vivir aquí y
  // no dentro de cada <li> es lo que permite que el portal no se regenere al cambiar de
  // mesa mientras se revisa el ticket.
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    fetchTables()
    return subscribe()
  }, [fetchTables, subscribe])

  // Notificaciones de Realtime: cuando el cocinero marca una orden Lista, el mesero
  // ve un anuncio. El contador de no leídas se mantiene en memoria solo por las que
  // llegan mientras la pantalla está abierta; marcar leídas pone el contador a cero.
  useEffect(() => {
    const channel = supabase
      .channel('public:notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const n = payload.new
          if (n && n.type === 'ready') {
            setToast({ tone: 'info', title: 'Orden lista', detail: n.message })
            setUnread((u) => u + 1)
          }
        },
      )
      .subscribe()

    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [])

  // Al tocar una mesa con pedidos se leen sus órdenes abiertas. Se consulta por
  // table_number directamente: el RPC del mapa no trae los uuid y makes otra ida
  // solo para esto sería pegar un viaje al tablero entero.
  const openTable = async (table) => {
    setSelected(table)
    if (!table || table.openOrders === 0) {
      setOpenOrders([])
      return
    }

    setOrdersLoading(true)
    const { data } = await supabase
      .from('orders')
      .select(
        '*, order_items(*, order_item_modifiers(*))'
      )
        .eq('table_number', table.number)
      .in('status', OPEN_STATUSES)
      .order('code', { ascending: true })

    setOpenOrders(data ?? [])
    setOrdersLoading(false)
  }

  const dismissToast = () => setToast(null)

  const counts = {
    all: tables.length,
    busy: tables.filter((t) => t.state === 'busy').length,
    billing: tables.filter((t) => t.state === 'billing').length,
    free: tables.filter((t) => t.state === 'free').length,
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <ScreenHeader
        title="Mesas"
        subtitle={`${tables.filter((t) => t.state !== 'free').length} mesas ocupadas`}
        right={
            <div className="flex items-center gap-1">
             <button
               type="button"
               onClick={async () => {
                 await supabase.rpc('mark_notifications_read').catch(() => {})
                 setUnread(0)
               }}
               className="relative min-h-touch min-w-touch shrink-0 rounded-xl p-3 text-bone-muted hover:text-bone"
               aria-label="Notificaciones"
             >
               <Bell size={20} />
               {unread > 0 && (
                 <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-emberred-500 px-1 text-[10px] font-bold text-white">
                   {unread}
                 </span>
               )}
             </button>
             <Link
               to="/"
               className="min-h-touch min-w-touch shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-bone-muted transition-colors hover:text-bone"
             >
               Menú
             </Link>
           </div>
        }
      />

      <main className="flex flex-1 flex-col gap-4 p-4 md:p-5">
        {error && <p className="text-sm text-emberred-400">{error}</p>}

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <TouchButton
              key={f.id}
              variant={filter === f.id ? 'primary' : 'secondary'}
              onClick={() => setFilter(f.id)}
              className="shrink-0 px-4 text-sm"
            >
              {f.label}
              <span className="ml-1.5 font-ticket text-xs opacity-70">{counts[f.id]}</span>
            </TouchButton>
          ))}
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            {loading && tables.length === 0 ? (
              <p className="flex items-center justify-center py-20 text-bone-muted">
                <Loader2 className="mr-2 animate-spin" size={18} /> Cargando mesas…
              </p>
            ) : (
              <TableMap
                tables={tables.filter((t) => filter === 'all' || t.state === filter)}
                onSelect={openTable}
              />
            )}
          </div>

          {/* detalle de la mesa tocada */}
          {selected && (
            <aside className={`${PANEL} h-fit`}>
              <h2 className={`${PANEL_TITLE} mb-3`}>{selected.label}</h2>

              <div className="mb-3 flex items-center justify-between">
                <span className={`text-sm font-semibold ${tableStateStyle(selected.state).text}`}>
                  {tableStateStyle(selected.state).badge}
                </span>
                <span className="font-ticket text-lg font-bold text-saffron-400">
                  {formatMXN(selected.amountDue)}
                </span>
              </div>

              {selected.customerNames && (
                <p className="mb-3 truncate text-xs text-bone-muted">{selected.customerNames}</p>
              )}

              {selected.openOrders === 0 && !ordersLoading && (
                <p className="py-4 text-center text-sm text-bone-muted">Sin cuentas pendientes</p>
              )}

              {ordersLoading && (
                <p className="flex items-center justify-center py-4 text-sm text-bone-muted">
                  <Loader2 className="mr-2 animate-spin" size={15} /> Cargando cuenta…
                </p>
              )}

              {!ordersLoading && openOrders.length > 0 && (
                <ul className="space-y-2">
                   {openOrders.map((order) => {
                     const remaining = Math.max(0, round2(order.total - (order.paid_total ?? 0)))
                     const items = order.order_items ?? []
                     return (
                       <li key={order.id} className="rounded-xl border border-white/10 bg-ink-800/60 p-3">
                         <div className="mb-1 flex items-center justify-between text-sm">
                           <div className="flex items-center gap-1.5">
                             <span className="font-ticket font-bold text-saffron-400">#{order.code}</span>
                             <span className="text-xs text-bone-muted">{STATUS_LABEL[order.status] ?? order.status}</span>
                           </div>
                           <span className="font-ticket font-bold">{formatMXN(remaining)}</span>
                         </div>

                         <p className="mb-2 text-xs text-bone-muted">
                           {order.customer_name ?? 'Mostrador'} · {items.length} {items.length === 1 ? 'línea' : 'líneas'}
                         </p>

                         <ul className="mb-3 space-y-1">
                           {items.map((it) => (
                             <li key={it.id} className="flex justify-between text-xs">
                               <span>
                                 <span className="font-medium">{it.quantity}× </span>
                                 {it.product_name}
                                 {it.notes && (
                                   <span className="block text-[10px] italic text-bone-muted">{it.notes}</span>
                                 )}
                                 {it.order_item_modifiers?.map((m) => (
                                   <span key={m.id} className="block text-[10px] text-bone-muted">
                                     {'+ '}{m.quantity}x {m.name}
                                   </span>
                                 ))}
                               </span>
                                <span className="text-bone-200">
                                  {formatMXN(round2(
                                    (it.price ?? 0) * it.quantity +
                                      (it.order_item_modifiers ?? []).reduce(
                                        (a, m) => a + (m.price ?? 0) * (m.quantity ?? 0),
                                        0,
                                      ),
                                  ))}
                                </span>
                             </li>
                           ))}
                         </ul>

                         <div className="mb-3 flex justify-between border-t border-white/10 pt-2 text-sm">
                           <span className="text-bone-muted">Falta</span>
                           <span className="font-ticket font-bold text-saffron-400">{formatMXN(remaining)}</span>
                         </div>

                         <div className="grid grid-cols-3 gap-1.5">
                           <TouchButton
                              className="text-xs"
                              touchDebounce={400}
                              onClick={() => {
                                if (!pin) {
                                  setToast({
                                    tone: 'error',
                                    title: 'Sin sesión',
                                    detail: 'Ingresa con tu PIN para cobrar.',
                                  })
                                  return
                                }
                                setPayingTab('single')
                                setPaying(order)
                              }}
                            >
                              <Wallet size={14} /> Cobrar
                            </TouchButton>
                            <TouchButton
                              className="text-xs"
                              touchDebounce={400}
                              onClick={() => {
                                if (!pin) {
                                  setToast({
                                    tone: 'error',
                                    title: 'Sin sesión',
                                    detail: 'Ingresa con tu PIN para cobrar.',
                                  })
                                  return
                                }
                                setPayingTab('parts')
                                setPaying(order)
                              }}
                            >
                              Dividir cuenta
                            </TouchButton>
                            <TouchButton
                              className="text-xs"
                              onClick={() => setPreview(order)}
                            >
                              <ReceiptText size={14} /> Pre-cuenta
                            </TouchButton>
                          </div>

                          {order.status === ORDER_STATUS.READY && (
                            <TouchButton
                              variant="secondary"
                              className="mb-2 w-full text-xs"
                              onClick={() => markServed(order)}
                            >
                              Marcar como servido
                            </TouchButton>
                          )}

                          <button
                            type="button"
                            onClick={() => addDishesToTable(order)}
                            className="mt-2 w-full text-center text-xs font-medium text-saffron-400 hover:underline"
                          >
                            Agregar más platillos
                          </button>
                       </li>
                     )
                   })}
                </ul>
              )}
            </aside>
          )}
        </div>

        {!selected && (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-bone-muted">
            <LayoutGrid size={16} /> Toca una mesa para ver su cuenta
          </p>
        )}
      </main>

      {paying && (
        <SplitPaymentDialog
          order={paying}
          defaultTab={payingTab}
          onClose={() => { setPaying(null); setPayingTab('single') }}
          onPaid={async () => {
            await fetchTables()
            await openTable(selected)
            setToast({ tone: 'success', title: `Cobro a la orden #${paying.code}` })
          }}
        />
      )}

      {preview && (
        <TicketPreview
          order={preview}
          business={BUSINESS}
          staffName={staffName}
          onClose={() => setPreview(null)}
        />
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}