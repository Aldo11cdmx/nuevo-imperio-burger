import { useState } from 'react'
import { AlertTriangle, Loader2, Percent, X } from 'lucide-react'
import TouchButton from '../TouchButton'
import { INPUT } from '../admin/fields'
import { formatMXN, round2 } from '../../lib/format'
import supabase from '../../lib/supabase'

/**
 * Descuento autorizado.
 *
 * Monto fijo, no porcentaje: un 10% sobre $485 da $48.50, un número que el cliente
 * no puede cuadrar contra un letrero y que el cajero tiene quehlepar. Un monto fijo
 * sí se puede poner en el ticket.
 *
 * Exige motivo y PIN de administrador, y ambos se validan en el servidor ANTES de
 * devolver nada: este diálogo no "aprueba" nada, solo pide los datos. Si el PIN no
 * cuadrara, create_order lo rechazaría igual al enviar, pero más tarde y con el
 * pedido ya en la cocina.
 */
export default function DiscountDialog({ subtotal, onClose, onConfirm }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [adminPin, setAdminPin] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState(null)

  const value = round2(Number(amount) || 0)
  const valid = value > 0 && value <= subtotal && reason.trim().length > 0 && adminPin.length === 4

  const confirm = async () => {
    if (!valid || checking) return
    setChecking(true)
    setError(null)

    // list_all_products es la misma comprobación de administrador que usa la pantalla
    // de Admin: barata y sin efectos. Solo se usa para no gastar un viaje de la
    // orden si el PIN está mal.
    const { data, error: rpcError } = await supabase.rpc('list_all_products', {
      p_admin_pin: adminPin,
    })

    setChecking(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }
    if (!data || data.length === 0) {
      setError('PIN de administrador no reconocido')
      return
    }

    onConfirm({ amount: value, reason: reason.trim(), adminPin })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-sm rounded-t-3xl border border-white/10 bg-ink-900/95 p-4 shadow-glass backdrop-blur-2xl sm:rounded-3xl">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold">
              <Percent size={18} className="text-saffron-400" /> Descuento
            </h2>
            <p className="text-xs text-bone-muted">
              Sobre {formatMXN(subtotal)} · requiere autorización
            </p>
          </div>
          <TouchButton variant="ghost" onClick={onClose} aria-label="Cerrar" className="px-2">
            <X size={18} />
          </TouchButton>
        </header>

        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bone-muted">
              Monto a descontar (pesos)
            </label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              placeholder="0.00"
              autoFocus
              className={`${INPUT} font-ticket text-2xl`}
            />
            {value > subtotal && (
              <p className="mt-1 flex items-center gap-1 text-xs text-emberred-400">
                <AlertTriangle size={12} /> No puede ser mayor que el total
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-bone-muted">
              Motivo (obligatorio)
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Cliente frecuente, platillo mal preparado…"
              className={`${INPUT} text-sm`}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-bone-muted">
              PIN de administrador
            </label>
            <input
              value={adminPin}
              onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              maxLength={4}
              placeholder="····"
              className={`${INPUT} text-center font-ticket text-xl tracking-[0.4em]`}
            />
          </div>

          {error && <p className="text-sm text-emberred-400">{error}</p>}

          <div className="flex gap-2 pt-1">
            <TouchButton variant="secondary" className="flex-1" onClick={onClose}>
              Cancelar
            </TouchButton>
            <TouchButton className="flex-[2]" disabled={!valid || checking} onClick={confirm}>
              {checking ? (
                <>
                  <Loader2 className="animate-spin" size={17} /> Verificando…
                </>
              ) : (
                <>
                  Aplicar {value > 0 ? formatMXN(value) : ''}
                </>
              )}
            </TouchButton>
          </div>
        </div>
      </div>
    </div>
  )
}