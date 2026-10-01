/**
 * Ticket térmico, comanda de cocina y envío por WhatsApp.
 *
 * La impresora es una END 80TEUX: papel de 80mm con 72mm IMPRIMIBLES a 203 DPI.
 * Eso da 576 dots de ancho por línea. En la fuente de 12x24 de la impresora caben
 * 42 caracteres por línea; es el número que fija LINE_WIDTH y del que depende el
 * ajuste de columnas.
 *
 * Cuatro decisiones que parecen detalles y no lo son:
 *
 * 1) Se imprime a 72mm, NO a 80mm. Si se pone 80mm Chrome escala el contenido para
 *    "rellenar" el papel y el texto sale borroso y desalineado. Este es el error
 *    clásico al integrar una térmica de 80mm.
 *
 * 2) Se quitan los acentos y la eñe. La fuente de la impresora es ASCII: "Camarón"
 *    puede salir como cÃ³mo o directamente roto. Un ticket que no se lee no sirve
 *    para nada, así que se sacrifica la ortografía antes que la información.
 *
 * 3) La comanda de cocina NO lleva precios. Se imprime en fuente doble (24 columnas,
 *    18px) porque a la plancha, a dos metros y con ruido, un renglón a 11px no se
 *    lee. Prácticamente todo el ancho del rollo se gasta en producto y notas.
 *
 * 4) La comanda ENVUELVE los nombres largos y el ticket de caja los recorta. Es
 *    deliberado y es la diferencia más importante entre ambas: en el ticket de caja
 *    el precio tiene que quedar donde el cajero y el cliente lo esperan aunque el
 *    nombre se corte, pero un producto mal cortado en cocina se cocina mal.
 */

/**
 * Hay DOS plantillas y por eso hay DOS anchos.
 *
 * - LINE_WIDTH (42 columnas, 11px) es el ticket de caja: información densa, columnas
 *   apretadas, precio pegado a la derecha.
 * - KITCHEN_LINE_WIDTH (24 columnas, 18px negrita) es la comanda: lo mismo de papel
 *   pero en fuente doble, que es lo que se usa en cocina para que se lea a un metro.
 *
 * El papel no cambia en ninguno de los dos casos: mismo rollo de 80mm, mismos 72mm
 * imprimibles. Lo que cambia es cuántas columnas caben y, con ellas, el tamaño real
 * de cada letra.
 */
export const LINE_WIDTH = 42
export const KITCHEN_LINE_WIDTH = 24

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
 *
 * El ancho va por parámetro porque la comanda de cocina usa 24 columnas y el ticket
 * de caja 42. Por omisión quedan 42, que es lo que espera el ticket de caja.
 */
function columns(left, right, width = LINE_WIDTH) {
  const l = toPrintable(left)
  const r = toPrintable(right)
  const space = width - l.length - r.length
  if (space >= 1) return l + ' '.repeat(space) + r
  // No cabe: se le da al nombre todo menos el precio y un espacio.
  return l.slice(0, Math.max(1, width - r.length - 1)) + ' ' + r
}

const center = (text, width = LINE_WIDTH) => {
  const t = toPrintable(text).slice(0, width)
  const left = Math.floor((width - t.length) / 2)
  return ' '.repeat(Math.max(0, left)) + t
}

const rule = (char = '-', width = LINE_WIDTH) => char.repeat(width)

/**
 * Parte un texto en renglones que quepan, en vez de cortarlo.
 *
 * Se corta en los espacios y se respeta `indent` en cada renglón. Si una palabra
 * sola no cabe (una referencia larga, un nombre sin espacios) se parte a la fuerza:
 * un renglón sin fin rompería el ancho y desalinearía todo lo que sigue.
 *
 * @param {string} text
 * @param {number} width  Columnas totales del renglón, sangría incluida.
 * @param {string} [indent]  Sangría de cada renglón, ya en espacios.
 * @returns {string[]} Renglones, sin salto de línea al final.
 */
