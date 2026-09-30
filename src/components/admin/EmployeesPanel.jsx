import { useEffect, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import TouchButton from '../TouchButton'
import supabase from '../../lib/supabase'
import { INPUT, PANEL, PANEL_TITLE } from './fields'

const ROLES = [
  { value: 'cashier', label: 'Cajero' },
  { value: 'waiter', label: 'Mesero' },
  { value: 'kitchen', label: 'Cocina' },
  { value: 'admin', label: 'Administrador' },
]

const EMPTY = { full_name: '', role: 'waiter', pin: '' }

export default function EmployeesPanel({ adminPin }) {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(EMPTY)

  /**
   * employees no tiene políticas RLS para anon: cada operación sensible va por un RPC
   * SECURITY DEFINER que revalida el PIN de administrador en el servidor. El PIN vive
   * solo en el estado de este árbol y no se persiste.
   *
   * Una autorización fallida devuelve un resultado vacío (no una excepción): si el RPC
   * lanzara, la transacción se abortaría y con ella el contador anti-fuerza-bruta.
   */
  const load = async () => {
    setLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('list_employees', { p_admin_pin: adminPin })

    if (rpcError) {
      setLoading(false)
      setError(rpcError.message)
      return
    }

    const rows = data ?? []
    if (rows.length === 0) {
      setLoading(false)
      setError('Autorización de administrador fallida')
      return
    }

    setEmployees(rows)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // adminPin solo cambia cuando el admin se autoriza por primera vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminPin])

  const create = async (event) => {
    event.preventDefault()
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('create_employee', {
      p_admin_pin: adminPin,
      p_full_name: form.full_name,
      p_role: form.role,
      p_pin: form.pin,
    })

    if (rpcError) {
      setError(rpcError.message)
      return
    }
    if (!data) {
      setError('Autorización de administrador fallida')
      return
    }
    setForm(EMPTY)
    load()
  }

  const toggle = async (employeeId) => {
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('toggle_employee', {
      p_admin_pin: adminPin,
      p_employee_id: employeeId,
    })

    if (rpcError) {
      setError(rpcError.message)
      return
    }
    if (data === null) {
      setError('Autorización de administrador fallida')
      return
    }
    load()
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_1fr]">
      <form onSubmit={create} className={`${PANEL} h-fit space-y-3`}>
        <h2 className={PANEL_TITLE}>Nuevo empleado</h2>
        <input
          value={form.full_name}
          onChange={(event) => setForm({ ...form, full_name: event.target.value })}
          placeholder="Nombre completo"
          required
          className={INPUT}
        />
        <select
          value={form.role}
          onChange={(event) => setForm({ ...form, role: event.target.value })}
          className={INPUT}
        >
          {ROLES.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
        <input
          value={form.pin}
          onChange={(event) => setForm({ ...form, pin: event.target.value.replace(/\D/g, '').slice(0, 4) })}
          placeholder="PIN (4 dígitos)"
          inputMode="numeric"
          maxLength={4}
          required
          className={`${INPUT} text-center font-ticket text-xl tracking-[0.4em]`}
        />
        <TouchButton type="submit" className="w-full">
          <Plus size={18} /> Crear
        </TouchButton>
      </form>

      <section className={`${PANEL} overflow-x-auto`}>
        {error && <p className="pb-3 text-sm text-emberred-400">{error}</p>}
        <table className="w-full text-left text-sm">
          <thead className={PANEL_TITLE}>
            <tr>
              <th className="px-2 py-3">Nombre</th>
              <th className="px-2 py-3">Rol</th>
              <th className="px-2 py-3">Estado</th>
              <th className="px-2 py-3" />
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
            {!loading && employees.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-8 text-center text-bone-muted">
                  Sin empleados registrados
                </td>
              </tr>
            )}
            {employees.map((employee) => (
              <tr key={employee.id} className="border-b border-white/5">
                <td className="px-2 py-3 font-semibold">{employee.full_name}</td>
                <td className="px-2 py-3 text-bone-muted">
                  {ROLES.find((r) => r.value === employee.role)?.label ?? employee.role}
                </td>
                <td className="px-2 py-3">
                  <span className={employee.is_active ? 'text-jade-400' : 'text-emberred-400'}>
                    {employee.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-2 py-3 text-right">
                  <TouchButton
                    variant="secondary"
                    onClick={() => toggle(employee.id)}
                    className="min-h-0 rounded-lg px-3 py-2 text-xs"
                  >
                    {employee.is_active ? 'Desactivar' : 'Activar'}
                  </TouchButton>
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
