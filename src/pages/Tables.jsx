import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LayoutGrid, Loader2 } from 'lucide-react'
import ScreenHeader from '../components/ScreenHeader'
import TouchButton from '../components/TouchButton'
import Toast from '../components/Toast'
import TableMap from '../components/tables/TableMap'
import SplitPaymentDialog from '../components/payment/SplitPaymentDialog'
import { PANEL, PANEL_TITLE } from '../components/admin/fields'
import { formatMXN } from '../lib/format'
import supabase from '../lib/supabase'
import { useAuthStore } from '../store/useAuthStore'
import { tableStateStyle, useTableStore } from '../store/useTableStore'

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
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [openOrders, setOpenOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [paying, setPaying] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    fetchTables()
    return subscribe()
  }, [fetchTables, subscribe])

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
      .select('*, order_items(*)')
      .eq('table_number', table.number)
      .in('status', ['served', 'partially_paid'])
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
          <Link
            to="/"
            className="shrink-0 rounded-xl px-3 py-2 text-sm font-semibold text-bone-muted transition-colors hover:text-bone"
          >
            Menú
          </Link>
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
                    const remaining = Math.max(
                      0,
                      Math.round((order.total - (order.paid_total ?? 0)) * 100) / 100,
                    )
                    return (
                      <li key={order.id} className="rounded-xl border border-white/10 bg-ink-800/60 p-3">
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="font-ticket font-bold text-saffron-400">#{order.code}</span>
                          <span className="font-ticket font-bold">{formatMXN(remaining)}</span>
                        </div>
                        <p className="mb-2 text-xs text-bone-muted">
                          {order.customer_name ?? 'Mostrador'} · {order.order_items?.length ?? 0} líneas
                        </p>
                        <TouchButton
                          className="w-full text-xs"
                          onClick={() => {
                            if (!pin) {
                              setToast({
                                tone: 'error',
                                title: 'Sin sesión',
                                detail: 'Ingresa con tu PIN para cobrar.',
                              })
                              return
                            }
                            setPaying(order)
                          }}
                        >
                          Cobrar
                        </TouchButton>
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
          onClose={() => setPaying(null)}
          onPaid={async () => {
            await fetchTables()
            await openTable(selected)
            setToast({ tone: 'success', title: `Cobro a la orden #${paying.code}` })
          }}
        />
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}