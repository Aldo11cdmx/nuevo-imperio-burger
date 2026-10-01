/**
 * Ticket térmico y envío por WhatsApp.
 *
 * La impresora es una END 80TEUX: papel de 80mm con 72mm IMPRIMIBLES a 203 DPI.
 * Eso da 576 dots de ancho por línea. En la fuente de 12x24 de la impresora caben
 * 42 caracteres por línea; es el número que fija LINE_WIDTH y del que depende el
 * ajuste de columnas.
 *
 * Dos decisiones que parecen detalles y no lo son:
 *
 * 1) Se imprime a 72mm, NO a 80mm. Si se pone 80mm Chrome escala el contenido para
 *    "rellenar" el papel y el texto sale borroso y desalineado. Este es el error
 *    clásico al integrar una térmica de 80mm.
 *
 * 2) Se quitan los acentos y la eñe. La fuente de la impresora es ASCII: "Camarón"
 *    puede salir como cÃ³mo o directamente roto. Un ticket que no se lee no sirve
 *    para nada, así que se sacrifica la ortografía antes que la información.
 */

/** Columnas por línea a 72mm con fuente 12x24. */
export const LINE_WIDTH = 42

/** Ancho real de impresión. El papel mide 80; esto es lo que la impresora usa. */
export const PRINT_WIDTH_MM = 72

const METHOD_LABEL = {
  cash: 'EFECTIVO',
  card: 'TARJETA',
  transfer: 'TRANSFERENCIA',
}

/**
 * Quita lo que la impresora térmica no sabe dibujar.
 *
 * NFD descompone "ó" en "o" + diacrítico combinante, y el diacrítico se elimina con
 * el rango de marcas. La eñe se reemplaza por "n" a propósito: en "Camarón" queda
 * "Camaron", que se entiende; si se quitara sin más, "niño" se leería "io".
 */
export function toPrintable(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/Ñ/g, 'N')
    .replace(/[^\x20-\x7E]/g, '')
}

/**
 * Coloca `right` pegado al margen derecho y recorta `left` si no cabe con él.
 *
 * Un nombre de producto largo sin recortar empuja el precio a la línea siguiente y
 * desarma toda la columna. Recortar el nombre es preferible: el precio siempre tiene
 * que estar donde el cajero y el cliente lo esperan.
 */
function columns(left, right) {
  const l = toPrintable(left)
  const r = toPrintable(right)
  const space = LINE_WIDTH - l.length - r.length
  if (space >= 1) return l + ' '.repeat(space) + r
  // No cabe: se le da al nombre todo menos el precio y un espacio.
  return l.slice(0, Math.max(1, LINE_WIDTH - r.length - 1)) + ' ' + r
}

const center = (text) => {
  const t = toPrintable(text).slice(0, LINE_WIDTH)
  const left = Math.floor((LINE_WIDTH - t.length) / 2)
  return ' '.repeat(Math.max(0, left)) + t
}

const rule = (char = '-') => char.repeat(LINE_WIDTH)

/** $1,234.56 sin el signo: el ticket va en pesos y el prefijo estorba al alinear. */
const money = (value) =>
  Number(value ?? 0)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const orderTypeLabel = {
  dine_in: 'EN LOCAL',
  takeout: 'PARA LLEVAR',
  platform: 'DOMICILIO',
}

/**
 * Construye el ticket como texto de ancho fijo.
 *
 * @param {object} data
 * @param {object} data.order     Orden con order_items, total, subtotal, paid_at…
 * @param {Array}  [data.payments] Pagos aplicados (para cuentas divididas)
 * @param {object} [data.business] Nombre y datos del negocio
 * @param {string} [data.staffName] Quién cobró
 */
