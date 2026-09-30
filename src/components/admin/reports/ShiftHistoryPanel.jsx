import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, RefreshCw, Wallet } from 'lucide-react'
import TouchButton from '../../TouchButton'
import supabase from '../../../lib/supabase'
import { formatMXN } from '../../../lib/format'
import { PANEL, PANEL_TITLE } from '../fields'
import { durationLabel, localDateTime, localTime } from './reportHelpers'

/**
 * Historial de cortes de caja.
 *
 * El corte Z se cerraba y se perdía: al terminar el turno el reporte desaparecía con la
 * pantalla y no había forma de consultar un turno viejo. Aquí queda cualquier corte,
 * con su efectivo contado y su diferencia, para que un faltante de hace tres días se
 * pueda revisar sin pedirle cuentas a nadie.
 *
 * Es de solo lectura. Reabrir un turno cerrado desde aquí no tiene sentido: la caja ya
 * cuadró con ese número.
 */
export default function ShiftHistoryPanel({ adminPin }) {
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('list_closed_shifts', {
      p_admin_pin: adminPin,
      p_limit: 30,
    })

    setLoading(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    if (data === null) {
      setError('Autorización de administrador fallida')
      return
    }
    setShifts(data)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminPin])

  const exact = shifts.filter((shift) => Number(shift.cash_difference) === 0).length

  return (
    <section className={PANEL}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className={PANEL_TITLE}>Cortes de caja</h2>
        <TouchButton variant="ghost" onClick={load} disabled={loading} className="px-3 py-2 text-xs">
          <RefreshCw size={14} /> Recargar
        </TouchButton>
      </div>

      {error && (
        <p role="alert" className="pb-3 text-sm font-medium text-emberred-400">
          {error}
        </p>
      )}

      <p className="mb-4 text-sm text-bone-muted">
        Cada corte guarda el fondo con el que se abrió, lo que se vendió y lo que había en
        la gaveta al cerrarlo. El esperado es el fondo más las ventas en efectivo: si no
        cuadra, la diferencia queda anotada con su signo.
      </p>

      {loading && (
        <p className="flex items-center justify-center gap-2 py-16 text-bone-muted">
          <Loader2 className="animate-spin" size={18} /> Cargando cortes…
        </p>
      )}

      {!loading && shifts.length === 0 && (
        <p className="py-16 text-center text-sm text-bone-muted">
          Todavía no hay turnos cerrados.
        </p>
      )}

      {!loading && shifts.length > 0 && (
        <>
          <p className="mb-4 rounded-xl border border-white/10 bg-ink-800/60 px-4 py-2.5 text-sm text-bone-muted">
            {exact} de {shifts.length} {shifts.length === 1 ? 'corte cuadró' : 'cortos cuadraron'}{' '}
            exactamente.
          </p>

          <ul className="space-y-3">
            {shifts.map((shift) => {
              const difference = Number(shift.cash_difference)
              const balanced = difference === 0

              return (
                <li key={shift.shift_id} className="rounded-2xl border border-white/10 bg-ink-800/50 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="font-semibold">{shift.employee_name}</p>
                      <p className="text-xs text-bone-faint">
                        {localDateTime(shift.opened_at)} → {localTime(shift.closed_at)} ·{' '}
                        {durationLabel(shift.opened_at, shift.closed_at)}
                      </p>
                    </div>
                    <span
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold ${
                        balanced ? 'bg-jade-500/15 text-jade-300' : 'bg-emberred-500/15 text-emberred-400'
                      }`}
                    >
                      {balanced ? <CheckCircle2 size={13} /> : <Wallet size={13} />}
                      {balanced
                        ? 'Cuadrado'
                        : difference < 0
                          ? `Faltaron ${formatMXN(Math.abs(difference))}`
                          : `Sobraron ${formatMXN(difference)}`}
                    </span>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                    <Cell label="Fondo" value={formatMXN(shift.opening_float)} />
                    <Cell label="Efectivo" value={formatMXN(shift.cash_sales)} />
                    <Cell label="Tarjeta" value={formatMXN(shift.card_sales)} />
                    <Cell label="Transferencia" value={formatMXN(shift.transfer_sales)} />
                  </dl>

                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-white/10 pt-2 text-sm sm:grid-cols-4">
                    <Cell label="Total vendido" value={formatMXN(shift.total_sales)} strong />
                    <Cell label="Tickets" value={shift.ticket_count} />
                    <Cell label="Esperado" value={formatMXN(shift.expected_cash)} />
                    <Cell label="Contado" value={formatMXN(shift.counted_total)} />
                  </dl>

                  {shift.shift_note && (
                    <p className="mt-2 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-bone-muted">
                      {shift.shift_note}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

function Cell({ label, value, strong = false }) {
  return (
    <div>
      <dt className="text-[0.7rem] tracking-wider text-bone-faint uppercase">{label}</dt>
      <dd className={`font-ticket ${strong ? 'font-bold text-saffron-400' : ''}`}>{value}</dd>
    </div>
  )
}