function wrap(text, width, indent = '') {
  const words = toPrintable(text).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const limit = Math.max(1, width - indent.length)
  const lines = []
  let current = ''

  for (let word of words) {
    // La palabra no cabe en lo que queda del renglón, así que pasa al siguiente.
    // Solo se parte a la fuerza cuando ella sola excede el ancho completo, que es el
    // caso de los nombres sin espacios: partir "Hamburguesa Bufalo Chicken Burger"
    // entre "Ch" y "icken" porque cupieron dos letras más sería peor que un renglón
    // largo.
    if (current && current.length + 1 + word.length > limit) {
      lines.push(indent + current)
      current = ''
    }

    while (word.length > limit) {
      lines.push(indent + word.slice(0, limit))
      word = word.slice(limit)
    }

    current = current ? `${current} ${word}` : word
  }

  if (current) lines.push(indent + current)
  return lines
}

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

const platformLabel = {
  uber: 'UBER',
  rappi: 'RAPPI',
  didi: 'DIDI',
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
/**
 * Precio de los extras de un renglón, ya multiplicado por la cantidad.
 *
 * @param {object} item Renglón con `modifiers: [{ name, price, quantity }]`.
 * @param {number} quantity Cantidad del renglón.
 * @returns {number}
 */
function modifiersTotal(item, quantity) {
  return (item.modifiers ?? []).reduce(
    (sum, mod) => sum + Number(mod.price ?? 0) * Number(mod.quantity ?? 1) * Number(quantity ?? 1),
    0,
  )
}

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
    const quantity = Number(item.quantity)
    // El importe del renglón incluye los extras. Si se calculara solo con el precio del
    // producto, la suma de los renglones NO cuadraría con el TOTAL de abajo, porque el
    // total viene de orders.total y ese sí los incluye. Un ticket que no suma es peor
    // que un ticket feo.
    const lineTotal = Number(item.price) * quantity + modifiersTotal(item, quantity)
    lines.push(columns(`${item.quantity}  ${item.product_name}`, money(lineTotal)))

    // Los extras salen con su precio y alineados a la derecha, que es donde el cliente
    // los va a buscar. Con muchos extras de golpe el ticket se alarga, pero ocultarlos
    // haría que el total pareciera un error de cálculo.
    for (const mod of item.modifiers ?? []) {
      const modTotal = Number(mod.price ?? 0) * Number(mod.quantity ?? 1) * quantity
      lines.push(columns(`    + ${mod.quantity > 1 ? `${mod.quantity}x ` : ''}${mod.name}`, money(modTotal)))
    }

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

/**
 * Construye la COMANDA DE COCINA.
 *
 * A diferencia del ticket de caja, aquí NO hay precios, NO hay subtotal y NO hay
 * total. En cocina el dinero no sirve de nada y sí estorba: cada renglón que no
 * muestra un precio es un renglón que puede dedicarse al producto y a la nota.
 *
 * Va en 24 columnas con fuente doble (18px) porque se lee a distancia y con ruido.
 *
 * Envuelve los nombres en vez de recortarlos. A 24 columnas "Hamburguesa Búfalo
 * Chicken Burger" ocupa tres renglones, y eso es justo lo que se necesita: un
 * producto truncado se cocina mal, y en cocina equivocarse cuesta comida perdida.
 *
 * `kind` distingue los dos orígenes:
 *   - 'new'   la orden se acaba de crear: va todo.
 *   - 'addon' se agregaron productos a una cuenta ya abierta: va SOLO lo nuevo, para
 *     que el cocinero no rehaga lo que ya tenía listo.
 *
 * @param {object} data
 * @param {string} data.code        Folio de la orden.
 * @param {string} [data.kind]      'new' (por omisión) o 'addon'.
 * @param {number|null} [data.tableNumber]
 * @param {string} [data.orderType]
 * @param {string} [data.platform]
 * @param {string} [data.at]        ISO de la hora; sin esto cae en el reloj actual.
 * @param {Array}  data.items       [{ name, quantity, notes, modifiers }]. Sin precio: no se usa.
 */
export function buildKitchenText({
  code,
  kind = 'new',
  tableNumber = null,
  orderType = 'dine_in',
  platform = null,
  at,
  items = [],
}) {
  const width = KITCHEN_LINE_WIDTH
  const lines = []
  const isAddon = kind === 'addon'

  lines.push(center(isAddon ? 'COMANDA - AGREGADO' : 'COMANDA DE COCINA', width))
  lines.push(rule('=', width))

  // La hora pegada a la derecha es lo que primero se busca en una comanda: lleva el
  // mismo peso visual que el folio, y de paso ordena el renglón sin gastar columnas.
  lines.push(columns(`#${code}`, formatTime(at), width))

  // La plataforma califica al tipo de pedido y no ocupa un renglón aparte: si es
  // domicilio por Rappi, "DOMICILIO RAPPI" es un solo dato que ya estaba en el tipo.
  const typeText = orderTypeLabel[orderType] ?? 'EN LOCAL'
  const withPlatform = platform ? `${typeText} ${platformLabel[platform] ?? ''}`.trim() : typeText
  const left = tableNumber === null || tableNumber === undefined ? '' : `MESA ${tableNumber}`
  lines.push(columns(left, withPlatform, width))

  lines.push(rule('-', width))

  for (const item of items) {
    const quantity = Number(item.quantity ?? 1)
    const nameLines = wrap(item.name, width, '   ')
    if (nameLines.length === 0) continue

    // La cantidad se pone solo en el primer renglón: repetirla arriba de cada línea
    // del nombre confunde más de lo que ayuda cuando el nombre se parte.
    lines.push(`${quantity}x ${nameLines[0].slice(3)}`)
    lines.push(...nameLines.slice(1))

    // Los extras van con "+" y SIN precio. El precio existe para cobrar y aquí no se
    // cobra nada; lo que importa es que quien cocina sepa que hay queso y cuánta carne
    // toca. Igual que la nota, van envueltos y sangrados.
    for (const mod of item.modifiers ?? []) {
      const modCount = Number(mod.quantity ?? 1)
      lines.push(...wrap(`+ ${modCount > 1 ? `${modCount}x ` : ''}${mod.name}`, width, '   '))
    }

    if (item.notes) lines.push(...wrap(item.notes, width, '   * '))
  }

  lines.push(rule('-', width))

  return lines.join('\n')
}

/** "2026-10-01T21:30:00-06:00" -> "21:30". En la comanda la hora basta. */
function formatTime(iso) {
  const date = iso ? new Date(iso) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
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
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.fontSize] 11 para el ticket de caja, 18 para la comanda.
 * @param {boolean} [options.bold]   La comanda va en negrita por legibilidad.
 * @returns {boolean} false si el navegador bloqueó el diálogo de impresión.
 */
export function printReceipt(text, { fontSize = 11, bold = false } = {}) {
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
      ` font-size: ${fontSize}px; font-weight: ${bold ? 700 : 400};` +
      ` line-height: ${bold ? 1.25 : 1.35}; color: #000; white-space: pre; }` +
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

  // El iframe NO se puede quitar a ciegas. print() no es bloqueante: vuelve en
  // cuanto el diálogo abre, así que un setTimeout corto lo retira mientras el
  // usuario sigue devant el diálogo de Android Print Service, y Chrome aborta el
  // trabajo a media impresión.
  //
  // Se espera al evento afterprint y se deja un respaldo generoso para el caso de
  // que el navegador no lo dispare nunca.
  const cleanup = () => frame.remove()
  frame.contentWindow.addEventListener('afterprint', cleanup, { once: true })
  setTimeout(cleanup, 60000)

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