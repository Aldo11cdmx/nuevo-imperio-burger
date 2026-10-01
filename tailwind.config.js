/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Base cálida-violeta: el glass necesita algo que difuminar, y un negro puro
        // hace que el desenfoque se vea plano.
        ink: {
          950: '#0B0A0C',
          900: '#121015',
          800: '#17151A',
        },
        bone: {
          DEFAULT: '#F2EFEA',
          muted: '#8B8496',
          faint: '#5C5665',
        },
        saffron: {
          300: '#F7CE7E',
          400: '#F0A830',
          500: '#DE8F1E',
          600: '#B8710F',
        },
        emberred: {
          300: '#F9937E',
          400: '#F2664A',
          500: '#D6452A',
          600: '#A9331D',
        },
        jade: {
          // El 300 se añadió para el estado del mapa: sin él, `text-jade-300` no
          // generaba CSS y el importe caía al color heredado. Tailwind no avisa
          // cuando una clase de color no existe, simplemente no la compila.
          300: '#86EFC0',
          400: '#4ADE9B',
          500: '#22C07D',
        },
      },
      fontFamily: {
        // Serif con carácter para la marca: dice "artesanal" contra un shell minimalista.
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // Impresora de tickets: códigos de orden y montos.
        ticket: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      minHeight: {
        touch: '3.5rem',
      },
      boxShadow: {
        // El borde especular interior es lo que separa vidrio real de rectángulo gris.
        glass: 'inset 0 1px 0 rgba(255,255,255,0.09), 0 24px 60px -28px rgba(0,0,0,0.85)',
        'glass-sm': 'inset 0 1px 0 rgba(255,255,255,0.07), 0 10px 26px -16px rgba(0,0,0,0.8)',
        glow: '0 8px 30px -8px rgba(240,168,48,0.45)',
      },
      backgroundImage: {
        'saffron-grad': 'linear-gradient(135deg, #F7CE7E 0%, #DE8F1E 55%, #B8710F 100%)',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-6px)' },
          '40%': { transform: 'translateX(6px)' },
          '60%': { transform: 'translateX(-4px)' },
          '80%': { transform: 'translateX(4px)' },
        },
        'slide-up': {
          from: { transform: 'translateY(1.5rem)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        shake: 'shake 0.35s ease-in-out',
        'slide-up': 'slide-up 0.25s ease-out',
      },
    },
  },
  plugins: [],
}
