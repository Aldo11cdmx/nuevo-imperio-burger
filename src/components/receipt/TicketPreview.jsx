import { useEffect, useState } from 'react'
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

  return (
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

      <main className="flex-1 overflow-y-auto p-4">
        {/* 72mm reales: el mismo ancho que sale por la impresora. */}
        <pre className="mx-auto w-[72mm] overflow-x-auto bg-white p-2 font-mono text-[11px] leading-[1.35] whitespace-pre text-black">
          {text}
        </pre>
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
    </div>
  )
}