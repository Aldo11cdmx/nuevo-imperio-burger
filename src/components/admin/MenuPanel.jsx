import { useEffect, useMemo, useState } from 'react'
import { Loader2, Pencil, Plus, RefreshCw, X } from 'lucide-react'
import TouchButton from '../TouchButton'
import { formatMXN } from '../../lib/format'
import supabase from '../../lib/supabase'
import { INPUT, PANEL, PANEL_TITLE } from './fields'

const EMPTY = {
  name: '',
  price: '',
  category: '',
  is_active: true,
  tracks_stock: false,
  stock: 0,
  low_stock_threshold: 0,
  image_url: '',
}

export default function MenuPanel({ adminPin }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)

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
    if (!data || data.length === 0) {
      setLoading(false)
      setError('Autorización de administrador fallida')
      return
    }

    setProducts(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminPin])

  // El datalist del formulario ofrece las categorías que ya existen, para que el admin
  // escriba "bebidas" y no "Bebidas " o "bebida", que fragmentarían la carta en dos.
  const categories = useMemo(
    () => [...new Set(products.map((product) => product.category))].sort(),
    [products],
  )

  const startEdit = (product) => {
    setEditing(product.id)
    setForm({
      name: product.name,
      price: String(product.price),
      category: product.category,
      is_active: product.is_active,
      tracks_stock: product.tracks_stock,
      stock: product.stock,
      low_stock_threshold: product.low_stock_threshold,
      image_url: product.image_url ?? '',
    })
  }

  const cancelEdit = () => {
    setEditing(null)
    setForm(EMPTY)
  }

  const save = async (event) => {
    event.preventDefault()
    setError(null)
    setSaving(true)

    const { data, error: rpcError } = await supabase.rpc('save_product', {
      p_admin_pin: adminPin,
      p_product: {
        id: editing,
        name: form.name,
        price: form.price,
        category: form.category,
        is_active: form.is_active,
        tracks_stock: form.tracks_stock,
        stock: Number(form.stock) || 0,
        low_stock_threshold: Number(form.low_stock_threshold) || 0,
        image_url: form.image_url,
      },
    })

    if (rpcError) {
      setSaving(false)
      setError(rpcError.message)
      return
    }
    if (!data) {
      setSaving(false)
      setError('Autorización de administrador fallida')
      return
    }

    setSaving(false)
    cancelEdit()
    load()
  }

  /** Activa o desactiva sin abrir el formulario: es el gesto más frecuente. */
  const toggleActive = async (product) => {
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('save_product', {
      p_admin_pin: adminPin,
      p_product: { id: product.id, name: product.name, price: product.price, category: product.category, is_active: !product.is_active },
    })
    if (rpcError) return setError(rpcError.message)
    if (!data) return setError('Autorización de administrador fallida')
    load()
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]">
      <form onSubmit={save} className={`${PANEL} h-fit space-y-3`}>
        <h2 className={PANEL_TITLE}>{editing ? 'Editando producto' : 'Nuevo producto'}</h2>

        <input
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="Nombre"
          required
          className={INPUT}
        />
        <input
          value={form.price}
          onChange={(event) => setForm({ ...form, price: event.target.value.replace(/[^\d.]/g, '') })}
          placeholder="Precio"
          inputMode="decimal"
          required
          className={`${INPUT} font-ticket`}
        />
        <input
          value={form.category}
          onChange={(event) => setForm({ ...form, category: event.target.value })}
          placeholder="Categoría"
          list="admin-categorias"
          required
          className={INPUT}
        />
        <datalist id="admin-categorias">
          {categories.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>

        <input
          value={form.image_url}
          onChange={(event) => setForm({ ...form, image_url: event.target.value })}
          placeholder="URL de la foto (opcional)"
          className={INPUT}
        />

        <div className="flex gap-4 pt-1 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
              className="h-5 w-5 accent-saffron-400"
            />
            Activo
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.tracks_stock}
              onChange={(event) => setForm({ ...form, tracks_stock: event.target.checked })}
              className="h-5 w-5 accent-saffron-400"
            />
            Controla stock
          </label>
        </div>

        {form.tracks_stock && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs text-bone-muted">Existencias</span>
              <input
                value={form.stock}
                onChange={(event) =>
                  setForm({ ...form, stock: event.target.value.replace(/\D/g, '') })
                }
                inputMode="numeric"
                className={`${INPUT} font-ticket text-center`}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-bone-muted">Umbral</span>
              <input
                value={form.low_stock_threshold}
                onChange={(event) =>
                  setForm({ ...form, low_stock_threshold: event.target.value.replace(/\D/g, '') })
                }
                inputMode="numeric"
                className={`${INPUT} font-ticket text-center`}
              />
            </label>
          </div>
        )}

        <div className="flex gap-2">
          <TouchButton type="submit" className="flex-1" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
            {editing ? 'Guardar' : 'Crear'}
          </TouchButton>
          {editing && (
            <TouchButton variant="secondary" onClick={cancelEdit} aria-label="Cancelar edición">
              <X size={18} />
            </TouchButton>
          )}
        </div>
      </form>

      <section className={`${PANEL} overflow-x-auto`}>
        {error && <p className="pb-3 text-sm text-emberred-400">{error}</p>}
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className={PANEL_TITLE}>
            <tr>
              <th className="px-2 py-3">Producto</th>
              <th className="px-2 py-3">Categoría</th>
              <th className="px-2 py-3">Precio</th>
              <th className="px-2 py-3">Stock</th>
              <th className="px-2 py-3" />
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
            {!loading && products.map((product) => (
              <tr
                key={product.id}
                className={`border-b border-white/5 ${product.is_active ? '' : 'opacity-45'}`}
              >
                <td className="px-2 py-3">
                  <p className="font-semibold">{product.name}</p>
                  {!product.is_active && <p className="text-xs text-emberred-400">Inactivo</p>}
                </td>
                <td className="px-2 py-3 text-bone-muted">{product.category}</td>
                <td className="px-2 py-3 font-ticket">{formatMXN(product.price)}</td>
                <td className="px-2 py-3 font-ticket">
                  {product.tracks_stock ? product.stock : '—'}
                  {product.tracks_stock && product.stock <= product.low_stock_threshold && (
                    <span className="ml-1.5 text-xs text-saffron-400">bajo</span>
                  )}
                </td>
                <td className="px-2 py-3">
                  <div className="flex justify-end gap-1.5">
                    <TouchButton
                      variant="ghost"
                      onClick={() => startEdit(product)}
                      aria-label={`Editar ${product.name}`}
                      className="min-h-0 rounded-lg px-2.5 py-2"
                    >
                      <Pencil size={16} />
                    </TouchButton>
                    <TouchButton
                      variant="secondary"
                      onClick={() => toggleActive(product)}
                      className="min-h-0 rounded-lg px-2.5 py-2 text-xs"
                    >
                      {product.is_active ? 'Ocultar' : 'Mostrar'}
                    </TouchButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pt-3">
          <TouchButton variant="ghost" onClick={load} disabled={loading} className="px-3 py-2 text-xs">
            <RefreshCw size={14} /> Recargar
          </TouchButton>
        </div>
      </section>
    </div>
  )
}
