/**
 * Taxonomía visual de la carta.
 *
 * Las categorías viven en la base (columna `category` de `products`), porque el admin
 * tiene que poder escribirlas. Lo que NO va en la base son las clases Tailwind del
 * degradado: meter CSS en una columna de texto traería problemas de escapado y de
 * detección por parte del generador, así que la asociación id -> presentacion se
 * mantiene aquí, que es donde el tema ya tiene su casa.
 *
 * Una categoría escrita a mano por el admin que no esté en este mapa no rompe nada:
 * cae en FALLBACK y el POS la muestra igual, con su identificador en mayúsculas.
 */

/** Orden de aparición de las secciones en la carta. */
export const CATEGORY_ORDER = [
  'hamburguesas',
  'burros',
  'snacks',
  'antojitos',
  'tacos',
  'combos',
  'bebidas',
  'ninos',
  'extras',
]

const PRESENTATION = {
  hamburguesas: { label: 'Hamburguesas Gigantes', gradient: 'from-emberred-500 via-emberred-600 to-ink-900' },
  burros: { label: 'Mega Burros', gradient: 'from-saffron-500 via-emberred-500 to-ink-900' },
  snacks: { label: 'Snacks', gradient: 'from-jade-500 via-jade-400 to-ink-900' },
  antojitos: { label: 'Antojitos Mexicanos', gradient: 'from-saffron-600 via-saffron-500 to-ink-900' },
  tacos: { label: 'Tacos', gradient: 'from-emberred-400 via-saffron-500 to-ink-900' },
  combos: { label: 'Combos & Promociones', gradient: 'from-saffron-400 via-saffron-300 to-ink-900' },
  bebidas: { label: 'Bebidas', gradient: 'from-jade-400 via-jade-500 to-ink-900' },
  ninos: { label: 'Niños', gradient: 'from-jade-500 via-saffron-300 to-ink-900' },
  extras: { label: 'Extras', gradient: 'from-bone-faint via-bone-muted to-ink-900' },
}

const FALLBACK = { label: '', gradient: 'from-bone-faint via-bone-muted to-ink-900' }

const humanize = (id) => id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ')

export const getCategory = (id) => PRESENTATION[id] ?? { ...FALLBACK, label: humanize(id ?? '') }

export const getGradient = (id) => getCategory(id).gradient
