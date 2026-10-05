// Tests inline de Node para módulos sin React (format, receipt, errors).
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

// Mock DOM mínimo para printReceipt (solo en Node, no en el build real).
globalThis.document = globalThis.document || {
  body: { appendChild() {} },
  createElement(tag) {
    if (tag === 'iframe') {
      return {
        style: {},
        setAttribute() {},
        remove() {},
        contentDocument: { open() {}, write() {}, close() {} },
        contentWindow: { focus() {}, print() {}, addEventListener() {} },
      }
    }
    return {}
  },
}

const libDir = path.resolve(import.meta.dirname, '../src/lib')
const base = pathToFileURL(libDir + path.sep).href

// 1. formatMXN
const { formatMXN, round2, PRICES_INCLUDE_TAX } = await import(`${base}/format.js`)
assert.equal(formatMXN(1234.5), '$1,234.50', 'formatMXN debe dar $1,234.50')
assert.equal(formatMXN(0), '$0.00', 'formatMXN cero')
assert.equal(round2(1.005), 1.01, 'round2 1.005 -> 1.01')
assert.equal(round2(10 / 3), 3.33, 'round2 10/3 -> 3.33')
assert.equal(PRICES_INCLUDE_TAX, true, 'precios incluyen IVA')

// money() es interno, no exportado; se prueba indirectamente vía buildReceiptText.

// 2. receipt.js
const {
  buildReceiptText,
  buildKitchenText,
  toPrintable,
  LINE_WIDTH,
  KITCHEN_LINE_WIDTH,
  PRINT_WIDTH_MM,
  whatsappReceiptUrl,
  buildWhatsAppText,
} = await import(`${base}/receipt.js`)

assert.equal(toPrintable('Camarón'), 'Camaron', 'eños/acentos limpios')
assert.equal(toPrintable('Niño 100%'), 'Nino 100%', 'acentos simples limpios')
assert.equal(LINE_WIDTH, 42, 'ticket 42 columnas')
assert.equal(KITCHEN_LINE_WIDTH, 24, 'comanda 24 columnas')
assert.equal(PRINT_WIDTH_MM, 72, '72mm imprimibles')

// Receipt con pagos divididos.
const receipt = buildReceiptText({
  order: { code: '1', total: 212, subtotal: 212, order_type: 'dine_in', table_number: 5, order_items: [
    { product_name: 'Burger', quantity: 2, price: 100, modifiers: [{ name: 'Extra Queso', price: 5, quantity: 1 }] },
  ] },
  payments: [
    { method: 'cash', amount: 100, reverted: false },
    { method: 'card', amount: 112, reverted: false },
  ],
  business: { name: 'Nuevo Imperio Burger', tagline: 'Vuelve pronto' },
  staffName: 'Ana',
})
const rLines = receipt.split('\n')
assert.ok(rLines.some((l) => l.includes('TOTAL') && l.includes('212.00')), 'receipt incluye TOTAL 212.00')
assert.ok(rLines.some((l) => l.includes('EFECTIVO') && l.includes('100.00')), 'receipt incluye EFECTIVO 100.00')
assert.ok(rLines.some((l) => l.includes('TARJETA') && l.includes('112.00')), 'receipt incluye TARJETA 112.00')
assert.ok(rLines.every((l) => l.length <= LINE_WIDTH), 'receipt respeta 42 columnas')

// Comanda de cocina.
const kitchen = buildKitchenText({
  code: '42',
  tableNumber: 3,
  orderType: 'dine_in',
  items: [
    { name: 'Hamburguesa Bufalo Chicken Burger', quantity: 1, modifiers: [{ name: 'Sin cebolla', quantity: 1 }] },
  ],
})
const kLines = kitchen.split('\n')
assert.ok(kLines.some((l) => l.includes('42')), 'comanda incluye folio')
assert.ok(kLines.some((l) => l.includes('MESA 3')), 'comanda incluye mesa')
assert.ok(kLines.every((l) => l.length <= KITCHEN_LINE_WIDTH), 'comanda respeta 24 columnas')
// El nombre largo se envuelve, no se corta.
assert.ok(kLines.some((l) => l.toLowerCase().includes('chicken')), 'comanda envuelve nombre largo')

// WhatsApp URL.
const url = whatsappReceiptUrl('5512345678', 'Ticket #1 $100.00')
assert.ok(url.includes('wa.me/525512345678'), 'whatsapp 10 dígitos normaliza a 52')
assert.equal(whatsappReceiptUrl('551234567890', '').includes('wa.me/551234567890'), true, '11 dígitos no se duplica 52')

const wa = buildWhatsAppText({ order: { code: 1, total: 100 } })
assert.ok(wa.includes('Total: $100.00'), 'whatsapp text incluye total')

// 3. errors.js
const { friendlyError, isAuthError } = await import(`${base}/errors.js`)

// SQLSTATE 22P02.
let msg = friendlyError({ code: '22P02', message: 'invalid input syntax for type integer: "abc"' })
assert.equal(msg, 'Alguno de los valores capturados no tiene el formato esperado.', '22P02 -> formato')

// Net error por texto (ERR_INTERNET_DISCONNECTED).
msg = friendlyError({ message: 'net::ERR_INTERNET_DISCONNECTED' })
assert.equal(msg, 'No se pudo hablar con el servidor. Revisa la conexión e intenta de nuevo.', 'ERR net -> sin conexión')

// Mensaje nuestro (prefijo "no ").
msg = friendlyError({ message: 'No se pudo leer el turno' })
assert.equal(msg, 'No se pudo leer el turno', 'mensaje nuestro se pasa tal cual')

// Error falso / fallback.
msg = friendlyError(null, 'fallback')
assert.equal(msg, 'fallback', 'null -> fallback')
msg = friendlyError({ message: '' })
assert.equal(msg, 'No se pudo completar la operación. Intenta de nuevo.', 'message vacío -> fallback default')

// isAuthError.
assert.equal(isAuthError({ code: '42501' }), true, '42501 es auth')
assert.equal(isAuthError({ message: 'JWT expired' }), true, 'jwt es auth')
assert.equal(isAuthError({ code: '23505' }), false, 'unique violation no es auth')

// printReceipt: solo verifica que se exporta y retorna boolean con DOM mock.
const { printReceipt } = await import(`${base}/receipt.js`)
const r = printReceipt('test')
assert.equal(typeof r, 'boolean', 'printReceipt retorna boolean')

const passed = [
  'formatMXN / round2',
  'receipt: TOTAL/pagos/42col',
  'receipt: comanda 24col + wrap largo',
  'receipt: whatsapp url + texto',
  'errors: 22P02 / net::ERR / mensaje nuestro / null / fallback',
  'errors: isAuthError',
  'receipt: printReceipt iframe booleano',
]
console.log('\n✅ Tests inline pasados (' + passed.length + '):')
passed.forEach((p) => console.log('  - ' + p))
