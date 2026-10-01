import { useMemo } from 'react'
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
 *
 * ZONAS Y POR QUÉ SON UN RECTÁNGULO CALCULADO, NO UN DIBUJO
 *
 * Cada bloque es el rectángulo que envuelve a sus mesas, con un margen para que
 * las fichas no queden pegadas al borde. El margen NO es el mismo en horizontal
 * que en vertical, y no por gusto: la ficha es un cuadrado de 20 unidades, así
 * que la mitad de su ancho y de su alto ocupan lo mismo (10%), y el marco tiene
 * que rodearla por igual en ambos ejes. En X es 9 para que el marco abrace la
 * ficha sin quedar visiblemente suelto. En Y es 16 porque arriba hace falta sitio
 * para la etiqueta del bloque, que va montada sobre el borde superior: con 10 se
 * quedaría a medio tapar la primera fila.
 *
 * Las mesas SIN zona no se agrupan: se dibujan sueltas, como antes de que
 * existieran los bloques. Es un caso válido (una mesa recién creada que nadie ha
 * etiquetado) y esconderla sería peor que mostrarla sin marco.
 *
 * LAS VIRTUALES QUEDAN FUERA A PROPÓSITO
 *
 * Barra y Para llevar no ocupan un lugar del salón: son un número que agrupa
 * órdenes. Meterlas en un bloque las haría parecer mesas que se pueden arrastrar
 * dentro de un grupo del que no son parte. El RPC ya les anula la zona, y aquí se
 * vuelven a separar para que el orden de dibujo no las meta en un rectángulo.
 */

/** Margen del bloque, en % del lienzo, alrededor de las mesas que contiene. */
const BLOCK_PAD_X = 9
const BLOCK_PAD_Y = 16

/**
 * Agrupa las mesas por zona y calcula el rectángulo de cada bloque.
 *
 * Se usa un Map para conservar el orden de aparición: las zonas se nombran por
 * tables del salón, y un salón no debería reordenarse solo porque cambió la
 * consulta que lo trajo.
 */
function useZoneBlocks(tables) {
  return useMemo(() => {
    const zones = new Map()

    for (const table of tables) {
      if (table.isVirtual || !table.zone) continue
      if (!zones.has(table.zone)) zones.set(table.zone, [])
      zones.get(table.zone).push(table)
    }

    return [...zones.entries()].map(([name, members]) => {
      const xs = members.map((t) => t.posX)
      const ys = members.map((t) => t.posY)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)

      return {
        name,
        tables: members,
        left: Math.max(0, minX - BLOCK_PAD_X),
        top: Math.max(0, minY - BLOCK_PAD_Y),
        width: Math.min(100, maxX - minX + BLOCK_PAD_X * 2),
        height: Math.min(100, maxY - minY + BLOCK_PAD_Y * 2),
      }
    })
  }, [tables])
}

export default function TableMap({ tables, editable = false, onSelect, onMoveEnd, className = '' }) {
  const blocks = useZoneBlocks(tables)

  // Las que no están en ningún bloque: las virtuales y las mesas sin zona. Se
  // dibujan después para que el marco de un bloque nunca tape una ficha.
  const loose = tables.filter((t) => t.isVirtual || !t.zone)

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

      {blocks.map((block) => (
        <div
          key={block.name}
          className="pointer-events-none absolute rounded-3xl border border-dashed border-white/20 bg-white/[0.035]"
          style={{
            left: `${block.left}%`,
            top: `${block.top}%`,
            width: `${block.width}%`,
            height: `${block.height}%`,
          }}
        >
          {/* La etiqueta va arriba a la izquierda, dentro del margen, para que se lea
              como encabezado del grupo y no como una mesa más. */}
          <span className="absolute -top-2.5 left-3 rounded-full border border-white/15 bg-ink-900 px-2.5 py-0.5 font-ticket text-[0.65rem] font-bold tracking-wide text-bone-muted uppercase">
            {block.name}
          </span>
        </div>
      ))}

      {blocks.flatMap((block) =>
        block.tables.map((table) => (
          <TableCard
            key={table.tableId}
            table={table}
            editable={editable && !table.isVirtual}
            onSelect={onSelect}
            onMoveEnd={onMoveEnd}
          />
        )),
      )}

      {loose.map((table) => (
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
