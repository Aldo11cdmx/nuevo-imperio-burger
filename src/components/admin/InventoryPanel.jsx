import { useEffect, useState } from 'react'
import { History, Loader2, Minus, Plus, RefreshCw } from 'lucide-react'
import TouchButton from '../TouchButton'
import supabase from '../../lib/supabase'
import { INPUT, PANEL, PANEL_TITLE } from './fields'

/**
 * Solo aparecen los productos con tracks_stock. El ajuste es por delta y lo resuelve
 * el servidor dentro de la función, así que dos tablets restando a la vez no se pisan.
 * El conteo físico usa set_stock, que fija el número absoluto en vez de mandar un
 * incremento: contar no es "sumar tantos".
 */

const KIND_LABEL = {
  sale: 'Venta',
  void: 'Anulación',
  purchase: 'Compra',
  count: 'Conteo',
  waste: 'Merma',
}

/** El formato es relativo y corto: en la UI solo importa "hace cuánto". */
function relativeTime(iso) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  return `hace ${Math.floor(hours / 24)} d`
}

export default function InventoryPanel({ adminPin }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [count, setCount] = useState({})
  const [historyFor, setHistoryFor] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('list_all_products', {
      p_admin_pin: adminPin,
    })

    if (rpcError) {
      setLoading(false)
      setError(rpcError.message)
      return
    }
    if (!data) {
      setLoading(false)
      setError('Autorización de administrador fallida')
      return
    }

    setProducts(data.filter((product) => product.tracks_stock))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminPin])

  /**
   * Merma. El servidor exige motivo cuando el delta baja, y ahora lo pide en la base
   * con un CHECK: una salida sin explicación no queda registrada. Por eso el motivo se
   * pregunta antes de llamar, y no se adivina un texto genérico desde aquí.
   */
  const registerWaste = async (product) => {
    const reason = window.prompt(`¿Por qué baja el stock de ${product.name}?`)
    if (reason === null) return
    if (!reason.trim()) {
      setError('Escribe el motivo por el que baja el stock')
      return
    }

    setBusyId(product.id)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('adjust_stock', {
      p_admin_pin: adminPin,
      p_product_id: product.id,
      p_delta: -1,
      p_reason: reason.trim(),
    })

    if (rpcError) {
      setError(rpcError.message)
      setBusyId(null)
      return
    }
    if (data === null) {
      setError('Autorización de administrador fallida')
      setBusyId(null)
      return
    }
    setBusyId(null)
    load()
  }

  /** Entrada de mercancía: no necesita motivo, pero sí queda en la bitácora. */
  const restock = async (product, delta) => {
    setBusyId(product.id)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('adjust_stock', {
      p_admin_pin: adminPin,
      p_product_id: product.id,
      p_delta: delta,
    })

    if (rpcError) {
      setError(rpcError.message)
      setBusyId(null)
      return
    }
    if (data === null) {
      setError('Autorización de administrador fallida')
      setBusyId(null)
      return
    }
    setBusyId(null)
    load()
  }

  /**
   * Conteo físico: set_stock fija el número absoluto. Si el conteo quedó por debajo de
   * lo que decía el sistema, el servidor pide motivo: si no, cinco unidades "perdidas"
   * en un trasnoche quedan sin explicación para siempre.
   */
  const saveCount = async (product) => {
    const value = Number(count[product.id])
    if (!Number.isFinite(value) || value < 0) {
      setError('Escribe una cantidad válida')
      return
    }

    const lower = value < product.stock
    const reason = lower
      ? window.prompt(
          `El conteo (${value}) quedó por debajo de lo que el sistema tiene (${product.stock}). ¿Por qué faltan ${product.stock - value}?`,
        )
      : null
    if (lower && reason === null) return
    if (lower && !reason.trim()) {
      setError('El conteo bajó: escribe por qué faltaban unidades')
      return
    }

    setBusyId(product.id)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('set_stock', {
      p_admin_pin: adminPin,
      p_product_id: product.id,
      p_counted: value,
      p_reason: lower ? reason.trim() : null,
    })

    if (rpcError) {
      setError(rpcError.message)
    } else if (data === null) {
      setError('Autorización de administrador fallida')
    } else {
      setCount((current) => {
        const next = { ...current }
        delete next[product.id]
        return next
      })
    }
    setBusyId(null)
    load()
  }

  const openHistory = async (product) => {
    if (historyFor === product.id) {
      setHistoryFor(null)
      return
    }
    setHistoryFor(product.id)
    setHistoryLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('stock_history', {
      p_admin_pin: adminPin,
      p_product_id: product.id,
      p_limit: 20,
    })

    setHistoryLoading(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setHistory(data ?? [])
  }

  return (
    <section className={`${PANEL} overflow-x-auto`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className={PANEL_TITLE}>Control de existencias</h2>
        <TouchButton variant="ghost" onClick={load} disabled={loading} className="px-3 py-2 text-xs">
          <RefreshCw size={14} /> Recargar
        </TouchButton>
      </div>

      {error && <p className="pb-3 text-sm text-emberred-400">{error}</p>}

      <p className="mb-4 text-sm text-bone-muted">
        El stock baja solo cuando el cajero manda la orden a cocina. Lo que está en cero
        aparece agotado en el punto de venta y ya no se puede vender. Cada cambio queda
        registrado con su motivo: una merma sin explicación no se puede guardar.
      </p>

      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className={PANEL_TITLE}>
          <tr>
            <th className="px-2 py-3">Producto</th>
            <th className="px-2 py-3">Existencias</th>
            <th className="px-2 py-3">Entrada / merma</th>
            <th className="px-2 py-3">Conteo físico</th>
            <th className="px-2 py-3">
              <span className="sr-only">Movimientos</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={5} className="px-2 py-8 text-center text-bone-muted">
                Cargando…
              </td>
            </tr>
          )}
          {!loading && products.length === 0 && (
            <tr>
              <td colSpan={5} className="px-2 py-8 text-center text-bone-muted">
                Ningún producto controla stock. Actívalo desde la pestaña Menú.
              </td>
            </tr>
          )}
          {products.map((product) => {
            const busy = busyId === product.id
            const out = product.stock <= 0
            const low = !out && product.stock <= product.low_stock_threshold

            return (
              <tr key={product.id} className="border-b border-white/5">
                <td className="px-2 py-3 font-semibold">{product.name}</td>
                <td className="px-2 py-3">
                  <span className={`font-ticket text-lg font-bold ${out ? 'text-emberred-400' : low ? 'text-saffron-400' : ''}`}>
                    {product.stock}
                  </span>
                  <span className="ml-2 text-xs text-bone-faint">umbral {product.low_stock_threshold}</span>
                  {out && <span className="ml-2 text-xs font-bold text-emberred-400">agotado</span>}
                  {low && !out && <span className="ml-2 text-xs font-bold text-saffron-400">bajo</span>}
                </td>
                <td className="px-2 py-3">
                  <div className="flex gap-1.5">
                    <TouchButton
                      variant="secondary"
                      onClick={() => restock(product, 1)}
                      disabled={busy}
                      aria-label={`Registrar entrada de una unidad de ${product.name}`}
                      className="min-h-0 rounded-lg px-2.5 py-2"
                    >
                      <Plus size={15} />
                    </TouchButton>
                    <TouchButton
                      variant="secondary"
                      onClick={() => restock(product, 10)}
                      disabled={busy}
                      aria-label={`Registrar entrada de diez unidades de ${product.name}`}
                      className="min-h-0 rounded-lg px-2.5 py-2 text-xs"
                    >
                      +10
                    </TouchButton>
                    <TouchButton
                      variant="secondary"
                      onClick={() => registerWaste(product)}
                      disabled={busy}
                      aria-label={`Registrar merma de ${product.name}`}
                      className="min-h-0 rounded-lg px-2.5 py-2"
                    >
                      <Minus size={15} />
                    </TouchButton>
                  </div>
                </td>
                <td className="px-2 py-3">
                  <div className="flex gap-1.5">
                    <input
                      value={count[product.id] ?? ''}
                      onChange={(event) =>
                        setCount((current) => ({
                          ...current,
                          [product.id]: event.target.value.replace(/\D/g, ''),
                        }))
                      }
                      placeholder="—"
                      inputMode="numeric"
                      aria-label={`Conteo de ${product.name}`}
                      className={`${INPUT} w-24 px-2 py-2 text-center font-ticket`}
                    />
                    <TouchButton
                      variant="primary"
                      onClick={() => saveCount(product)}
                      disabled={busy || count[product.id] === undefined}
                      className="min-h-0 rounded-lg px-3 py-2 text-xs"
                    >
                      {busy ? <Loader2 className="animate-spin" size={14} /> : 'Fijar'}
                    </TouchButton>
                  </div>
                </td>
                <td className="px-2 py-3">
                  <TouchButton
                    variant="ghost"
                    onClick={() => openHistory(product)}
                    aria-label={`Ver movimientos de ${product.name}`}
                    aria-expanded={historyFor === product.id}
                    className="min-h-0 rounded-lg px-2.5 py-2 text-xs"
                  >
                    <History size={15} />
                  </TouchButton>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {historyFor && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-ink-900/60 p-4">
          <h3 className={`${PANEL_TITLE} mb-3`}>Movimientos recientes</h3>

          {historyLoading && <p className="py-4 text-sm text-bone-muted">Cargando…</p>}

          {!historyLoading && history.length === 0 && (
            <p className="py-4 text-sm text-bone-muted">
              Sin movimientos registrados. El número inicial no cuenta como movimiento.
            </p>
          )}

          {!historyLoading && history.length > 0 && (
            <ul className="space-y-2">
              {history.map((movement) => (
                <li key={movement.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span
                      className={`font-ticket font-bold ${
                        movement.delta > 0 ? 'text-jade-300' : 'text-emberred-400'
                      }`}
                    >
                      {movement.delta > 0 ? `+${movement.delta}` : movement.delta}
                    </span>
                    <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[0.7rem] text-bone-muted">
                      {KIND_LABEL[movement.kind] ?? movement.kind}
                    </span>
                    <span className="min-w-0 truncate text-bone-muted">{movement.reason}</span>
                  </span>
                  <span className="shrink-0 font-ticket text-xs text-bone-faint">
                    {movement.stock_before} → {movement.stock_after} · {relativeTime(movement.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
