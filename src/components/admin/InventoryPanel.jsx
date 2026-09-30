import { useEffect, useState } from 'react'
import { Loader2, Minus, Plus, RefreshCw } from 'lucide-react'
import TouchButton from '../TouchButton'
import supabase from '../../lib/supabase'
import { INPUT, PANEL, PANEL_TITLE } from './fields'

/**
 * Solo aparecen los productos con tracks_stock. El ajuste es por delta y lo resuelve
 * el servidor dentro de la función, así que dos tablets restando a la vez no se pisan.
 * El conteo físico usa el campo absoluto, que manda el número real y no un incremento.
 */
export default function InventoryPanel({ adminPin }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [count, setCount] = useState({})

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

  const adjust = async (product, delta) => {
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

  /** Conteo físico: manda el número absoluto, no la diferencia. */
  const saveCount = async (product) => {
    const value = Number(count[product.id])
    if (!Number.isFinite(value) || value < 0) {
      setError('Escribe una cantidad válida')
      return
    }
    setBusyId(product.id)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('save_product', {
      p_admin_pin: adminPin,
      p_product: {
        id: product.id,
        name: product.name,
        price: product.price,
        category: product.category,
        stock: value,
        low_stock_threshold: product.low_stock_threshold,
      },
    })

    if (rpcError) {
      setError(rpcError.message)
    } else if (!data) {
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
        aparece agotado en el punto de venta y ya no se puede vender.
      </p>

      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className={PANEL_TITLE}>
          <tr>
            <th className="px-2 py-3">Producto</th>
            <th className="px-2 py-3">Existencias</th>
            <th className="px-2 py-3">Ajuste rápido</th>
            <th className="px-2 py-3">Conteo físico</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={4} className="px-2 py-8 text-center text-bone-muted">
                Cargando…
              </td>
            </tr>
          )}
          {!loading && products.length === 0 && (
            <tr>
              <td colSpan={4} className="px-2 py-8 text-center text-bone-muted">
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
                      onClick={() => adjust(product, -1)}
                      disabled={busy}
                      aria-label={`Quitar una unidad de ${product.name}`}
                      className="min-h-0 rounded-lg px-2.5 py-2"
                    >
                      <Minus size={15} />
                    </TouchButton>
                    <TouchButton
                      variant="secondary"
                      onClick={() => adjust(product, 1)}
                      disabled={busy}
                      aria-label={`Añadir una unidad de ${product.name}`}
                      className="min-h-0 rounded-lg px-2.5 py-2"
                    >
                      <Plus size={15} />
                    </TouchButton>
                    <TouchButton
                      variant="secondary"
                      onClick={() => adjust(product, 10)}
                      disabled={busy}
                      className="min-h-0 rounded-lg px-2.5 py-2 text-xs"
                    >
                      +10
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
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
