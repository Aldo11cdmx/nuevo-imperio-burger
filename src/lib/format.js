/**
 * Formato y reglas de cobro, en un solo lugar.
 *
 * IMPORTANTE: los precios del menú ya incluyen IVA, como en la carta del
 * restaurante. Por eso el total es la suma simple y el impuesto se persiste en 0.
 * Si algún día se cambia a precios sin IVA, hay que pasar PRICES_INCLUDE_TAX a
 * false y el resto de la app sigue funcionando sin más cambios.
 */
export const PRICES_INCLUDE_TAX = true
export const TAX_RATE = 0.16

const mxn = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
})

export const formatMXN = (value) => mxn.format(value)

/**
 * Las columnas numéricas son numeric(12,2): se redondea antes de enviar.
 *
 * Se suma Number.EPSILON antes de escalar: sin eso 1.005 * 100 = 100.499999...
 * y Math.round lo lleva a 100, produciendo 1.00 en vez de 1.01. El error no es
 * grande, pero en un ticket es un centavo de más o de menos y en este negocio
 * los centavos suman.
 */
export const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100
