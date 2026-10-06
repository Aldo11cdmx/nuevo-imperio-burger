import { useEffect, useRef, useState } from 'react'
import { Loader2, Network, Printer, X, Zap } from 'lucide-react'
import TouchButton from './TouchButton'
import { INPUT } from './admin/fields'
import { usePrinterStore } from '../store/usePrinterStore'
import { imprimirTicket } from '../lib/thermalPrint'
import { playBeep, playError, playSuccess } from '../lib/audio'

export default function PrinterSettingsModal({ onClose, onToast }) {
  const { printerIp, printerPort, autoPrint, loadConfig, updateConfig } = usePrinterStore()
  const [ip, setIp] = useState(printerIp)
  const [port, setPort] = useState(String(printerPort))
  const [auto, setAuto] = useState(autoPrint)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  const [position, setPosition] = useState(null)
  const draggingRef = useRef(false)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const modalRef = useRef(null)

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    setIp(printerIp)
    setPort(String(printerPort))
    setAuto(autoPrint)
  }, [printerIp, printerPort, autoPrint])

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }

    document.addEventListener('keydown', handleKey)

    return () => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose?.()
  }

  const handleDragStart = (e) => {
    if (e.button !== undefined && e.button !== 0) return

    const modal = modalRef.current
    if (!modal) return

    const rect = modal.getBoundingClientRect()

    draggingRef.current = true

    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }

    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const handleDragMove = (e) => {
    if (!draggingRef.current) return

    const modal = modalRef.current
    if (!modal) return

    const rect = modal.getBoundingClientRect()

    const maxX = Math.max(8, window.innerWidth - rect.width - 8)
    const maxY = Math.max(8, window.innerHeight - rect.height - 8)

    const nextX = Math.min(
      maxX,
      Math.max(8, e.clientX - dragOffsetRef.current.x)
    )

    const nextY = Math.min(
      maxY,
      Math.max(8, e.clientY - dragOffsetRef.current.y)
    )

    setPosition({
      x: nextX,
      y: nextY,
    })
  }

  const handleDragEnd = (e) => {
    draggingRef.current = false
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  const handleTestPrint = async () => {
    playBeep()
    setTesting(true)

    const testText =
      '================================\n' +
      '      NUEVO IMPERIO BURGER      \n' +
      '================================\n' +
      'TEST DE CONEXION TCP / RAW\n' +
      `IP: ${ip.trim() || '192.168.1.213'} : ${port || 9100}\n` +
      `Fecha: ${new Date().toLocaleString()}\n` +
      'Impresion nativa exitosa!\n' +
      '================================\n\n\n\n'

    try {
      await updateConfig({
        printerIp: ip.trim() || '192.168.1.213',
        printerPort: Number(port) || 9100,
        autoPrint: auto,
      })

      let success = await imprimirTicket(testText, 'native')

      if (!success) {
        success = await imprimirTicket(testText, 'auto')
      }

      if (success) {
        playSuccess()

        if (onToast) {
          onToast({
            tone: 'success',
            title: 'Impresion enviada con exito!',
            detail: `Conectado a ${ip}:${port} (o servicio local)`,
          })
        }
      } else {
        playError()

        if (onToast) {
          onToast({
            tone: 'error',
            title: 'Fallo en la prueba',
            detail: `No se pudo conectar a ${ip}:${port} ni usar servicios locales`,
          })
        }
      }
    } catch (e) {
      playError()

      if (onToast) {
        onToast({
          tone: 'error',
          title: 'Error de impresion',
          detail: e.message || 'Verifica la red',
        })
      }
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    playBeep()
    setSaving(true)

    await updateConfig({
      printerIp: ip.trim() || '192.168.1.213',
      printerPort: Number(port) || 9100,
      autoPrint: auto,
    })

    setSaving(false)
    playSuccess()

    onToast?.({
      tone: 'success',
      title: 'Configuracion guardada',
      detail: 'Impresora configurada correctamente',
    })

    onClose?.()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Configuracion de impresora termica"
        style={
          position
            ? {
                position: 'fixed',
                left: `${position.x}px`,
                top: `${position.y}px`,
              }
            : undefined
        }
        className="w-full max-w-sm max-h-[90vh] flex flex-col overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900 p-5 shadow-2xl"
      >
        <header
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          className="flex cursor-grab touch-none select-none items-center justify-between border-b border-white/10 p-4 active:cursor-grabbing"
        >
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-saffron-400/20 text-saffron-400">
              <Printer size={20} />
            </span>

            <div>
              <h2 className="text-base font-bold text-bone">
                Configuracion de Impresora
              </h2>

              <p className="text-xs text-bone-muted">
                Conexion directa RAW (Puerto 9100)
              </p>
            </div>
          </div>

          <TouchButton
            variant="ghost"
            onClick={onClose}
            className="px-2.5"
            aria-label="Cerrar"
          >
            <X size={18} />
          </TouchButton>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-bone-muted">
              Direccion IP de la Impresora
            </label>

            <div className="relative flex items-center">
              <Network
                size={16}
                className="absolute left-3 text-bone-muted"
              />

              <input
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="192.168.1.213"
                className={`${INPUT} pl-9 font-ticket text-base`}
              />
            </div>

            <p className="mt-1 text-[0.7rem] text-bone-faint">
              IP local asignada a la impresora termica en la red del restaurante.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-bone-muted">
              Puerto TCP (RAW)
            </label>

            <input
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder="9100"
              className={`${INPUT} font-ticket text-base`}
            />
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
            <div>
              <p className="text-sm font-semibold text-bone">
                Impresion Automatica
              </p>

              <p className="text-xs text-bone-muted">
                Imprimir tickets y comandas al cobrar/enviar
              </p>
            </div>

            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
              className="h-5 w-5 rounded border-white/20 bg-ink-800 text-saffron-400 accent-saffron-400 focus:ring-0"
            />
          </div>
        </div>

        <footer className="space-y-2 border-t border-white/10 p-4">
          <TouchButton
            variant="secondary"
            className="w-full border-saffron-400/40 bg-saffron-400/10 text-saffron-400 hover:bg-saffron-400/20"
            onClick={handleTestPrint}
            disabled={testing || saving}
          >
            {testing ? (
              <>
                <Loader2 className="animate-spin" size={17} />
                Probando conexion TCP...
              </>
            ) : (
              <>
                <Zap size={17} />
                Probar Conexion (Test Print)
              </>
            )}
          </TouchButton>

          <div className="flex gap-2 pt-1">
            <TouchButton
              variant="ghost"
              className="flex-1"
              onClick={onClose}
            >
              Cancelar
            </TouchButton>

            <TouchButton
              className="flex-1"
              onClick={handleSave}
              disabled={testing || saving}
            >
              {saving ? (
                <Loader2 className="animate-spin" size={17} />
              ) : (
                'Guardar Configuracion'
              )}
            </TouchButton>
          </div>
        </footer>
      </div>
    </div>
  )
}
