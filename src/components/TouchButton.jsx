import { useRef } from 'react'

const VARIANTS = {
  primary: 'bg-saffron-400 text-ink-950 shadow-glow active:bg-saffron-500',
  secondary: 'bg-white/[0.07] text-bone border border-white/10 active:bg-white/[0.13]',
  danger: 'bg-emberred-500 text-bone active:bg-emberred-600',
  ghost: 'bg-transparent text-bone-muted active:bg-white/[0.13]',
}

/**
 * Botón de acero.
 *
 * Props nuevas:
 *  - `touchDebounce` (ms): envuelve onClick con un lock de n ms. Evita dobles
 *    toques en comanda/cobro: un "rebote" del dedo disparando sendToKitchen o
 *    complete_order dos veces en la tablet.
 */
export default function TouchButton({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  className = '',
  type = 'button',
  touchDebounce = 0,
  ...rest
}) {
  const lastClick = useRef(0)

  const handleClick = (e) => {
    if (touchDebounce > 0) {
      const now = Date.now()
      if (now - lastClick.current < touchDebounce) {
        e.preventDefault()
        return
      }
      lastClick.current = now
    }
    onClick?.(e)
  }

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={disabled}
      className={`inline-flex min-h-touch items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold transition-[transform,background-color,color,opacity,box-shadow] duration-100 ease-out active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant] ?? VARIANTS.primary} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
