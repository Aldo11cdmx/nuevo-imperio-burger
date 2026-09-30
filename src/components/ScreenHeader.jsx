import { Link, useLocation } from 'react-router-dom'
import { ChefHat, Flame, LayoutGrid, ShieldCheck, Wallet } from 'lucide-react'

const NAV = [
  { to: '/pos', label: 'Punto de venta', icon: LayoutGrid },
  { to: '/caja', label: 'Caja', icon: Wallet },
  { to: '/kitchen', label: 'Cocina', icon: ChefHat },
  { to: '/admin', label: 'Admin', icon: ShieldCheck },
]

export default function ScreenHeader({ title, subtitle, right }) {
  const { pathname } = useLocation()

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-ink-950/60 px-4 py-3 backdrop-blur-xl sm:px-6">
      <div className="flex items-center gap-3 sm:gap-5">
        <Link to="/pos" className="flex shrink-0 items-center gap-2.5" aria-label="Ir al punto de venta">
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

        <div className="min-w-0 flex-1 border-l border-white/10 pl-4 sm:pl-5">
          <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">{title}</h1>
          {subtitle && <p className="truncate text-xs text-bone-muted sm:text-sm">{subtitle}</p>}
        </div>

        <nav className="flex shrink-0 items-center gap-1 rounded-2xl bg-white/[0.05] p-1">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname === to
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white/[0.12] text-bone shadow-glass-sm'
                    : 'text-bone-muted hover:bg-white/[0.06] hover:text-bone'
                }`}
              >
                <Icon size={17} />
                <span className="hidden lg:inline">{label}</span>
              </Link>
            )
          })}
        </nav>

        {right}
      </div>
    </header>
  )
}
