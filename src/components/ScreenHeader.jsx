import { Flame } from 'lucide-react'

export default function ScreenHeader({ title, subtitle, right }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-carbon-700 px-6 py-4">
      <div className="flex items-center gap-3">
        <Flame className="text-ember-500" size={28} />
        <div>
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-ash-500">{subtitle}</p>}
        </div>
      </div>
      {right}
    </header>
  )
}
