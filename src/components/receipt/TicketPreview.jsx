import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, MessageCircle, Printer, X } from 'lucide-react'
import TouchButton from '../TouchButton'
import { INPUT } from '../admin/fields'
import {
  buildReceiptText,
  buildWhatsAppText,
  printReceipt,
  whatsappReceiptUrl,
} from '../../lib/receipt'
import { usePaymentStore } from '../../store/usePaymentStore'

/**
 * Vista del ticket antes de imprimir.
 *
 * El cajero revisa aquí y decide entre imprimir o mandar por WhatsApp. La
 * previsualización usa las MISMAS 42 columnas que la impresora va a usar, para que
 * lo que se ve sea lo que sale: maquetar a 80mm en pantalla y mandar 72mm a la
 * impresora daría un ticket distinto al que el cajero acaba de aprobar.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTE COMPONENTE SE PORTA A `document.body` CON UN PORTAL
 * -----------------------------------------------------------------------------
 * Va en un overlay `fixed inset-0`, y un `fixed` NO siempre significa "toda la
 * pantalla". Se ancla al viewport salvo que algún ancestro tenga `transform`,
 * `filter`, `backdrop-filter`, `perspective` o `will-change` de esas: en ese caso
 * ese ancestro pasa a ser su bloque contenedor.
 *
 * Y este componente se abre DENTRO de otro modal —el de cobro y división— cuyo panel
 * usa `backdrop-blur-2xl`. Eso lo convertía en el bloque contenedor del `fixed`, así
 * que la vista previa quedaba encerrada en una tarjeta de `max-w-lg` metida dentro
 * del `max-h-[92dvh]` de aquella, y el `overflow-y-auto` de ambas se sumaba en dos
 * scrolls anidados. El resultado era una rendija con dos o tres renglones y una
 * barra de scroll dentro de otra barra de scroll.
 *
 * El portal lo saca de ahí: vive en `body`, sin ancestros que lo reencuadren, y su
 * `inset-0` es literalmente la pantalla. Importa también para el toque: el overlay
 * ya no queda dentro de un padre que captura el scroll ni compite por el `z-50` con
 * el modal que lo abrió.
 */
