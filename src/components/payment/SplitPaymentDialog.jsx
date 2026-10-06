import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Printer, Users, UtensilsCrossed } from 'lucide-react'
import TouchButton from '../TouchButton'
import { INPUT } from '../admin/fields'
import TicketPreview from '../receipt/TicketPreview'
import { formatMXN, round2 } from '../../lib/format'
import { buildReceiptText, printReceipt } from '../../lib/receipt'
import { imprimirTicket } from '../../lib/thermalPrint'
import { useAuthStore } from '../../store/useAuthStore'
import { PAYMENT_LABELS, usePaymentStore } from '../../store/usePaymentStore'
import { CONNECTION_EVENTS } from '../../store/useConnectionStore'
import { playBeep, playError, playSuccess } from '../../lib/audio'

/**
 * Datos del negocio que salen impresos en el ticket.
 *
 * Se cambian aquí y no en una tabla: el ticket es el único lugar donde se muestran,
 * y meterlos en la base agregaría una pantalla de configuración por un dato que no
 * cambia solo.
 */
const BUSINESS = {
  name: 'Nuevo Imperio Burger',
  tagline: 'Vuelve pronto',
}

const METHOD_OPTIONS = [
  { id: 'cash', label: 'Efectivo', emoji: '💵' },
  { id: 'card', label: 'Tarjeta', emoji: '💳' },
  { id: 'transfer', label: 'Transferencia', emoji: '📱' },
]

/**
 * Diálogo de cobro con división de cuenta.
 *
 * Tres pestañas cubren los casos reales de una barra:
 *   · Una cuenta — el camino simple: una persona, un método, se paga todo.
 *   · Entre N    — la cuenta se parte en partes iguales. El reparto lo calcula
 *                  split_amount en la base y cada persona puede pagar con el método
 *                  que quiera; cada cobro es un pago independiente.
 *   · Por consumo — cada quien paga lo que pidió, marcando las líneas del ticket.
 *
 * La orden se liquida sola cuando lo pagado cubre el total: el servidor pasa la
 * orden a completed al llegar a total - 0.01 y la UI deja de aceptar cobros.
 */
