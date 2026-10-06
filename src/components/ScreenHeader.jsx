import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChefHat, Flame, LayoutGrid, Printer, ShieldCheck, Table2, Wallet } from 'lucide-react'
import PrinterSettingsModal from './PrinterSettingsModal'
import Toast from './Toast'

const NAV = [
  { to: '/pos', label: 'Punto de venta', icon: LayoutGrid },
  { to: '/tables', label: 'Mesas', icon: Table2 },
  { to: '/caja', label: 'Caja', icon: Wallet },
  { to: '/kitchen', label: 'Cocina', icon: ChefHat },
  { to: '/admin', label: 'Admin', icon: ShieldCheck },
]

export default function ScreenHeader({ title, subtitle, right }) {
  const { pathname } = useLocation()
  const [showPrinterModal, setShowPrinterModal] = useState(false)
  const [toast, setToast] = useState(null)

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-ink-950/80 px-3 py-2.5 backdrop-blur-xl sm:px-6 sm:py-3">
      <div className="flex items-center gap-2 sm:gap-4">
        <Link to="/pos" className="flex shrink-0 items-center gap-2" aria-label="Ir al punto de venta">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-saffron-grad shadow-glow">
            <Flame className="text-ink-950" size={22} strokeWidth={2.5} />
          </span>
          <span className="hidden sm:block">
            <span className="block font-display text-lg leading-none font-bold tracking-tight">
              Nuevo Imperio
            </span>
            <span className="block text-[0.7rem] font-semibold tracking-[0.28em] text-saffron-400 uppercase">
              Burger
            </span>
          </span>
        </Link>

        <div className="min-w-0 flex-1 border-l border-white/10 pl-2.5 sm:pl-5">
          <h1 className="truncate text-sm font-bold tracking-tight sm:text-base md:text-lg">{title}</h1>
          {subtitle && (
            <p className="hidden md:block truncate text-xs text-bone-muted sm:text-sm">
              {subtitle}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowPrinterModal(true)}
            aria-label="Configurar impresora térmica"
            className="flex items-center gap-1.5 rounded-2xl bg-white/[0.05] px-3 py-2 text-xs font-semibold text-bone-muted hover:bg-white/[0.1] hover:text-bone transition-colors"
            title="Configurar impresora térmica"
          >
            <Printer size={18} className="text-saffron-400" />
            <span className="hidden xl:inline">Impresora</span>
          </button>

          <nav className="flex max-w-[50vw] sm:max-w-none shrink-0 items-center gap-1 overflow-x-auto rounded-2xl bg-white/[0.05] p-1 no-scrollbar whitespace-nowrap">
            {NAV.map(({ to, label, icon: Icon }) => {
              const active = pathname === to
              return (
                <Link
                  key={to}
                  to={to}
                  aria-current={active ? 'page' : undefined}
                  className={`flex shrink-0 min-h-[44px] items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors sm:text-sm ${
                    active
                      ? 'bg-white/[0.15] text-bone shadow-glass-sm'
                      : 'text-bone-muted hover:bg-white/[0.06] hover:text-bone'
                  }`}
                >
                  <Icon size={18} />
                  <span className="hidden md:inline">{label}</span>
                </Link>
              )
            })}
          </nav>
        </div>

        {right}
      </div>

      {showPrinterModal && (
        <PrinterSettingsModal
          onClose={() => setShowPrinterModal(false)}
          onToast={setToast}
        />
      )}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </header>
  )
}
