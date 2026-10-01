import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import EmployeesPanel from '../components/admin/EmployeesPanel'
import InventoryPanel from '../components/admin/InventoryPanel'
import MenuPanel from '../components/admin/MenuPanel'
import ModifiersPanel from '../components/admin/ModifiersPanel'
import OrderHistoryPanel from '../components/admin/reports/OrderHistoryPanel'
import ReportsPanel from '../components/admin/reports/ReportsPanel'
import ShiftHistoryPanel from '../components/admin/reports/ShiftHistoryPanel'
import TableLayoutEditor from '../components/admin/tables/TableLayoutEditor'
import TouchButton from '../components/TouchButton'
import ScreenHeader from '../components/ScreenHeader'
import { INPUT } from '../components/admin/fields'
import supabase from '../lib/supabase'

const TABS = [
  { id: 'menu', label: 'Menú' },
  { id: 'modifiers', label: 'Extras' },
  { id: 'inventory', label: 'Inventario' },
  { id: 'employees', label: 'Empleados' },
  { id: 'reports', label: 'Reportes' },
  { id: 'shifts', label: 'Cortes' },
  { id: 'history', label: 'Órdenes' },
  { id: 'tables', label: 'Mesas' },
]

export default function Admin() {
  const [adminPin, setAdminPin] = useState('')
  const [pinInput, setPinInput] = useState('')
  const [error, setError] = useState(null)
  const [checking, setChecking] = useState(false)
  const [tab, setTab] = useState('menu')

  /**
   * El PIN solo se valida una vez aquí. Cada panel vuelve a pasarlo a su RPC, que lo
   * revalida en el servidor: el navegador no gana ningún privilegio por haber
   * superado esta pantalla.
   */
  const authorize = async (event) => {
    event.preventDefault()
    setChecking(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('list_all_products', {
      p_admin_pin: pinInput,
    })

    setChecking(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }
    if (!data || data.length === 0) {
      setError('Autorización de administrador fallida')
      return
    }
    setAdminPin(pinInput)
    setPinInput('')
  }

  const lock = () => {
    setAdminPin('')
    setPinInput('')
    setError(null)
  }

  if (!adminPin) {
    return (
      <div className="flex min-h-dvh flex-col">
        <ScreenHeader title="Administración" subtitle="Autorización requerida" />
        <form onSubmit={authorize} className="m-auto w-full max-w-xs space-y-3 px-6">
          <div className="flex items-center gap-2 text-sm text-bone-muted">
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
            autoFocus
            className={`${INPUT} text-center font-ticket text-2xl tracking-[0.5em]`}
          />
          {error && <p className="text-center text-sm text-emberred-400">{error}</p>}
          <TouchButton type="submit" className="w-full" disabled={checking}>
            Autorizar
          </TouchButton>
        </form>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <ScreenHeader
        title="Administración"
        subtitle="Carta, inventario, reportes y accesos"
        right={
          <TouchButton variant="ghost" onClick={lock} className="shrink-0">
            Salir
          </TouchButton>
        }
      />

      <nav className="flex gap-1.5 overflow-x-auto border-b border-white/10 px-4 pt-3 md:px-5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? 'page' : undefined}
            className={`shrink-0 rounded-t-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === item.id
                ? 'border-b-2 border-saffron-400 text-bone'
                : 'border-b-2 border-transparent text-bone-muted hover:text-bone'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 p-4 md:p-5">
        {tab === 'menu' && <MenuPanel adminPin={adminPin} />}
        {tab === 'modifiers' && <ModifiersPanel adminPin={adminPin} />}
        {tab === 'inventory' && <InventoryPanel adminPin={adminPin} />}
        {tab === 'employees' && <EmployeesPanel adminPin={adminPin} />}
        {tab === 'reports' && <ReportsPanel adminPin={adminPin} />}
        {tab === 'shifts' && <ShiftHistoryPanel adminPin={adminPin} />}
        {tab === 'history' && <OrderHistoryPanel adminPin={adminPin} />}
        {tab === 'tables' && <TableLayoutEditor adminPin={adminPin} />}
      </main>
    </div>
  )
}
