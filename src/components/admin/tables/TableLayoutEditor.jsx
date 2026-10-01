import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react'
import TableMap from '../../tables/TableMap'
import TouchButton from '../../TouchButton'
import { INPUT, PANEL, PANEL_TITLE } from '../fields'
import { useTableStore } from '../../../store/useTableStore'

const SHAPES = [
  { id: 'square', label: 'Cuadrada' },
  { id: 'round', label: 'Redonda' },
  { id: 'rect', label: 'Rectangular' },
]

/**
 * Editor del layout del salón.
 *
 * Arrastrar mueve una mesa; tocar su número la abre para editar sus datos. Se
 * edita el tamaño con un botón por mesa en vez de un panel de selección aparte:
 * en una tablet el flujo natural es "toco la mesa que quiero cambiar", no
 * "selecciono mesa y luego la edito".
 *
 * Las mesas virtuales (Barra, Para llevar) no se arrastran: no tienen posición
 * física en el salón, solo un número que agrupa sus órdenes.
 */
export default function TableLayoutEditor({ adminPin }) {
  const { tables, loading, error, fetchTables, saveTable, moveTable, clearError } = useTableStore()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchTables()
  }, [fetchTables])

  /**
   * Los nombres de zona que ya existen en el salón, para ofrecerlos como atajos.
   * Se leen de las mesas y no se guardan aparte: si el nombre vive en dos sitios,
   * basta con editar uno para que dejen de coincidir.
   */
  const zoneNames = useMemo(
    () => [...new Set(tables.map((t) => t.zone).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [tables],
  )

  const startEdit = (table) => {
    setForm({
      tableId: table.tableId,
      number: table.number,
      label: table.label,
      seats: table.seats,
      shape: table.shape,
      isActive: true,
      zone: table.zone ?? '',
    })
  }

  const persist = async (override = {}) => {
    setSaving(true)
    const current = tables.find((t) => t.tableId === form.tableId)
    const ok = await saveTable({
      adminPin,
      tableId: form.tableId,
      number: Number(form.number),
      label: form.label,
      seats: Number(form.seats),
      shape: form.shape,
      posX: override.posX ?? current?.posX ?? 50,
      posY: override.posY ?? current?.posY ?? 50,
      isActive: form.isActive,
      // Vacío = sin zona, no una zona llamada "". El RPC también lo normaliza,
      // pero mandarlo ya limpio evita depender de esa normalización.
      zone: form.zone.trim() || null,
    })
    setSaving(false)
    return ok
  }

  const deactivate = async () => {
    const current = tables.find((t) => t.tableId === form.tableId)
    const ok = await saveTable({
      adminPin,
      tableId: form.tableId,
      number: Number(form.number),
      label: form.label,
      seats: Number(form.seats),
      shape: form.shape,
      posX: current?.posX ?? 50,
      posY: current?.posY ?? 50,
      isActive: false,
      zone: form.zone.trim() || null,
    })
    if (ok) setForm(null)
  }

  const createTable = async () => {
    // El número se propone como el mayor existente + 1 para no chocar con la barra
    // (0) ni con para llevar (999).
    const next = tables.reduce((max, t) => (t.number < 999 ? Math.max(max, t.number) : max), 0) + 1
    const id = await saveTable({
      adminPin,
      tableId: null,
      number: next,
      label: `Mesa ${next}`,
      seats: 4,
      shape: 'square',
      posX: 50,
      posY: 50,
      isActive: true,
    })
    if (id) setForm(null)
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-emberred-500/40 bg-emberred-500/10 px-3 py-2 text-sm text-emberred-400">
          {error}
          <button type="button" onClick={clearError} className="ml-auto text-xs underline">
            cerrar
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          {loading && tables.length === 0 ? (
            <p className="flex items-center justify-center py-20 text-bone-muted">
              <Loader2 className="mr-2 animate-spin" size={18} /> Cargando mesas…
            </p>
          ) : (
            <TableMap
              tables={tables}
              editable
              onMoveEnd={(tableId, x, y) => moveTable(tableId, x, y, adminPin)}
              onSelect={startEdit}
            />
          )}
          <p className="mt-2 text-center text-xs text-bone-muted">
            Arrastra una mesa para moverla. Toca su número para editar sus datos o cambiar su zona.
          </p>
        </div>

        <aside className={`${PANEL} h-fit space-y-3`}>
          {form ? (
            <div className="space-y-3">
              <h3 className={PANEL_TITLE}>Editar mesa</h3>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-bone-muted">Número</span>
                <input
                  value={form.number}
                  onChange={(e) =>
                    setForm({ ...form, number: e.target.value.replace(/\D/g, '').slice(0, 3) })
                  }
                  inputMode="numeric"
                  className={`${INPUT} text-sm`}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-bone-muted">Nombre</span>
                <input
                  value={form.label ?? ''}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="Mesa 3, Terraza…"
                  className={`${INPUT} text-sm`}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-bone-muted">Capacidad</span>
                <input
                  value={form.seats}
                  onChange={(e) => setForm({ ...form, seats: e.target.value.replace(/\D/g, '') })}
                  inputMode="numeric"
                  className={`${INPUT} text-sm`}
                />
              </label>

              <div>
                <span className="mb-1 block text-xs font-medium text-bone-muted">Forma</span>
                <div className="flex gap-1.5">
                  {SHAPES.map((s) => (
                    <TouchButton
                      key={s.id}
                      variant={form.shape === s.id ? 'primary' : 'secondary'}
                      onClick={() => setForm({ ...form, shape: s.id })}
                      className="flex-1 px-2 text-xs"
                    >
                      {s.label}
                    </TouchButton>
                  ))}
                </div>
              </div>

              <div>
                <span className="mb-1 block text-xs font-medium text-bone-muted">Zona o bloque</span>
                <input
                  value={form.zone ?? ''}
                  onChange={(e) => setForm({ ...form, zone: e.target.value })}
                  placeholder="Bloque A, Terraza…"
                  className={`${INPUT} text-sm`}
                />
                {/* Los nombres que ya existen se ofrecen como botones y no como
                    sugerencias del navegador: un datalist en Android tarda varios
                    toques en abrir y escribe en mayúsculas. Los bloques del salón se
                    escriben pocas veces, pero escribirlos bien importa. */}
                {zoneNames.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {zoneNames.map((z) => (
                      <TouchButton
                        key={z}
                        variant={form.zone === z ? 'primary' : 'secondary'}
                        onClick={() => setForm({ ...form, zone: z })}
                        className="px-3 text-xs"
                      >
                        {z}
                      </TouchButton>
                    ))}
                    {form.zone && (
                      <TouchButton
                        variant="ghost"
                        onClick={() => setForm({ ...form, zone: '' })}
                        className="px-3 text-xs"
                      >
                        <X size={13} /> Quitar
                      </TouchButton>
                    )}
                  </div>
                )}
                <span className="mt-1 block text-[0.65rem] text-bone-muted">
                  Déjalo vacío si la mesa no pertenece a ningún bloque.
                </span>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="h-5 w-5 accent-saffron-400"
                />
                Activa
              </label>

              <div className="flex gap-2">
                <TouchButton
                  variant="secondary"
                  className="flex-1 text-xs"
                  onClick={deactivate}
                >
                  <Trash2 size={14} /> Desactivar
                </TouchButton>
                <TouchButton
                  className="flex-1 text-xs"
                  disabled={saving}
                  onClick={async () => {
                    if (await persist()) setForm(null)
                  }}
                >
                  {saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />} Guardar
                </TouchButton>
              </div>

              <TouchButton variant="ghost" className="w-full text-xs" onClick={() => setForm(null)}>
                Cancelar
              </TouchButton>
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className={PANEL_TITLE}>Mesas</h3>
              <p className="text-xs text-bone-muted">
                Toca una mesa del mapa para editar su número, nombre y capacidad. Agrega las nuevas
                desde aquí.
              </p>
              <TouchButton className="w-full" onClick={createTable}>
                <Plus size={17} /> Agregar mesa
              </TouchButton>

              <ul className="space-y-1.5">
                {tables.map((t) => (
                  <li key={t.tableId}>
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-left text-sm transition-colors active:bg-white/10"
                    >
                      <span className="font-semibold">{t.label}</span>
                      <span className="font-ticket text-xs text-bone-muted">
                        #{t.number} · {t.seats} lug.
                        {t.zone ? ` · ${t.zone}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}