export default function TicketPreview({
  order,
  business,
  staffName,
  onClose,
  payments: providedPayments,
  loadingPayments = false,
}) {
  const listPayments = usePaymentStore((state) => state.listPayments)
  const [fetched, setFetched] = useState([])
  const [loading, setLoading] = useState(true)
  const [phone, setPhone] = useState('')
  const [showPhone, setShowPhone] = useState(false)
  const [printed, setPrinted] = useState(false)

  /**
   * Los pagos pueden venir dados o se piden aquí.
   *
   * El historial de Administración abre tickets con el PIN de ADMIN y
   * list_order_payments se resuelve con auth_employee: el PIN del cajero que inició
   * sesión no serviría si quien está mirando es otro. Pasándolos ya cargados, cada
   * pantalla usa el PIN que sí tiene.
   *
   * Se piden aparte del order porque la orden no los trae embebidos: sin ellos, una
   * cuenta dividida imprimiría un total sin explicar en qué se pagó.
   */
  const payments = providedPayments ?? fetched
  const busy = providedPayments ? loadingPayments : loading

  useEffect(() => {
    if (providedPayments) return undefined

    // `alive` evita(setState) en un componente que ya se cerró: la promesa puede
    // resolverse después del cierre del diálogo y React ya no tendría a quién avisar.
    let alive = true
    setLoading(true)
    listPayments(order.id).then((rows) => {
      if (!alive) return
      setFetched(rows)
      setLoading(false)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, providedPayments])

  const text = buildReceiptText({ order, payments, business, staffName })
  const waText = buildWhatsAppText({ order, business })

  const handlePrint = () => {
    printReceipt(text)
    setPrinted(true)
  }

  const handleWhatsApp = () => {
    window.open(whatsappReceiptUrl(phone, waText), '_blank', 'noopener')
    setPrinted(true)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-ink-900/95 px-4 py-3">
        <div>
          <p className="font-ticket text-lg font-bold text-saffron-400">Ticket #{order.code}</p>
          <p className="text-xs text-bone-muted">72mm · listo para imprimir</p>
        </div>
        <TouchButton variant="ghost" onClick={onClose} aria-label="Cerrar" className="px-3">
          <X size={20} />
        </TouchButton>
      </header>

      <main className="flex-1 overflow-y-auto overscroll-contain p-4">
        {/*
          La columna mantiene 72mm de ancho REAL y el `zoom` va en el envoltorio.

          Los factores van como PROPIEDAD ARBITRARIA (`[zoom:1.1]`), no como
          `zoom-[1.1]`. Un valor arbitrario a secas solo funciona sobre utilidades que
          existen en Tailwind —de ahí salen `text-[11px]` o `w-[72mm]`—, y `zoom` no es
          una de ellas en la versión 3. Con la forma equivocada la clase se descarta en
          silencio al compilar: no hay error, ni aviso, ni nada en el CSS de `dist`, y
          el papel se ve igual de pequeño que antes. Si se tocan estos factores,
          conviene confirmar que aparece `zoom:` en el CSS compilado.

          Podría haber subido solo el `font-size`, pero eso no es lo mismo: `w-[72mm]` con
          letra más grande deja de alcanzar para las 42 columnas, aparecen barras
          horizontales y el cajero tendría que arrastrar el papel de lado para leerlo.
          Con `zoom`, los 72mm y los 11px se escalan juntos y la proporción respecto a la
          impresora no cambia: sigue siendo el mismo ticket, más grande.

          Y `zoom` y no `transform: scale()` por una razón concreta: `transform` no
          reserva el espacio escalado en el layout, así que el papel se saldría del
          `overflow-y-auto` y el scroll mediría la altura sin escalar, dejando la última
          línea cortada e inalcanzable. `zoom` sí crece en el layout, y la barra de
          scroll mide lo que se ve de verdad.

          Este ajuste es SOLO de pantalla. Lo que sale por la impresora lo arma
          `printReceipt`, que escribe su propio documento en un iframe con `@page` de
          72mm y su propia regla de `font-size`: nada de lo que hay aquí llega a esa
          hoja. La fidelidad se conserva porque las 42 columnas son las mismas en ambos
          lados, no porque ambas pantallas midan lo mismo.
        */}
        <div className="mx-auto w-[72mm] [zoom:1] sm:[zoom:1.1] md:[zoom:1.25] lg:[zoom:1.4]">
          <pre className="overflow-x-auto bg-white p-2 font-mono text-[11px] leading-[1.35] whitespace-pre text-black">
            {text}
          </pre>
        </div>
      </main>

      <footer className="space-y-2 border-t border-white/10 bg-ink-900/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {showPhone && (
          <div className="flex gap-2">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 13))}
              placeholder="WhatsApp del cliente"
              inputMode="tel"
              autoFocus
              className={`${INPUT} text-sm`}
            />
            <TouchButton
              className="shrink-0"
              disabled={phone.length < 10}
              onClick={handleWhatsApp}
            >
              <MessageCircle size={17} /> Enviar
            </TouchButton>
          </div>
        )}

        <div className="flex gap-2">
          <TouchButton className="flex-1" onClick={handlePrint} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" size={18} /> : <Printer size={18} />}
            Imprimir
          </TouchButton>
          {!showPhone ? (
            <TouchButton
              variant="secondary"
              className="flex-1"
              onClick={() => setShowPhone(true)}
              disabled={busy}
            >
              <MessageCircle size={18} /> WhatsApp
            </TouchButton>
          ) : (
            <TouchButton
              variant="secondary"
              className="shrink-0 px-4"
              onClick={() => setShowPhone(false)}
            >
              Cancelar
            </TouchButton>
          )}
        </div>

        {printed && (
          <p className="text-center text-xs text-jade-300">
            {busy ? 'Cargando pagos…' : 'Revisa que haya salido completo antes de entregarlo.'}
          </p>
        )}
      </footer>
    </div>,
    document.body,
  )
}