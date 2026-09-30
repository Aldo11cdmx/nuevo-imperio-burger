import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Loader2, Minus, Plus, Send, Trash2 } from 'lucide-react'
import ScreenHeader from '../components/ScreenHeader'
import Toast from '../components/Toast'
import TouchButton from '../components/TouchButton'
import { CATEGORIES, PRODUCTS, getGradient, isPriced } from '../data/products'
import { PRICES_INCLUDE_TAX, formatMXN, round2 } from '../lib/format'
import supabase from '../lib/supabase'
import { useAuthStore } from '../store/useAuthStore'
import { useCartStore } from '../store/useCartStore'

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

  const visibleProducts = useMemo(
    () => (category === 'all' ? PRODUCTS : PRODUCTS.filter((product) => product.category === category)),
    [category],
  )

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
      detail: `${itemCount} ${itemCount === 1 ? 'producto' : 'productos'} · ${formatMXN(total)}`,
    })
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <ScreenHeader
        title="Punto de venta"
        subtitle={employee ? `${employee.full_name} · ${itemCount} líneas` : `${itemCount} líneas`}
      />

      <div className="grid flex-1 grid-cols-1 gap-4 p-4 md:gap-5 md:p-5 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_400px]">
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2">
            <TouchButton
              variant={category === 'all' ? 'primary' : 'secondary'}
              onClick={() => setCategory('all')}
              className="shrink-0 px-4 text-sm"
            >
              Todos
            </TouchButton>
            {CATEGORIES.map((item) => (
              <TouchButton
                key={item.id}
                variant={category === item.id ? 'primary' : 'secondary'}
                onClick={() => setCategory(item.id)}
                className="shrink-0 px-4 text-sm"
              >
                {item.label}
              </TouchButton>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {visibleProducts.map((product) => {
              const priced = isPriced(product)

              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={!priced}
                  onClick={() => addItem(product)}
                  className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-800/70 text-left transition-[transform,border-color,opacity] duration-100 active:scale-[0.97] active:border-saffron-400/50 disabled:opacity-45"
                >
                  {/* Sin backdrop-blur: desenfuntar una cuadrícula entera hunde los
                      frames en las tablets Android. El degradado hace de foto. */}
                  <span
                    className={`flex h-20 items-center justify-center bg-gradient-to-br ${getGradient(product)}`}
                  >
                    {product.image ? (
                      <img
                        src={product.image}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="font-display text-3xl font-bold text-white/85">
                        {product.name.charAt(0)}
                      </span>
                    )}
                  </span>

                  <span className="flex flex-1 flex-col justify-between p-3">
                    <span className="text-sm leading-tight font-semibold">{product.name}</span>
                    <span
                      className={`mt-2 font-ticket text-base font-bold ${priced ? 'text-saffron-400' : 'text-bone-faint'}`}
                    >
                      {priced ? formatMXN(product.price) : 'Sin precio'}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <aside className="relative flex flex-col self-start lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)]">
          {/* Firma visual: el borde troquelado de un ticket de impresora. */}
          <div className="pointer-events-none -mb-2 flex justify-between px-3" aria-hidden="true">
            {Array.from({ length: 22 }, (_, index) => (
              <span key={index} className="h-2.5 w-2.5 rounded-full bg-ink-950" />
            ))}
          </div>

          <div className="flex min-h-0 flex-col rounded-3xl border border-white/10 bg-white/[0.06] p-4 shadow-glass backdrop-blur-2xl">
            {!employee && (
              <Link
                to="/"
                className="mb-3 flex items-center gap-2 rounded-xl border border-emberred-500/40 bg-emberred-500/10 px-3 py-2.5 text-sm font-medium text-emberred-400"
              >
                <AlertTriangle size={16} />
                Ingresa con tu PIN para enviar
              </Link>
            )}

            <h2 className="mb-3 text-xs font-semibold tracking-[0.2em] text-bone-muted uppercase">Cuenta</h2>

            <div className="mb-3 grid grid-cols-[86px_1fr] gap-2">
              <input
                value={tableNumber ?? ''}
                onChange={(event) => setTable(event.target.value === '' ? null : Number(event.target.value) || null)}
                placeholder="Mesa"
                type="number"
                min="1"
                inputMode="numeric"
                aria-label="Número de mesa"
                className="w-full rounded-xl border border-white/10 bg-ink-800/70 px-3 py-3 text-center outline-none transition-colors focus:border-saffron-400/60"
              />
              <input
                value={customerName}
                onChange={(event) => setCustomer(event.target.value)}
                placeholder="Cliente (opcional)"
                aria-label="Nombre del cliente"
                className="w-full rounded-xl border border-white/10 bg-ink-800/70 px-3 py-3 outline-none transition-colors focus:border-saffron-400/60"
              />
            </div>

            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain">
              {lines.length === 0 && (
                <li className="py-10 text-center text-sm text-bone-muted">Sin productos agregados</li>
              )}
              {lines.map((line) => (
                <li key={line.id} className="rounded-xl border border-white/5 bg-ink-800/60 p-2.5">
                  <div className="flex items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{line.name}</p>
                      <p className="font-ticket text-xs text-bone-muted">{formatMXN(line.price)} c/u</p>
                    </div>
                    <TouchButton
                      variant="ghost"
                      onClick={() => decrease(line.id)}
                      aria-label={`Quitar una unidad de ${line.name}`}
                      className="h-10 min-h-0 rounded-lg px-2.5"
                    >
                      <Minus size={18} />
                    </TouchButton>
                    <span className="w-6 text-center font-ticket text-sm font-bold">{line.quantity}</span>
                    <TouchButton
                      variant="ghost"
                      onClick={() => increase(line.id)}
                      aria-label={`Añadir una unidad de ${line.name}`}
                      className="h-10 min-h-0 rounded-lg px-2.5"
                    >
                      <Plus size={18} />
                    </TouchButton>
                    <TouchButton
                      variant="ghost"
                      onClick={() => removeLine(line.id)}
                      aria-label={`Eliminar ${line.name} de la cuenta`}
                      className="h-10 min-h-0 rounded-lg px-2.5 text-emberred-400"
                    >
                      <Trash2 size={16} />
                    </TouchButton>
                  </div>

                  <input
                    value={line.notes}
                    onChange={(event) => setNotes(line.id, event.target.value)}
                    placeholder="Nota para cocina…"
                    aria-label={`Nota para ${line.name}`}
                    className="mt-2 w-full rounded-lg bg-ink-900/70 px-2.5 py-2 text-xs outline-none transition-colors focus:bg-ink-900"
                  />
                </li>
              ))}
            </ul>

            <dl className="mt-3 space-y-1 border-t border-dashed border-white/15 pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-bone-muted">Subtotal</dt>
                <dd className="font-ticket">{formatMXN(subtotal)}</dd>
              </div>
              {!PRICES_INCLUDE_TAX && (
                <div className="flex justify-between">
                  <dt className="text-bone-muted">IVA</dt>
                  <dd className="font-ticket">{formatMXN(tax)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between pt-1">
                <dt className="text-base font-semibold">Total</dt>
                <dd className="font-ticket text-2xl font-bold text-saffron-400">{formatMXN(total)}</dd>
              </div>
              {PRICES_INCLUDE_TAX && (
                <p className="text-right text-[0.7rem] text-bone-faint">Precios con IVA incluido</p>
              )}
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
          </div>
        </aside>
      </div>

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
