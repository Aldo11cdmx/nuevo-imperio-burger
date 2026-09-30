const VARIANTS = {
  primary: 'bg-ember-600 active:bg-ember-700 text-white',
  secondary: 'bg-carbon-700 active:bg-carbon-800 text-ash-100 border border-carbon-700',
  danger: 'bg-red-600 active:bg-red-700 text-white',
  ghost: 'bg-transparent active:bg-carbon-800 text-ash-300',
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
      className={`inline-flex min-h-touch items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition-[transform,background-color,color,opacity] duration-100 ease-out active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant] ?? VARIANTS.primary} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
