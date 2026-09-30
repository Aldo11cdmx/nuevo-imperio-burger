import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Loader2, Minus, Plus, Send, Trash2 } from 'lucide-react'
import ScreenHeader from '../components/ScreenHeader'
import Toast from '../components/Toast'
import TouchButton from '../components/TouchButton'
import supabase from '../lib/supabase'
import { useAuthStore } from '../store/useAuthStore'
import { useCartStore } from '../store/useCartStore'

const CATEGORIES = [
  { id: 'all', label: 'Todos', items: ['burger-carbon', 'burger-sazon', 'papas', 'aros', 'limonada'] },
  { id: 'burgers', label: 'Hamburguesas', items: ['burger-carbon', 'burger-sazon'] },
  { id: 'sides', label: 'Acompañamientos', items: ['papas', 'aros'] },
  { id: 'drinks', label: 'Bebidas', items: ['limonada'] },
]

const CATALOG = [
  { id: 'burger-carbon', name: 'Burger Carbón', price: 12.5 },
  { id: 'burger-sazon', name: 'Burger Sazón', price: 11.0 },
  { id: 'papas', name: 'Papas a la brasa', price: 5.0 },
  { id: 'aros', name: 'Aros de cebolla', price: 6.0 },
  { id: 'limonada', name: 'Limonada de carbón', price: 3.5 },
]

const currency = new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD' })

/** La columna es numeric(12,2): se redondea antes de enviar para no arrastrar flotantes. */
const round2 = (value) => Math.round(value * 100) / 100

