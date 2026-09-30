const VARIANTS = {
  // Sólido en vez de degradado: el estado active tiene que verse de verdad al
  // aplastar el botón en pantalla táctil.
  primary: 'bg-saffron-400 text-ink-950 shadow-glow active:bg-saffron-500',
  secondary: 'bg-white/[0.07] text-bone border border-white/10 active:bg-white/[0.13]',
  danger: 'bg-emberred-500 text-bone active:bg-emberred-600',
  ghost: 'bg-transparent text-bone-muted active:bg-white/[0.07]',
}

export default function TouchButton({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  className = '',
  type = 'button',
  ...rest
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      // Se conservan las clases base tal cual: las variantes de tamaño se sobrescriben
      // desde className en cada vista.
      className={`inline-flex min-h-touch items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold transition-[transform,background-color,color,opacity,box-shadow] duration-100 ease-out active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant] ?? VARIANTS.primary} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
