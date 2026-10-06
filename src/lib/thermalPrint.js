import { registerPlugin } from '@capacitor/core'
import { Capacitor } from '@capacitor/core'
import { AppLauncher } from '@capacitor/app-launcher'
import { Device } from '@capacitor/device'
import { usePrinterStore } from '../store/usePrinterStore'

const ThermalPrinter = registerPlugin('ThermalPrinter')

const PRINTER_IP = '192.168.1.213'
const PRINTER_PORT = 9100

// Configuración de la API REST local de PosPrinterDriver en la tablet Fire HD 10
const DRIVER_API_URL = 'http://127.0.0.1:9100/print'
const LINK_CODE = import.meta.env.VITE_DRIVER_LINK_CODE ?? ''

const escapeHtml = (s) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const ticketHtml = (texto) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>` +
  `@page { size: 80mm auto; margin: 0; }` +
  `body { width: 80mm; margin: 0; padding: 5mm; font-family: monospace; font-size: 12px; white-space: pre-wrap; background: #fff; color: #000; }` +
  `</style></head><body><pre style="margin:0;font-family:monospace;white-space:pre-wrap;">${escapeHtml(texto)}</pre></body></html>`

/**
 * MÉTODO 1: API HTTP/REST local de PosPrinterDriver (http://127.0.0.1:9100/print)
 */
async function printViaDriverApi(text, url = DRIVER_API_URL, linkCode = LINK_CODE) {
  try {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(text)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    const base64 = btoa(binary)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        link_code: linkCode,
        text: text,
        data: base64,
      }),
    })

    if (!response.ok) {
      return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * MÉTODO 2A: Redirección directa por window.location.href (Intent URL Scheme)
 */
export function abrirPosPrinterDriver(textoTicket) {
  if (typeof window === 'undefined') return false
  try {
    if (!textoTicket) return false
    const textoCodificado = encodeURIComponent(textoTicket)
    const intentUrl = `intent://print?text=${textoCodificado}#Intent;scheme=posprinterdriver;package=com.posprinterdriver;end`
    window.location.href = intentUrl
    return true
  } catch (error) {
    console.error('Error al intentar abrir PosPrinterDriver:', error)
    return false
  }
}

/**
 * MÉTODO 2B: Usando @capacitor/app-launcher con esquema posprinterdriver://print?text=
 */
export async function abrirPosPrinterDriverNativo(textoTicket) {
  if (!textoTicket) return false
  if (!Capacitor.isNativePlatform()) {
    return abrirPosPrinterDriver(textoTicket)
  }
  try {
    const textoCodificado = encodeURIComponent(textoTicket)
    const url = `posprinterdriver://print?text=${textoCodificado}`

    const { value } = await AppLauncher.canOpenUrl({ url })

    if (value) {
      await AppLauncher.openUrl({ url })
      return true
    } else {
      await AppLauncher.openUrl({ url: 'intent://print#Intent;package=com.posprinterdriver;end' })
      return true
    }
  } catch (e) {
    console.error('Error abriendo POS Printer Driver con AppLauncher:', e)
    return abrirPosPrinterDriver(textoTicket)
  }
}

/**
 * MÉTODO 3B: Impresión TCP directa desde Electron (net.Socket en el proceso principal).
 * Solo se usa cuando la app corre empaquetada en Electron y expone window.electronAPI.
 */
async function printViaElectronTcp(text, customIp, customPort) {
  if (typeof window === 'undefined' || !window.electronAPI?.printTcp) return false
  try {
    const ip = customIp || PRINTER_IP
    const port = Number(customPort) || PRINTER_PORT

    const encoder = new TextEncoder()
    const bytes = encoder.encode(text)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
    const base64 = btoa(binary)

    const result = await window.electronAPI.printTcp({ ip, port, bytesBase64: base64 })
    if (!result || !result.success) {
      console.warn('[thermalPrint] Electron TCP falló:', result?.error || 'sin detalle')
    }
    return result?.success === true
  } catch (e) {
    console.warn('[thermalPrint] printViaElectronTcp excepción:', e.message)
    return false
  }
}

/**
 * MÉTODO 3: Socket TCP Nativo mediante Plugin de Capacitor (Directo a la IP y Puerto configurados)
 */
async function printViaNativeSocket(text, customIp, customPort) {
  if (!Capacitor.isNativePlatform()) {
    return false
  }
  try {
    const config = usePrinterStore.getState()
    const ip = customIp || config.printerIp || PRINTER_IP
    const port = customPort || config.printerPort || PRINTER_PORT

    const encoder = new TextEncoder()
    const bytes = encoder.encode(text)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    const base64 = btoa(binary)

    await ThermalPrinter.print({ ip, port, data: base64 })
    return true
  } catch (e) {
    console.warn('[thermalPrint] printViaNativeSocket falló:', e.message)
    return false
  }
}

/**
 * MÉTODO 4: Diálogo de Impresión del Sistema (PrintManager nativo / Fire OS / RawBT / window.print)
 */
export async function printViaSystem(text) {
  if (typeof window === 'undefined') return false

  if (Capacitor.isNativePlatform()) {
    let esFire = false
    try {
      const { manufacturer } = await Device.getInfo()
      esFire = /amazon/i.test(manufacturer || '')
    } catch {}

    // En Fire OS el PrintManager no tiene servicios de impresión: se omite
    if (!esFire) {
      try {
        await ThermalPrinter.printSystem({ html: ticketHtml(text) })
        return true
      } catch (e) {
        console.warn('[thermalPrint] PrintManager nativo no disponible:', e)
      }
    }

    // App puente RawBT o Intent
    try {
      const encoder = new TextEncoder()
      const bytes = encoder.encode(text)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      const b64 = btoa(binary)
      await AppLauncher.openUrl({ url: `rawbt:base64,${b64}` })
      return true
    } catch (e) {
      console.warn('[thermalPrint] rawbt intent falló:', e)
    }

    try {
      const textoCodificado = encodeURIComponent(text)
      const intentUrl = `intent://#Intent;action=android.intent.action.SEND;type=text/plain;S.android.intent.extra.TEXT=${textoCodificado};end`
      await AppLauncher.openUrl({ url: intentUrl })
      return true
    } catch (e) {
      console.warn('[thermalPrint] printViaSystem nativo intent falló:', e)
    }
  }

  // Fallback web (iframe / window.print)
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '80mm'
  frame.style.height = '1px'
  frame.style.opacity = '0'
  document.body.appendChild(frame)

  const doc = frame.contentDocument || frame.contentWindow.document
  doc.open()
  doc.write(ticketHtml(text))
  doc.close()

  try {
    frame.contentWindow.focus()
    frame.contentWindow.print()
  } catch (e) {
    window.print()
  }

  setTimeout(() => frame.remove(), 10000)
  return true
}

/**
 * Función principal exportable con Estrategia Fallback priorizando Socket TCP directo.
 * @param {string} textoTicket - Texto formateado del ticket.
 * @param {'auto'|'native'|'driver'|'app-launcher'|'intent'|'system'} [metodo='auto'] - Método a utilizar.
 * @returns {Promise<boolean>}
 */
export async function imprimirTicket(textoTicket, metodo = 'auto') {
  if (!textoTicket) return false

  const ESC_INIT = '\x1b\x40'
  const ESC_CUT = '\x1d\x56\x01'
  const formattedText = `${ESC_INIT}${String(textoTicket).trim()}\n\n\n\n${ESC_CUT}`

  if (metodo === 'native') {
    return await printViaNativeSocket(formattedText)
  }
  if (metodo === 'driver') {
    return await printViaDriverApi(formattedText)
  }
  if (metodo === 'app-launcher') {
    return await abrirPosPrinterDriverNativo(formattedText)
  }
  if (metodo === 'intent') {
    return abrirPosPrinterDriver(formattedText)
  }
  if (metodo === 'system') {
    return await printViaSystem(formattedText)
  }

  // Estrategia 'auto': Electron TCP primero (si está disponible), luego socket nativo, luego driver, luego system
  const successElectron = await printViaElectronTcp(formattedText)
  if (successElectron) return true

  const successNative = await printViaNativeSocket(formattedText)
  if (successNative) return true

  const successDriver = await printViaDriverApi(formattedText)
  if (successDriver) return true

  return await printViaSystem(formattedText)
}
