import TouchButton from '../../TouchButton'
import { INPUT, PANEL_TITLE } from '../fields'

/**
 * Filtro de periodo.
 *
 * Se ofrecen atajos ademas de las fechas libres porque el uso real casi siempre es
 * "¿hoy?" o "¿esta semana?". Las dos vias quedan disponibles: los atajos son botones de
 * un toque y el rango manual cubre cierres atrasados que nadie va a buscar con el dedo.
 *
 * El rango llega como props y los atajos tambien: el componente no decide el rango, solo
 * lo presenta. Asi el mismo filtro sirve para los reportes de venta y los de órdenes.
 */
export default function RangePicker({ range, onChange, presets }) {  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <span className={`${PANEL_TITLE} mb-1.5 block`}>Desde</span>
        <input
          type="date"
          value={range.from}
          max={range.to}
          onChange={(event) => onChange({ ...range, from: event.target.value })}
          aria-label="Fecha inicial del reporte"
          className={`${INPUT} w-auto px-3 py-2 text-sm`}
        />
      </div>

      <div>
        <span className={`${PANEL_TITLE} mb-1.5 block`}>Hasta</span>
        <input
          type="date"
          value={range.to}
          min={range.from}
          onChange={(event) => onChange({ ...range, to: event.target.value })}
          aria-label="Fecha final del reporte"
          className={`${INPUT} w-auto px-3 py-2 text-sm`}
        />
      </div>

      <div className="flex gap-1.5 pb-0.5">
        {presets.map((preset) => (
          <TouchButton
            key={preset.id}
            variant="secondary"
            onClick={() => onChange(preset.resolve())}
            className="min-h-0 rounded-lg px-3 py-2 text-xs"
          >
            {preset.label}
          </TouchButton>
        ))}
      </div>
    </div>
  )
}