export default function POS() {
  const [category, setCategory] = useState('all')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)

  const employee = useAuthStore((state) => state.employee)
  const {
    lines,
    customerName,
    tableNumber,
    addItem,
    increase,
    decrease,
    removeLine,
    setNotes,
    setCustomer,
    setTable,
    clear,
    totals,
  } = useCartStore()
  const { subtotal, tax, total, itemCount } = totals()

  const dismissToast = useCallback(() => setToast(null), [])

  const sendToKitchen = async () => {
    if (!employee) {
      setToast({ tone: 'error', title: 'Sin sesión iniciada', detail: 'Ingresa con tu PIN para enviar la orden.' })
      return
    }
    if (lines.length === 0 || submitting) return

    setSubmitting(true)

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        created_by: employee.id,
        table_number: tableNumber,
        customer_name: customerName.trim() || null,
        subtotal: round2(subtotal),
        tax: round2(tax),
        total: round2(total),
      })
      .select('id, code')
      .single()

    if (orderError) {
      setSubmitting(false)
      setToast({ tone: 'error', title: 'No se pudo enviar la orden', detail: orderError.message })
      return
    }

    const { error: itemsError } = await supabase.from('order_items').insert(
      lines.map((line) => ({
        order_id: order.id,
        product_name: line.name,
        quantity: line.quantity,
        price: round2(line.price),
        notes: line.notes.trim() || null,
      })),
    )

    if (itemsError) {
      // Una orden sin productos llegaría a cocina como un ticket vacío. Se anula para
      // que no se cocine nada: mejor un fallo visible que un pedido sin contenido.
      await supabase.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
      setSubmitting(false)
      setToast({
        tone: 'error',
        title: `Orden #${order.code} anulada`,
        detail: 'No se pudieron guardar los productos. Inténtalo de nuevo.',
      })
      return
    }

    clear()
    setSubmitting(false)
    setToast({
      tone: 'success',
      title: `Orden #${order.code} enviada a cocina`,
      detail: `${itemCount} ${itemCount === 1 ? 'producto' : 'productos'} · ${currency.format(total)}`,
    })
  }

  const visibleProducts = CATALOG.filter((product) =>
    CATEGORIES.find((item) => item.id === category).items.includes(product.id),
  )

  return (
    <div className="flex min-h-dvh flex-col">
      <ScreenHeader
        title="Punto de venta"
        subtitle={employee ? `${employee.full_name} · ${itemCount} líneas` : `${itemCount} líneas`}
      />

      <div className="grid flex-1 grid-cols-1 gap-4 p-4 md:grid-cols-[1fr_320px] md:gap-5 md:p-5 xl:grid-cols-[1fr_380px]">
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2">
            {CATEGORIES.map((item) => (
              <TouchButton
                key={item.id}
                variant={category === item.id ? 'primary' : 'secondary'}
                onClick={() => setCategory(item.id)}
                className="px-4 text-sm"
              >
                {item.label}
              </TouchButton>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {visibleProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => addItem(product)}
                className="flex min-h-28 flex-col justify-between rounded-xl bg-carbon-800 p-4 text-left transition-[transform,background-color] duration-100 active:scale-[0.97] active:bg-carbon-700"
              >
                <span className="font-semibold leading-tight">{product.name}</span>
                <span className="text-lg font-bold text-ember-500">{currency.format(product.price)}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="flex flex-col rounded-xl bg-carbon-900 p-4 md:sticky md:top-5 md:max-h-[calc(100dvh-2.5rem)]">
          {!employee && (
            <Link
              to="/"
              className="mb-3 flex items-center gap-2 rounded-lg border border-ember-500/40 bg-ember-500/10 px-3 py-2.5 text-sm font-medium text-ember-300"
            >
              <AlertTriangle size={16} />
              Ingresa con tu PIN para enviar
            </Link>
          )}

          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ash-500">Cuenta</h2>

          <div className="mb-3 grid grid-cols-[90px_1fr] gap-2">
            <input
              value={tableNumber ?? ''}
              onChange={(event) => setTable(event.target.value === '' ? null : Number(event.target.value) || null)}
              placeholder="Mesa"
              type="number"
              min="1"
              inputMode="numeric"
              aria-label="Número de mesa"
              className="w-full rounded-lg bg-carbon-800 px-3 py-3 text-center outline-none transition-colors focus:bg-carbon-700"
            />
            <input
              value={customerName}
              onChange={(event) => setCustomer(event.target.value)}
              placeholder="Cliente (opcional)"
              aria-label="Nombre del cliente"
              className="w-full rounded-lg bg-carbon-800 px-3 py-3 outline-none transition-colors focus:bg-carbon-700"
            />
          </div>

          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain">
            {lines.length === 0 && (
              <li className="py-10 text-center text-sm text-ash-500">Sin productos agregados</li>
            )}
            {lines.map((line) => (
              <li key={line.id} className="rounded-lg bg-carbon-800 p-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{line.name}</p>
                    <p className="text-xs text-ash-500">{currency.format(line.price)} c/u</p>
                  </div>
                  <TouchButton
                    variant="ghost"
                    onClick={() => decrease(line.id)}
                    aria-label={`Quitar una unidad de ${line.name}`}
                    className="h-10 min-h-0 px-2.5"
                  >
                    <Minus size={18} />
                  </TouchButton>
                  <span className="w-6 text-center text-sm font-bold">{line.quantity}</span>
                  <TouchButton
                    variant="ghost"
                    onClick={() => increase(line.id)}
                    aria-label={`Añadir una unidad de ${line.name}`}
                    className="h-10 min-h-0 px-2.5"
                  >
                    <Plus size={18} />
                  </TouchButton>
                  <TouchButton
                    variant="ghost"
                    onClick={() => removeLine(line.id)}
                    aria-label={`Eliminar ${line.name} de la cuenta`}
                    className="h-10 min-h-0 px-2.5 text-red-400"
                  >
                    <Trash2 size={16} />
                  </TouchButton>
                </div>

                <input
                  value={line.notes}
                  onChange={(event) => setNotes(line.id, event.target.value)}
                  placeholder="Nota para cocina…"
                  aria-label={`Nota para ${line.name}`}
                  className="mt-2 w-full rounded-md bg-carbon-900 px-2.5 py-2 text-xs outline-none transition-colors focus:bg-carbon-700"
                />
              </li>
            ))}
          </ul>

          <dl className="mt-3 space-y-1 border-t border-carbon-700 pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ash-500">Subtotal</dt>
              <dd>{currency.format(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ash-500">Impuestos</dt>
              <dd>{currency.format(tax)}</dd>
            </div>
            <div className="flex justify-between text-lg font-bold">
              <dt>Total</dt>
              <dd className="text-ember-500">{currency.format(total)}</dd>
            </div>
          </dl>

          <div className="mt-4 flex gap-2">
            <TouchButton variant="secondary" onClick={clear} className="flex-1" disabled={submitting}>
              Vaciar
            </TouchButton>
            <TouchButton
              className="flex-[2]"
              onClick={sendToKitchen}
              disabled={lines.length === 0 || submitting || !employee}
            >
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Enviando…
                </>
              ) : (
                <>
                  <Send size={18} />
                  Enviar a cocina
                </>
              )}
            </TouchButton>
          </div>
        </aside>
      </div>

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
