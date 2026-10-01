import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, ShoppingBag, TrendingUp } from 'lucide-react'
import TouchButton from '../../TouchButton'
import supabase from '../../../lib/supabase'
import { formatMXN } from '../../../lib/format'
import { PANEL, PANEL_TITLE } from '../fields'
import RangePicker from './RangePicker'
import { buildPresets, defaultRange, rangeLabel } from './reportHelpers'

/**
 * Reportes de venta: resumen del periodo y ranking de productos.
 *
 * El resumen de "hoy" y "semana" no usa el rango del filtro: son cortes fijos que el
 * administrador siempre quiere ver de un vistazo, sin importar qué fechas tenga
 * seleccionadas arriba. Si el rango mostrado fuera hoy, "hoy" y el filtro dirían lo
 * mismo dos veces y el filtro dejaría de servir para otra cosa.
 */
export default function ReportsPanel({ adminPin }) {
  const [range, setRange] = useState(() => defaultRange())
  const [summary, setSummary] = useState([])
  const [top, setTop] = useState([])
  const [channels, setChannels] = useState([])
  const [extras, setExtras] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const presets = buildPresets()

  const load = async () => {
    setLoading(true)
    setError(null)

    // Las tres consultas van juntas en un Promise.all: son del mismo instante y de lo
    // mismo que el usuario está mirando. Pedirlas por separado haría que el total y el
    // ranking mostraran números de dos momentos distintos si entra una venta en medio.
    const [summaryResult, topResult, channelResult, extrasResult] = await Promise.all([
      supabase.rpc('sales_summary', {
        p_admin_pin: adminPin,
        p_from: range.from,
        p_to: range.to,
      }),
      supabase.rpc('top_products', {
        p_admin_pin: adminPin,
        p_from: range.from,
        p_to: range.to,
        p_limit: 5,
      }),
      supabase.rpc('sales_by_channel', {
        p_admin_pin: adminPin,
        p_from: range.from,
        p_to: range.to,
      }),
      // Los extras van aparte de top_products a propósito: ese ranking se arma con
      // order_items.price, que es el precio BASE del producto. Si el queso se contara
      // ahí, una hamburguesa de $105 con dos quesos de $15 aparecería como dos unidades
      // de $105 y el reporte diría que se vendió queso cuando lo que se vendió fue
      // hamburguesa.
      supabase.rpc('top_modifiers', {
        p_admin_pin: adminPin,
        p_from: range.from,
        p_to: range.to,
        p_limit: 5,
      }),
    ])

    setLoading(false)

    // Una respuesta vacía con PIN válido significa que el filtro no encontró nada;
    // una vacía con PIN inválido significa que la sesión expiró. Se distinguen por el
    // error de RPC antes de asumir lo primero.
    if (summaryResult.error) {
      setError(summaryResult.error.message)
      return
    }
    if (summaryResult.data === null) {
      setError('Autorización de administrador fallida')
      return
    }
    if (topResult.error) {
      setError(topResult.error.message)
      return
    }

    setSummary(summaryResult.data)
    setTop(topResult.data ?? [])
    setChannels(channelResult.data ?? [])
    // Un fallo en el ranking de extras no tumba el reporte entero: el resumen y el top
    // de productos siguen siendo válidos y son los que se revisan todos los días. Perder
    // la pantalla completa por una lista secundaria sería un peor negocio.
    setExtras(extrasResult.error ? [] : (extrasResult.data ?? []))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminPin, range.from, range.to])

  const byScope = (scope) => summary.find((row) => row.scope === scope)
  const today = byScope('hoy')
  const week = byScope('semana')
  const selected = byScope('rango')

  return (
    <div className="space-y-4">
      <section className={PANEL}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className={PANEL_TITLE}>Reportes de venta</h2>
          <TouchButton variant="ghost" onClick={load} disabled={loading} className="px-3 py-2 text-xs">
            <RefreshCw size={14} /> Recargar
          </TouchButton>
        </div>

        <RangePicker range={range} onChange={setRange} presets={presets} />

        {error && (
          <p role="alert" className="mt-4 text-sm font-medium text-emberred-400">
            {error}
          </p>
        )}

        {loading ? (
          <p className="flex items-center justify-center gap-2 py-16 text-bone-muted">
            <Loader2 className="animate-spin" size={18} /> Calculando…
          </p>
        ) : (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <Metric
                title="Hoy"
                value={today?.total_sales ?? 0}
                tickets={today?.ticket_count ?? 0}
                average={today?.ticket_average ?? 0}
                highlight
              />
              <Metric
                title="Esta semana"
                value={week?.total_sales ?? 0}
                tickets={week?.ticket_count ?? 0}
                average={week?.ticket_average ?? 0}
              />
              <Metric
                title={rangeLabel(range.from, range.to)}
                value={selected?.total_sales ?? 0}
                tickets={selected?.ticket_count ?? 0}
                average={selected?.ticket_average ?? 0}
              />
            </div>

            {selected && (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Breakdown label="Efectivo" value={selected.cash_sales} />
                <Breakdown label="Tarjeta" value={selected.card_sales} />
                <Breakdown label="Transferencia" value={selected.transfer_sales} />
              </div>
            )}

            {selected && selected.voided_count > 0 && (
              <p className="mt-3 rounded-xl border border-emberred-500/30 bg-emberred-500/10 px-4 py-2.5 text-sm text-emberred-400">
                {selected.voided_count} {selected.voided_count === 1 ? 'orden anulada' : 'órdenes anuladas'} por{' '}
                {formatMXN(selected.voided_amount)} en este periodo. No cuenta como venta.
              </p>
            )}
          </>
        )}
      </section>

      <section className={PANEL}>
        <h2 className={`${PANEL_TITLE} mb-4`}>Top 5 productos del periodo</h2>

        {loading && <p className="py-10 text-center text-bone-muted">Cargando…</p>}

        {!loading && top.length === 0 && (
          <p className="py-10 text-center text-sm text-bone-muted">
            Nadie ha comprado nada en este rango de fechas.
          </p>
        )}

        {!loading && top.length > 0 && (
          <ol className="space-y-2">
            {top.map((row) => {
              // La barra se mide contra el producto más vendido, no contra el máximo
              // absoluto: si el líder vendió 13 unidades, el segundo con 10 se ve claramente
              // por debajo en lugar de alcanzar el tope de su lado.
              const max = Number(top[0].units) || 1
              const width = Math.max(6, Math.round((Number(row.units) / max) * 100))

              return (
                <li key={row.product_id} className="flex items-center gap-3">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-ticket text-sm font-bold ${
                      row.rank === 1 ? 'bg-saffron-400 text-ink-900' : 'bg-white/10 text-bone-muted'
                    }`}
                  >
                    {row.rank}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-semibold">{row.product_name}</span>
                      <span className="shrink-0 font-ticket text-sm font-bold text-saffron-400">
                        {row.units}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-saffron-400/70" style={{ width: `${width}%` }} />
                    </div>
                    <span className="text-xs text-bone-muted">
                      {formatMXN(row.revenue)} · {Number(row.units) === 1 ? 'unidad' : 'unidades'}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        <p className="mt-4 flex items-start gap-2 text-xs text-bone-faint">
          <TrendingUp size={14} className="mt-0.5 shrink-0" />
          Se cuentan solo órdenes cobradas. Las anuladas quedan fuera del ranking porque no
          son venta, y los productos que ya no están en la carta conservan el nombre que
          tenían cuando se vendieron.
        </p>
      </section>

      <section className={PANEL}>
        <h2 className={`${PANEL_TITLE} mb-4`}>Top 5 extras del periodo</h2>

        {loading && extras.length === 0 && <p className="py-10 text-center text-bone-muted">Cargando…</p>}

        {!loading && extras.length === 0 && (
          <p className="py-10 text-center text-sm text-bone-muted">
            Nadie agregó extras en este rango de fechas.
          </p>
        )}

        {!loading && extras.length > 0 && (
          <ol className="space-y-2">
            {extras.map((row) => {
              // Misma escala que el ranking de productos: la barra se mide contra el
              // líder, para que el segundo se vea claramente por debajo y no se vea casi
              // tan lleno como él.
              const max = Number(extras[0].units) || 1
              const width = Math.max(6, Math.round((Number(row.units) / max) * 100))

              return (
                <li key={row.modifier_id} className="flex items-center gap-3">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-ticket text-sm font-bold ${
                      row.rank === 1 ? 'bg-jade-400 text-ink-900' : 'bg-white/10 text-bone-muted'
                    }`}
                  >
                    {row.rank}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-semibold">{row.modifier_name}</span>
                      <span className="shrink-0 font-ticket text-sm font-bold text-jade-300">
                        {row.units}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-jade-400/70" style={{ width: `${width}%` }} />
                    </div>
                    <span className="text-xs text-bone-muted">
                      {formatMXN(row.revenue)} · {Number(row.units) === 1 ? 'unidad' : 'unidades'}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        <p className="mt-4 flex items-start gap-2 text-xs text-bone-faint">
          <TrendingUp size={14} className="mt-0.5 shrink-0" />
          El extra se cuenta una vez por unidad de producto. Dos hamburguesas con queso
          cuentan dos, no una, y el ingreso es lo que realmente entró por ese extra.
        </p>
      </section>

      <section className={PANEL}>
        <h2 className={`${PANEL_TITLE} mb-4`}>Ventas por canal</h2>

        {!loading && channels.length === 0 && (
          <p className="py-8 text-center text-sm text-bone-muted">
            Sin ventas cobradas en este rango de fechas.
          </p>
        )}

        {loading && channels.length === 0 && <p className="py-10 text-center text-bone-muted">Cargando…</p>}

        {!loading && channels.length > 0 && (
          <>
            <ul className="space-y-2">
              {channels.map((row) => {
                const label =
                  row.order_type === 'platform'
                    ? (PLATFORM_LABEL[row.platform] ?? row.platform ?? 'Domicilio')
                    : (CHANNEL_LABEL[row.order_type] ?? row.order_type)

                return (
                  <li
                    key={`${row.order_type}-${row.platform ?? 'none'}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-800/50 px-4 py-3"
                  >
                    <span className="text-sm font-semibold">{label}</span>
                    <span className="text-right">
                      <span className="block font-ticket text-base font-bold text-saffron-400">
                        {formatMXN(row.total_sales)}
                      </span>
                      <span className="block text-xs text-bone-muted">
                        {row.tickets} {row.tickets === 1 ? 'pedido' : 'pedidos'}
                        {Number(row.discount_total) > 0 &&
                          ` · ${formatMXN(row.discount_total)} en descuentos`}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>

            <p className="mt-4 flex items-start gap-2 text-xs text-bone-faint">
              <ShoppingBag size={14} className="mt-0.5 shrink-0" />
              Separa lo que se consumió en salón de lo que salió para llevar o por
              plataforma. Los descuentos se muestran aparte porque son dinero que se
              dejó de cobrar, no venta.
            </p>
          </>
        )}
      </section>
    </div>
  )
}

const CHANNEL_LABEL = {
  dine_in: 'En local',
  takeout: 'Para llevar',
  platform: 'Domicilio',
}

const PLATFORM_LABEL = {
  uber: 'Uber',
  rappi: 'Rappi',
  didi: 'DiDi',
}

function Metric({ title, value, tickets, average, highlight = false }) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${
        highlight ? 'border-saffron-400/40 bg-saffron-400/10' : 'border-white/10 bg-ink-800/60'
      }`}
    >
      <p className="text-[0.7rem] tracking-wider text-bone-muted uppercase">{title}</p>
      <p className={`font-ticket text-2xl font-bold ${highlight ? 'text-saffron-400' : ''}`}>
        {formatMXN(value)}
      </p>
      <p className="mt-0.5 text-xs text-bone-muted">
        {tickets} {tickets === 1 ? 'ticket' : 'tickets'} · ticket promedio {formatMXN(average)}
      </p>
    </div>
  )
}

function Breakdown({ label, value }) {
  return (
    <div className="flex items-baseline justify-between rounded-xl border border-white/10 bg-ink-800/40 px-3 py-2">
      <span className="text-xs tracking-wider text-bone-muted uppercase">{label}</span>
      <span className="font-ticket text-sm font-bold">{formatMXN(value)}</span>
    </div>
  )
}