export function buildReceiptText({ order, payments = [], business = {}, staffName = '' }) {
  const lines = []
  const name = business.name ?? 'Nuevo Imperio Burger'

  lines.push(center(name))
  if (business.address) lines.push(center(business.address))
  if (business.phone) lines.push(center(`Tel. ${business.phone}`))
  lines.push(rule('='))

  lines.push(columns(`Ticket #${order.code}`, orderTypeLabel[order.order_type] ?? 'EN LOCAL'))
  if (order.table_number !== null && order.table_number !== undefined) {
    lines.push(columns('Mesa', String(order.table_number)))
  }
  lines.push(columns('Fecha', formatStamp(order.paid_at ?? order.created_at)))
  if (staffName) lines.push(columns('Atendio', staffName))

  lines.push(rule('-'))
  lines.push(columns('CANT PRODUCTO', 'IMPORTE'))

  for (const item of order.order_items ?? []) {
    const lineTotal = Number(item.price) * Number(item.quantity)
    lines.push(columns(`${item.quantity}  ${item.product_name}`, money(lineTotal)))
    if (item.notes) lines.push('    * ' + toPrintable(item.notes).slice(0, LINE_WIDTH - 6))
  }

  lines.push(rule('-'))

  const total = Number(order.total ?? 0)
  const discount = Number(order.discount_amount ?? 0)

  if (discount > 0) {
    lines.push(columns('Subtotal', money(order.subtotal)))
    lines.push(columns('Descuento', '-' + money(discount)))
    if (order.discount_reason) {
      lines.push(toPrintable(order.discount_reason).slice(0, LINE_WIDTH))
    }
  }

  lines.push(columns('TOTAL', money(total)))
  lines.push(rule('='))

  if (payments.length > 0) {
    lines.push(center('FORMAS DE PAGO'));
    for (const payment of payments) {
      if (payment.reverted) continue
      lines.push(columns(METHOD_LABEL[payment.method] ?? payment.method, money(payment.amount)))
    }
  } else if (order.payment_method) {
    lines.push(columns(METHOD_LABEL[order.payment_method] ?? order.payment_method, money(total)))
  }

  lines.push('')
  lines.push(center('Gracias por su visita'))
  lines.push(center(toPrintable(business.tagline ?? 'Vuelve pronto')))
  lines.push('')

  return lines.join('\n')
}

/** "2026-10-01T21:30:00-06:00" -> "01/10/2026 21:30". */
function formatStamp(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** Escape para meter el texto dentro del <pre> del iframe de impresión. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Abre el diálogo de impresión con SOLO el ticket.
 *
 * Se usa un iframe oculto con el ancho real de papel en vez de imprimir la página:
 * un window.print() sobre la app imprimiría la interfaz entera. El iframe con
 * tamaño fijo es lo que hace que Chrome no recorte ni escale.
 *
 * @returns {boolean} false si el navegador bloqueó el diálogo de impresión.
 */
export function printReceipt(text) {
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = `${PRINT_WIDTH_MM}mm`
  frame.style.height = '1px'
  frame.style.border = '0'
  // opacity 0 y no display:none: un iframe oculto no tiene layout y el navegador
  // puede decidir que no hay nada que imprimir.
  frame.style.opacity = '0'
  frame.setAttribute('aria-hidden', 'true')
  document.body.appendChild(frame)

  const doc = frame.contentDocument
  doc.open()
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
      `@page { size: ${PRINT_WIDTH_MM}mm auto; margin: 0; }` +
      `html, body { width: ${PRINT_WIDTH_MM}mm; margin: 0; padding: 0; background: #fff; }` +
      `pre { margin: 0; padding: 2mm 0; font-family: 'Courier New', monospace;` +
      ` font-size: 11px; line-height: 1.35; color: #000; white-space: pre; }` +
      `</style></head><body><pre>${escapeHtml(text)}</pre></body></html>`,
  )
  doc.close()

  let printed = false
  try {
    frame.contentWindow.focus()
    frame.contentWindow.print()
    printed = true
  } catch {
    printed = false
  }

  // El iframe se retira después de que el usuario responda. Si se quita antes de
  // imprimir, Chrome aborta el trabajo.
  setTimeout(() => frame.remove(), 1000)

  return printed
}

/**
 * Enlace de WhatsApp con el ticket como mensaje.
 *
 * Limitación asumida: el texto viaja dentro de la URL, así que un mensaje largo
 * hace fallar el enlace. Por eso se corta. El cliente tiene que apretar enviar: no
 * hay forma de mandar el mensaje solo sin una cuenta de empresa.
 *
 * Un número de 10 dígitos se antepone el 52 (México): escribir "+52" a mano frente
 * al cliente es un paso extra que alguien va aSaltarse.
 */
export function whatsappReceiptUrl(phone, text) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  const normalized = digits.length === 10 ? `52${digits}` : digits
  const body = encodeURIComponent(String(text ?? '').slice(0, 1400))
  return `https://wa.me/${normalized}?text=${body}`
}

/** Versión corta del ticket para WhatsApp: sin el desglose renglón por renglón. */
export function buildWhatsAppText({ order, business = {} }) {
  const name = business.name ?? 'Nuevo Imperio Burger'
  const lines = [
    `*${name}*`,
    `Ticket #${order.code}`,
    order.table_number != null ? `Mesa ${order.table_number}` : null,
    '',
    `Total: $${money(order.total)}`,
    'Gracias por tu compra!',
  ]
  return lines.filter(Boolean).join('\n')
}