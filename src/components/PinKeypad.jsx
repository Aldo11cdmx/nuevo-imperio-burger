import { Delete, Eraser } from 'lucide-react'
import TouchButton from './TouchButton'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back']

export default function PinKeypad({ onDigit, onClear, onBackspace, disabled = false }) {
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
      {KEYS.map((key) => {
        const isAction = key === 'clear' || key === 'back'

        const label =
          key === 'clear' ? 'Borrar todo el PIN' : key === 'back' ? 'Borrar el último dígito' : `Dígito ${key}`

        return (
          <TouchButton
            key={key}
            variant={isAction ? 'secondary' : 'primary'}
            disabled={disabled}
            onClick={() => {
              if (key === 'clear') return onClear()
              if (key === 'back') return onBackspace()
              onDigit(key)
            }}
            aria-label={label}
            // h-[clamp] mantiene el objetivo táctil cómodo en tablet y en móvil estrecho.
            className="h-[clamp(4.5rem,13vh,7rem)] text-[clamp(1.75rem,5vh,2.5rem)] font-bold"
          >
            {key === 'clear' ? <Eraser size={30} /> : key === 'back' ? <Delete size={30} /> : key}
          </TouchButton>
        )
      })}
    </div>
  )
}
