import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import TouchButton from './TouchButton'
import { formatMXN } from '../lib/format'

/**
 * Diálogo de extras de un producto.
 *
 * Aparece al tocar un producto que tiene grupos de extras y decide qué línea entra al
 * carrito: nombre, extras elegidos y cuánto sube.
 *
 * -----------------------------------------------------------------------------
 * Por qué un diálogo y no controles en la carta
 * -----------------------------------------------------------------------------
 * La carta es una rejilla de tarjetas grandes para tocar rápido. Poner un selector de
 * extras en cada tarjeta convierte la carta en un formulario y hace que agregar una
 * hamburguesa común cueste tres toques. El diálogo solo aparece cuando hay algo que
 * decidir.
 *
 * Y el precio se ve ANTES de aceptar, porque en una barra de $15 no se descubre si
 * cuesta $15 o $30 hasta que ya se mandó a cocina.
 *
 * Y `chosen` NO se reinicia con un efecto cuando cambia el producto: el POS monta este
 * diálogo con `key={product.id}`, así que cada producto abre una instancia nueva y ya
 * nace sin extras marcados. Reiniciarlo con un efecto dejaría durante un render los
 * extras del producto anterior marcados en el nuevo, que es justo lo que pasa por
 * pantalla en una tablet y alcanza para que alguien mande un queso de más.
 */
export default function ModifierDialog({ product, groups, onConfirm, onClose }) {
  /**
   * `{ [modifierId]: cantidad }`.
   *
   * Un objeto y no un array porque la pregunta en cada toque es "¿cuántos hay?", y
   * con un objeto eso es una consulta directa en vez de buscar en una lista.
   */
  const [chosen, setChosen] = useState({})

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!product) return null

  /** Cuántas unidades hay de un extra en el total de la línea. */
  const countInGroup = (group) =>
    group.modifiers.reduce((sum, mod) => sum + (chosen[mod.id] ?? 0), 0)

  /**
   * Toca un extra: alterna entre 0 y 1.
   *
   * Solo alterna porque el caso real es "con queso" o "sin queso". Subir a dos o
   * tres de un extra casi nunca se necesita y, cuando se necesita, el mesero escribe
   * "3 de queso" en la nota, que es más rápido que un contador.
   */
  const toggle = (group, modifier) => {
    setChosen((current) => {
      const next = { ...current }
      const has = (next[modifier.id] ?? 0) > 0

      if (!has) {
        // Tope del grupo respetado desde la UI. El servidor también lo valida, pero
        // dejar el botón prendido en un extra que no se puede agregar es peor que no
        // ofrecerlo.
        const already = group.modifiers.reduce((sum, m) => sum + (next[m.id] ?? 0), 0)
        if (already >= (group.max_select ?? 1)) return current
        next[modifier.id] = 1
        return next
      }

      delete next[modifier.id]
      return next
    })
  }

  /** Los extras elegidos, en el formato que espera el carrito. */
  const selected = groups.flatMap((group) =>
    group.modifiers
      .filter((modifier) => (chosen[modifier.id] ?? 0) > 0)
      .map((modifier) => ({ ...modifier, quantity: chosen[modifier.id] })),
  )

  const extraTotal = selected.reduce((sum, mod) => sum + Number(mod.price ?? 0) * mod.quantity, 0)
  const unitTotal = Number(product.price ?? 0) + extraTotal

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/80 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Extras de ${product.name}`}
        className="flex max-h-dvh w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-ink-900 shadow-glass sm:rounded-3xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
          <div className="min-w-0">
            <p className="font-ticket text-lg font-bold text-saffron-400">{product.name}</p>
            <p className="text-xs text-bone-muted">{formatMXN(product.price)} c/u</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar sin agregar"
            className="shrink-0 rounded-full p-2 text-bone-muted hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {groups.map((group) => {
            const count = countInGroup(group)
            const full = count >= (group.max_select ?? 1)

            return (
              <section key={group.group_id}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold text-bone">{group.name}</h3>
                  <span className="text-xs text-bone-muted">
                    {group.min_select > 0
                      ? `Elige ${group.min_select}`
                      : full
                        ? 'Máximo alcanzado'
                        : `Hasta ${group.max_select}`}
                  </span>
                </div>

                <ul className="space-y-2">
                  {group.modifiers.map((modifier) => {
                    const on = (chosen[modifier.id] ?? 0) > 0
                    const disabled = !on && full

                    return (
                      <li key={modifier.id}>
                        <button
                          type="button"
                          onClick={() => toggle(group, modifier)}
                          disabled={disabled}
                          aria-pressed={on}
                          className={`flex w-full min-h-touch items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                            on
                              ? 'border-jade-400 bg-jade-400/15'
                              : disabled
                                ? 'border-white/5 bg-white/[0.02] opacity-40'
                                : 'border-white/10 bg-white/[0.06] hover:bg-white/10'
                          }`}
                        >
                          <span className="min-w-0 flex-1 text-sm">{modifier.name}</span>
                          <span className="shrink-0 font-ticket text-sm text-saffron-400">
                            {Number(modifier.price) === 0 ? 'gratis' : `+${formatMXN(modifier.price)}`}
                          </span>
                          {on ? (
                            <span className="flex shrink-0 items-center gap-1 rounded-full bg-jade-400 px-2 py-0.5 text-[0.65rem] font-bold text-ink-950">
                              <Plus size={11} />
                              {chosen[modifier.id]}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>

        <footer className="space-y-3 border-t border-white/10 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-bone-muted">
              {selected.length === 0 ? 'Sin extras' : `${selected.length} extras`}
            </span>
            <span className="font-ticket text-xl font-bold text-saffron-400">
              {formatMXN(unitTotal)}
            </span>
          </div>

          <div className="flex gap-2">
            <TouchButton variant="ghost" className="flex-1" onClick={onClose}>
              Cancelar
            </TouchButton>
            <TouchButton className="flex-1" onClick={() => onConfirm(selected)}>
              Agregar
            </TouchButton>
          </div>

          <p className="text-center text-xs text-bone-faint">
            La nota de preparación va en el carrito, después de agregar.
          </p>
        </footer>
      </div>
    </div>
  )
}