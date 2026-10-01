/**
 * Atajos de nota de cocina.
 *
 * NO son un grupo de modificadores. Son texto que se inserta en el campo de nota que
 * ya existía, y a propósito: "sin cebolla" no tiene precio y no necesita catalogo,
 * nombre en el ticket ni nada en la base. Meterlo como modificador sin costo
 * duplicaría el mecanismo para lo mismo y haría la captura más lenta.
 *
 * Se escriben sin acentos porque la impresora térmica es ASCII y los quita todos:
 * si el mesero escribe "sin cebolla" a mano el sistema lo normaliza igual, y aquí se
 * ahorra la pulsación de la tilde y el signo de la eñe.
 */
export const QUICK_NOTES = [
  'Sin cebolla',
  'Sin jitomate',
  'Sin lechuga',
  'Sin queso',
  'Término medio',
  'Bien cocido',
  'Salsa aparte',
  'Sin picante',
]