export default function SplitPaymentDialog({ order, onClose, onPaid, defaultTab = 'single' }) {
  const [tab, setTab] = useState(defaultTab)

  // ---- estado de la cuenta ------------------------------------------------------
  // El diálogo NO confía en order.total/order.paid_total: la orden sale del tablero
  // en cuanto se liquida y el objeto que llegó por prop queda congelado con el
  // paid_total anterior. Preguntarlo al servidor tras cada cobro es lo único que
  // mantiene el "faltan $X" honesto mientras el cajero cobra tres personas seguidas.
  const total = Number(order.total ?? 0)
  const [paid, setPaid] = useState(Number(order.paid_total ?? 0))
  const remaining = Math.max(0, round2(total - paid))
  const isSettled = remaining <= 0.01 || order.status === 'completed'

  const refreshStatus = async () => {
    const next = await usePaymentStore.getState().fetchPaymentStatus(order.id)
    if (next) setPaid(next.paid)
    return next
  }

  // Cierra el diálogo con el botón físico de "atrás" de la tablet.
  useEffect(() => {
    if (!onClose) return undefined
    const onBack = (e) => {
      e.preventDefault()
      onClose()
    }
    window.addEventListener(CONNECTION_EVENTS.BACK, onBack)
    return () => window.removeEventListener(CONNECTION_EVENTS.BACK, onBack)
  }, [onClose])

  useEffect(() => {
    refreshStatus()
    // Solo al abrir: después el estado se refresca tras cada cobro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id])

  // ---- "una cuenta" -------------------------------------------------------------
  const [singleMethod, setSingleMethod] = useState('cash')
  const [singleAmount, setSingleAmount] = useState('')

  // ---- "entre N" ----------------------------------------------------------------
  const [parts, setParts] = useState(2)
  const [splitPreview, setSplitPreview] = useState(null)
  const [splitMethods, setSplitMethods] = useState({})
  const [splitBusy, setSplitBusy] = useState(false)
  const [splitDone, setSplitDone] = useState([])

  // ---- "por consumo" ------------------------------------------------------------
  const [selected, setSelected] = useState(() => new Set())
  const [itemMethods, setItemMethods] = useState({})
  const [itemBusy, setItemBusy] = useState(false)
  const [itemDone, setItemDone] = useState([])
  const [ticketOpen, setTicketOpen] = useState(false)

  const staffName = useAuthStore((state) => state.employee?.full_name ?? '')

  const addPayment = usePaymentStore((state) => state.addPayment)
  const previewSplit = usePaymentStore((state) => state.previewSplit)
  const paymentError = usePaymentStore((state) => state.error)
  const clearPaymentError = usePaymentStore((state) => state.clearError)

  // Limpia el error acumulado al abrir el diálogo.
  useEffect(() => clearPaymentError(), [clearPaymentError])

  // La cuenta que se reparte es lo que FALTA, no el total: si ya entró dinero, las
  // partes tienen que sumar el resto.
  //
  // El reparto se CONGELA con los deps [tab, parts] a propósito. Si se recalculara
  // en cada cambio de `remaining`, al cobrar la persona 1 el preview se reharía sobre
  // el saldo restante y los índices ya cobrados quedarían apuntando a montos
  // equivocados. Solo se rehace cuando el usuario abre la pestaña o cambia el número
  // de personas: las dos son acciones suyas, y en ese momento el saldo es el real.
  const remainingRef = useRef(remaining)
  remainingRef.current = remaining

  useEffect(() => {
    let cancelled = false
    if (tab !== 'parts' || parts < 1 || remainingRef.current <= 0) {
      setSplitPreview(null)
      return undefined
    }
    previewSplit(remainingRef.current, parts).then((preview) => {
      if (!cancelled) setSplitPreview(preview)
    })
    return () => {
      cancelled = true
    }
  }, [tab, parts, previewSplit])

  // Al cambiar el número de personas se reinician los métodos asignados: los métodos
  // guardados eran de la repartición anterior y ahora no corresponden a ningún pago.
  useEffect(() => {
    setSplitMethods({})
    setSplitDone([])
  }, [parts])

  const toggleItem = (itemId) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const setMethodFor = (setter, key, method) => setter((prev) => ({ ...prev, [key]: method }))

  const items = order.order_items ?? []
  const selectedItems = items.filter((item) => selected.has(item.id))

  // ---- cobro --------------------------------------------------------------------

  const chargeAll = async (method, amount) => {
    if (isSettled) return false
    const ok = await addPayment({ orderId: order.id, method, amount })
    await refreshStatus()
    if (ok) {
      playSuccess()
      try {
        const text = buildReceiptText({
          order,
          payments: [{ method, amount }],
          business: BUSINESS,
          staffName,
        })
        imprimirTicket(text, 'auto').catch((e) => {
          console.warn('Background print error:', e)
        })
      } catch (e) {
        console.warn('Auto print receipt error:', e)
      }
      onPaid?.(ok)
    } else {
      playError()
    }
    return ok
  }

  const handleSingle = async () => {
    const amount = singleAmount.trim() === '' ? remaining : Number(singleAmount)
    await chargeAll(singleMethod, round2(amount))
  }

  const handleSplit = async () => {
    if (!splitPreview) return
    setSplitBusy(true)
    // Se lleva el conteo en una variable local: splitDone del render es un snapshot
    // viejo dentro del ciclo y compararlo tras cada cobro seguiría viendo el estado
    // inicial, haciendo que el botón nunca se actualizara.
    let paid = splitDone.length
    try {
      for (let i = 0; i < splitPreview.length; i++) {
        if (splitDone.includes(i)) continue
        const method = splitMethods[i] ?? 'cash'
        const ok = await addPayment({ orderId: order.id, method, amount: splitPreview[i] })
        await refreshStatus()
        if (!ok) break
        paid += 1
        setSplitDone((prev) => [...prev, i])
      }
    } finally {
      setSplitBusy(false)
    }
    if (paid >= splitPreview.length) onPaid?.({ all: true })
  }

  const handleConsumption = async () => {
    if (selectedItems.length === 0 || itemBusy) return
    setItemBusy(true)
    try {
      const subtotal = selectedItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
      // Escala proporcional sobre el TOTAL, no sobre el subtotal de la orden: así el
      // descuento (si lo hay) se reparte proporcionalmente entre las cuentas y la suma
      // de las partes nunca excede lo que falta.
      const amount = total > 0 ? round2((subtotal / total) * remaining) : 0
      if (amount > 0) {
        // Un solo método para el bloque seleccionado; cada bloque es un pago.
        const method = itemMethods.__bulk ?? 'cash'
        const ok = await addPayment({ orderId: order.id, method, amount })
        await refreshStatus()
        if (ok) {
          setItemDone((prev) => [...prev, ...selected])
          setSelected(new Set())
          onPaid?.({ status: 'partial' })
        }
      }
    } finally {
      setItemBusy(false)
    }
  }

  // ---- resumen ------------------------------------------------------------------

  const splitSum = splitPreview ? round2(splitPreview.reduce((a, b) => a + b, 0)) : 0
  const canChargeSingle = !isSettled && remaining > 0
  const allSplitPaid = splitPreview && splitPreview.every((_, i) => splitDone.includes(i))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-ink-900/95 shadow-glass backdrop-blur-2xl sm:rounded-3xl">
        {/* cabecera */}
        <header className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <p className="font-ticket text-xl font-bold text-saffron-400">#{order.code}</p>
            <p className="text-xs text-bone-muted">
              {order.customer_name ?? 'Mostrador'}
              {order.table_number ? ` · Mesa ${order.table_number}` : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-bone-muted">Falta</p>
            <p className="font-ticket text-xl font-bold text-bone">{formatMXN(remaining)}</p>
          </div>
          <TouchButton variant="ghost" onClick={onClose} className="shrink-0 px-3 text-sm" aria-label="Cerrar">
            ✕
          </TouchButton>
        </header>

        {/* cuerpo */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {ticketOpen ? (
            <TicketPreview
              order={order}
              business={BUSINESS}
              staffName={staffName}
              onClose={() => setTicketOpen(false)}
            />
          ) : isSettled ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <CheckCircle2 size={40} className="text-jade-400" />
              <p className="text-base font-semibold">Cuenta liquidada</p>
              <p className="text-sm text-bone-muted">Se cobró {formatMXN(total)}.</p>
              <TouchButton
                className="mt-2"
                onClick={() => {
                  setTicketOpen(true)
                }}
              >
                <Printer size={18} /> Ver ticket
              </TouchButton>
            </div>
          ) : (
            <>
              {/* pestañas */}
              <div className="mb-4 grid grid-cols-3 gap-1.5 rounded-2xl bg-white/[0.05] p-1">
                {[
                  { id: 'single', label: 'Una cuenta' },
                  { id: 'parts', label: `Entre ${parts}` },
                  { id: 'items', label: 'Por consumo' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`rounded-xl px-2 py-2 text-sm font-semibold transition-colors ${
                      tab === t.id ? 'bg-saffron-400 text-ink-950' : 'text-bone-muted'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {paymentError && (
                <p className="mb-3 flex items-start gap-2 rounded-xl border border-emberred-500/40 bg-emberred-500/10 px-3 py-2 text-sm text-emberred-400">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  {paymentError}
                </p>
              )}

              {/* ---------- una cuenta ---------- */}
              {tab === 'single' && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-bone-muted">Método</label>
                    <div className="grid grid-cols-3 gap-2">
                      {METHOD_OPTIONS.map((m) => (
                        <TouchButton
                          key={m.id}
                          variant={singleMethod === m.id ? 'primary' : 'secondary'}
                          onClick={() => {
                            playBeep()
                            setSingleMethod(m.id)
                          }}
                          className="flex-col gap-1 py-3 text-xs"
                        >
                          <span className="text-lg">{m.emoji}</span>
                          {m.label}
                        </TouchButton>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-bone-muted">
                      Monto recibido (vacío = cobrar todo lo que falta)
                    </label>
                    <input
                      value={singleAmount}
                      onChange={(e) => setSingleAmount(e.target.value.replace(/[^\d.]/g, ''))}
                      inputMode="decimal"
                      placeholder={String(remaining)}
                      className={`${INPUT} font-ticket text-lg`}
                    />
                  </div>

                  {/* Calculadora de cambio y billetes sugeridos para Efectivo */}
                  {singleMethod === 'cash' && (
                    <div className="space-y-2 rounded-2xl border border-white/10 bg-ink-800/60 p-3">
                      <p className="text-xs font-medium text-bone-muted">Billetes sugeridos:</p>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            playBeep()
                            setSingleAmount(String(remaining))
                          }}
                          className="rounded-xl border border-saffron-400/40 bg-saffron-400/10 px-2.5 py-1.5 text-xs font-bold text-saffron-400 hover:bg-saffron-400/20"
                        >
                          Exacto ({formatMXN(remaining)})
                        </button>
                        {[20, 50, 100, 200, 500, 1000]
                          .filter((b) => b > remaining)
                          .map((bill) => (
                            <button
                              key={bill}
                              type="button"
                              onClick={() => {
                                playBeep()
                                setSingleAmount(String(bill))
                              }}
                              className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/10"
                            >
                              ${bill}
                            </button>
                          ))}
                      </div>

                      {singleAmount.trim() !== '' && Number(singleAmount) >= remaining && (
                        <div className="mt-2 flex items-center justify-between rounded-xl bg-jade-400/15 border border-jade-400/40 px-3 py-2 text-xs font-bold text-jade-300">
                          <span>💵 Cambio a entregar:</span>
                          <span className="font-ticket text-base">{formatMXN(round2(Number(singleAmount) - remaining))}</span>
                        </div>
                      )}

                      {singleAmount.trim() !== '' && Number(singleAmount) < remaining && (
                        <p className="mt-2 text-xs text-emberred-400 font-semibold">
                          ⚠️ El monto en efectivo es menor que el saldo restante ({formatMXN(remaining)}).
                        </p>
                      )}
                    </div>
                  )}

                  <TouchButton
                    className="w-full min-h-[48px]"
                    onClick={handleSingle}
                    disabled={!canChargeSingle || (singleAmount.trim() !== '' && Number(singleAmount) < remaining)}
                  >
                    Cobrar {singleAmount.trim() === '' ? formatMXN(remaining) : formatMXN(round2(Number(singleAmount)))}
                  </TouchButton>
                </div>
              )}

              {/* ---------- entre N ---------- */}
              {tab === 'parts' && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-bone-muted">
                      ¿Entre cuántas personas?
                    </label>
                    <div className="flex items-center gap-3">
                      <TouchButton
                        variant="secondary"
                        className="h-12 w-12 px-0 text-lg"
                        onClick={() => setParts((p) => Math.max(2, p - 1))}
                      >
                        −
                      </TouchButton>
                      <div className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-white/10 bg-ink-800/70">
                        <span className="font-ticket text-2xl font-bold text-saffron-400">{parts}</span>
                      </div>
                      <TouchButton
                        variant="secondary"
                        className="h-12 w-12 px-0 text-lg"
                        onClick={() => setParts((p) => Math.min(20, p + 1))}
                      >
                        +
                      </TouchButton>
                    </div>
                    <p className="mt-1.5 text-xs text-bone-muted">
                      Reparto exacto: los centavos sobrantes van a los primeros pagos.
                    </p>
                  </div>

                  {splitPreview && (
                    <ul className="space-y-2">
                      {splitPreview.map((amount, index) => {
                        const paid = splitDone.includes(index)
                        const method = splitMethods[index] ?? 'cash'
                        return (
                          <li
                            key={index}
                            className={`rounded-2xl border p-3 ${
                              paid ? 'border-jade-500/40 bg-jade-500/10' : 'border-white/10 bg-white/[0.05]'
                            }`}
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <span className="flex items-center gap-2 text-sm font-semibold">
                                <Users size={15} className="text-saffron-400" />
                                Persona {index + 1}
                              </span>
                              <span className="font-ticket text-base font-bold">
                                {formatMXN(amount)}
                              </span>
                            </div>
                            {paid ? (
                              <p className="flex items-center gap-2 text-xs font-semibold text-jade-300">
                                <CheckCircle2 size={14} /> Cobrado con {PAYMENT_LABELS[method]}
                              </p>
                            ) : (
                              <div className="grid grid-cols-3 gap-1.5">
                                {METHOD_OPTIONS.map((m) => (
                                  <TouchButton
                                    key={m.id}
                                    variant={method === m.id ? 'primary' : 'secondary'}
                                    onClick={() => setMethodFor(setSplitMethods, index, m.id)}
                                    className="px-1 py-2 text-[0.7rem]"
                                  >
                                    {m.label}
                                  </TouchButton>
                                ))}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  <div className="flex items-center justify-between border-t border-dashed border-white/15 pt-3 text-sm">
                    <span className="text-bone-muted">Suma de las partes</span>
                    <span className="font-ticket font-bold">{formatMXN(splitSum)}</span>
                  </div>

                  <TouchButton
                    className="w-full"
                    onClick={handleSplit}
                    disabled={splitBusy || allSplitPaid}
                  >
                    {splitBusy ? (
                      <>
                        <Loader2 className="animate-spin" size={18} /> Cobrando…
                      </>
                    ) : allSplitPaid ? (
                      'Todo cobrado'
                    ) : (
                      `Cobrar ${splitDone.length}/${splitPreview?.length ?? 0} pendientes`
                    )}
                  </TouchButton>
                </div>
              )}

              {/* ---------- por consumo ---------- */}
              {tab === 'items' && (
                <div className="space-y-4">
                  <p className="flex items-start gap-2 text-xs text-bone-muted">
                    <UtensilsCrossed size={14} className="mt-0.5 shrink-0 text-saffron-400" />
                    Marca lo que paga esta persona. El monto sale proporcional al total, para
                    que un descuento se reparta parejo y las partes nunca pasen de lo que falta.
                  </p>

                  <ul className="space-y-1.5">
                    {items.map((item) => {
                      const isSel = selected.has(item.id)
                      const paidAlready = itemDone.includes(item.id)
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => !paidAlready && toggleItem(item.id)}
                            disabled={paidAlready}
                            className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                              paidAlready
                                ? 'border-jade-500/40 bg-jade-500/10 opacity-70'
                                : isSel
                                  ? 'border-saffron-400 bg-saffron-400/15'
                                  : 'border-white/10 bg-white/[0.05]'
                            }`}
                          >
                            <span
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border text-xs font-bold ${
                                paidAlready
                                  ? 'border-jade-400 bg-jade-400 text-ink-950'
                                  : isSel
                                    ? 'border-saffron-400 bg-saffron-400 text-ink-950'
                                    : 'border-white/20'
                              }`}
                            >
                              {paidAlready ? '✓' : isSel ? '•' : ''}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold">
                                {item.quantity}× {item.product_name}
                              </span>
                              {item.notes && (
                                <span className="text-xs text-bone-muted italic">{item.notes}</span>
                              )}
                            </span>
                            <span className="font-ticket text-sm font-bold">
                              {formatMXN(item.price * item.quantity)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {selectedItems.length > 0 && (
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-bone-muted">
                        Método de este cobro
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {METHOD_OPTIONS.map((m) => (
                          <TouchButton
                            key={m.id}
                            variant={(itemMethods.__bulk ?? 'cash') === m.id ? 'primary' : 'secondary'}
                            onClick={() => setMethodFor(setItemMethods, '__bulk', m.id)}
                            className="px-1 py-2 text-[0.7rem]"
                          >
                            {m.label}
                          </TouchButton>
                        ))}
                      </div>
                    </div>
                  )}

                  <TouchButton
                    className="w-full"
                    onClick={handleConsumption}
                    disabled={selectedItems.length === 0 || itemBusy}
                  >
                    {itemBusy ? (
                      <>
                        <Loader2 className="animate-spin" size={18} /> Cobrando…
                      </>
                    ) : (
                      `Cobrar lo seleccionado (${selectedItems.length} ${selectedItems.length === 1 ? 'línea' : 'líneas'})`
                    )}
                  </TouchButton>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}