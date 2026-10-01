import TableCard from './TableCard'

/**
 * Lienzo del salón.
 *
 * Las posiciones vienen en PORCENTAJE desde la base (pos_x / pos_y), no en
 * píxeles: el layout se define una vez en Administración y se ve igual en una
 * tablet de 8 que en una de 11. Cada ficha se posiciona con left/top en % y se
 * centra con translate(-50%, -50%).
 *
 * El lienzo es un cuadrado que ya tiene una proporción parecida a un salón real.
 * `aspect-square` hace que el arrastre y el cálculo de % usen siempre el mismo
 * denominador; si la caja no fuera cuadrada, el mismo gesto daría una posición
 * distinta depending de si el dedo iba en X o en Y.
 */
export default function TableMap({ tables, editable = false, onSelect, onMoveEnd, className = '' }) {
  return (
    <div
      className={`relative aspect-square w-full overflow-hidden rounded-3xl border border-white/10 bg-ink-950/60 ${
        editable ? 'bg-ink-950' : ''
      } ${className}`}
    >
      {tables.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-bone-muted">
          Sin mesas configuradas
        </p>
      )}

      {tables.map((table) => (
        <TableCard
          key={table.tableId}
          table={table}
          editable={editable && !table.isVirtual}
          onSelect={onSelect}
          onMoveEnd={onMoveEnd}
        />
      ))}
    </div>
  )
}