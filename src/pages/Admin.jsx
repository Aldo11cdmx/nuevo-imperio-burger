import { useEffect, useState } from 'react'
import { KeyRound, Plus, RefreshCw } from 'lucide-react'
import ScreenHeader from '../components/ScreenHeader'
import TouchButton from '../components/TouchButton'
import supabase from '../lib/supabase'

const ROLES = [
  { value: 'cashier', label: 'Cajero' },
  { value: 'waiter', label: 'Mesero' },
  { value: 'kitchen', label: 'Cocina' },
  { value: 'admin', label: 'Administrador' },
]

export default function Admin() {
  const [adminPin, setAdminPin] = useState('')
  const [pinInput, setPinInput] = useState('')
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({ full_name: '', role: 'waiter', pin: '' })

  /**
   * employees no tiene políticas RLS para anon: cada operación sensible va por un RPC
   * SECURITY DEFINER que revalida el PIN de administrador en el servidor. El PIN vive
   * solo en el estado del componente y no se persiste.
   *
   * Una autorización fallida devuelve un resultado vacío (no una excepción): si el RPC
   * lanzara, la transacción se abortaría y con ella el contador anti-fuerza-bruta.
   */
  const load = async (pin) => {
    setLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('list_employees', { p_admin_pin: pin })

    if (rpcError) {
      setLoading(false)
      setError(rpcError.message)
      return false
    }

    const rows = data ?? []
    if (rows.length === 0) {
      setLoading(false)
      setError('Autorización de administrador fallida')
      return false
    }

    setEmployees(rows)
    setLoading(false)
    return true
  }

  useEffect(() => {
    if (adminPin) load(adminPin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminPin])

  const authorize = async (event) => {
    event.preventDefault()
    const ok = await load(pinInput)
    if (ok) {
      setAdminPin(pinInput)
      setPinInput('')
    }
  }

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
    setForm({ full_name: '', role: 'waiter', pin: '' })
    load(adminPin)
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
    load(adminPin)
  }

  const lock = () => {
    setAdminPin('')
    setEmployees([])
    setError(null)
  }

  if (!adminPin) {
    return (
      <div className="flex min-h-screen flex-col">
        <ScreenHeader title="Administración" subtitle="Autorización requerida" />
        <form onSubmit={authorize} className="m-auto w-full max-w-xs space-y-3 px-6">
          <div className="flex items-center gap-2 text-sm text-ash-500">
            <KeyRound size={18} />
            Ingresa el PIN de un administrador
          </div>
          <input
            value={pinInput}
            onChange={(event) => setPinInput(event.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="PIN"
            inputMode="numeric"
            maxLength={4}
            required
            className="w-full rounded-lg bg-carbon-800 px-4 py-3 text-center text-2xl tracking-[0.5em] outline-none focus:ring-2 focus:ring-ember-500"
          />
          {error && <p className="text-center text-sm text-red-400">{error}</p>}
          <TouchButton type="submit" className="w-full">
            Autorizar
          </TouchButton>
        </form>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col">
      <ScreenHeader
        title="Administración"
        subtitle="Empleados y accesos"
        right={
          <div className="flex gap-2">
            <TouchButton variant="secondary" onClick={() => load(adminPin)} disabled={loading}>
              <RefreshCw size={18} />
            </TouchButton>
            <TouchButton variant="ghost" onClick={lock}>
              Salir
            </TouchButton>
          </div>
        }
      />

      <main className="grid flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-[420px_1fr]">
        <form onSubmit={create} className="h-fit space-y-3 rounded-xl bg-carbon-900 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ash-500">
            Nuevo empleado
          </h2>
          <input
            value={form.full_name}
            onChange={(event) => setForm({ ...form, full_name: event.target.value })}
            placeholder="Nombre completo"
            required
            className="w-full rounded-lg bg-carbon-800 px-4 py-3 outline-none focus:ring-2 focus:ring-ember-500"
          />
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
            className="w-full rounded-lg bg-carbon-800 px-4 py-3 outline-none focus:ring-2 focus:ring-ember-500"
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
            className="w-full rounded-lg bg-carbon-800 px-4 py-3 text-center text-xl tracking-[0.4em] outline-none focus:ring-2 focus:ring-ember-500"
          />
          <TouchButton type="submit" className="w-full">
            <Plus size={18} /> Crear
          </TouchButton>
        </form>

        <section className="overflow-hidden rounded-xl bg-carbon-900">
          {error && <p className="p-4 text-sm text-red-400">{error}</p>}
          <table className="w-full text-left text-sm">
            <thead className="border-b border-carbon-700 text-ash-500">
              <tr>
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-ash-500">
                    Cargando…
                  </td>
                </tr>
              )}
              {!loading && employees.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-ash-500">
                    Sin empleados registrados
                  </td>
                </tr>
              )}
              {employees.map((employee) => (
                <tr key={employee.id} className="border-b border-carbon-800">
                  <td className="px-4 py-3 font-semibold">{employee.full_name}</td>
                  <td className="px-4 py-3">{ROLES.find((r) => r.value === employee.role)?.label ?? employee.role}</td>
                  <td className="px-4 py-3">
                    <span className={employee.is_active ? 'text-emerald-400' : 'text-red-400'}>
                      {employee.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <TouchButton
                      variant={employee.is_active ? 'secondary' : 'primary'}
                      onClick={() => toggle(employee.id)}
                      className="min-h-0 px-3 py-2 text-xs"
                    >
                      {employee.is_active ? 'Desactivar' : 'Activar'}
                    </TouchButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  )
}
