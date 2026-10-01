import { useCallback, useRef, useState } from 'react'
import { Table2, Users } from 'lucide-react'
import { formatMXN } from '../../lib/format'
import { tableStateStyle } from '../../store/useTableStore'

/**
 * Ficha de una mesa en el mapa.
 *
 * Draggable solo cuando el mapa está en modo edición. Usa Pointer Events (no
 * eventos de mouse) porque en una tablet lo que llega es un dedo, y un `onMouseDown`
 * sin `touch-action: none` no dispara el arrastre en Android.
 */
export default function TableCard({ table, editable = false, onSelect, onMoveEnd }) {
  const ref = useRef(null)
  const drag = useRef(null)
  const [dragging, setDragging] = useState(false)
  const style = tableStateStyle(table.state)

  const onPointerDown = useCallback(
    (event) => {
      if (!editable) return
      // Solo botón principal / un solo dedo: con dos dedos la tablet está haciendo
      // zoom del lienzo y no arrastrando una mesa.
      if (event.button !== 0 && event.pointerType === 'mouse') return

      // Trae la ficha al frente mientras se arrastra.
      event.currentTarget.setPointerCapture?.(event.pointerId)

      drag.current = {
        pointerId: event.pointerId,
        // Diferencia entre el dedo y el centro de la ficha: sin esto la ficha salta
        // y pega su centro al dedo en el primer movimiento.
        offsetX: event.clientX - ref.current.getBoundingClientRect().left,
        offsetY: event.clientY - ref.current.getBoundingClientRect().top,
        rect: ref.current.parentElement.getBoundingClientRect(),
      }
      setDragging(true)
    },
    [editable],
  )

  const onPointerMove = useCallback(
    (event) => {
      const current = drag.current
      if (!current) return

      const x = ((event.clientX - current.offsetX - current.rect.left) / current.rect.width) * 100
      const y = ((event.clientY - current.offsetY - current.rect.top) / current.rect.height) * 100

      // Se recorta al salón: una mesa fuera del 0-100 se perdería en la base y
      // move_table la rechazaría con "la mesa se salió del salón".
      const clampedX = Math.min(94, Math.max(0, x))
      const clampedY = Math.min(94, Math.max(0, y))

      // Se mueve en estilo local durante el arrastre; la base se entera al soltar.
      ref.current.style.left = `${clampedX}%`
      ref.current.style.top = `${clampedY}%`
    },
    [],
  )

  const onPointerUp = useCallback(
    (event) => {
      const current = drag.current
      if (!current) return
      drag.current = null
      setDragging(false)
      if (!editable) return

      const rect = ref.current.parentElement.getBoundingClientRect()
      const x = ((event.clientX - current.offsetX - rect.left) / rect.width) * 100
      const y = ((event.clientY - current.offsetY - rect.top) / rect.height) * 100

      onMoveEnd?.(table.tableId, Math.min(94, Math.max(0, x)), Math.min(94, Math.max(0, y)))
    },
    [editable, onMoveEnd, table.tableId],
  )

  const shapeClass =
    table.shape === 'round' ? 'rounded-full' : table.shape === 'rect' ? 'rounded-xl' : 'rounded-2xl'

  return (
    <button
      ref={ref}
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={() => !editable && onSelect?.(table)}
      style={{ left: `${table.posX}%`, top: `${table.posY}%` }}
      className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 border-2 text-center transition-shadow ${
        editable ? 'cursor-grab touch-none select-none' : 'cursor-pointer'
      } ${dragging ? 'z-20 scale-110 shadow-2xl' : 'z-10'} ${shapeClass} ${
        table.isVirtual
          ? 'h-16 w-28 border-dashed border-white/25 bg-ink-800/80'
          : 'h-20 w-20 ' + style.border + ' bg-ink-800/90'
      }`}
    >
      {table.isVirtual ? (
        <>
          <span className="flex items-center gap-1 text-[0.6rem] font-semibold tracking-wide text-bone-muted uppercase">
            <Table2 size={11} />
            {table.label}
          </span>
          <span className="font-ticket text-xs font-bold text-bone">{table.number}</span>
        </>
      ) : (
        <>
          <span className="flex items-center gap-1 text-[0.6rem] text-bone-muted">
            {table.state !== 'free' && <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />}
            <Users size={10} />
            {table.seats}
          </span>
          <span className="font-ticket text-base leading-none font-bold text-bone">{table.number}</span>
          {table.state !== 'free' && (
            <span className={`font-ticket text-[0.6rem] font-bold ${style.text}`}>
              {formatMXN(table.amountDue)}
            </span>
          )}
        </>
      )}
    </button>
  )
}