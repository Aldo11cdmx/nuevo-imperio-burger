import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Printer, Wifi, Check, AlertCircle, GripHorizontal } from 'lucide-react'
import { usePrinterStore } from '../store/usePrinterStore'
import { imprimirTicket } from '../lib/thermalPrint'
import { playBeep, playError, playSuccess } from '../lib/audio'

export default function PrinterSettingsModal({ onClose, onToast }) {
  const { printerIp, printerPort, autoPrint, updateConfig } = usePrinterStore()

  const [ip, setIp] = useState(printerIp || '192.168.1.213')
  const [port, setPort] = useState(String(printerPort || 9100))
  const [auto, setAuto] = useState(autoPrint ?? true)

  const [testing, setTesting] = useState(false)
  const [testStatus, setTestStatus] = useState(null)

  const [position, setPosition] = useState(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const modalRef = useRef(null)

  useEffect(() => {
    if (modalRef.current) {
      const rect = modalRef.current.getBoundingClientRect()
      const centerX = Math.max(16, (window.innerWidth - rect.width) / 2)
      const centerY = Math.max(16, (window.innerHeight - rect.height) / 2)
      setPosition({ x: centerX, y: centerY })
    }
  }, [])

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handlePointerDown = (e) => {
    if (e.button !== 0) return
    if (e.target.closest('button') || e.target.closest('input')) return

    isDraggingRef.current = true
    dragStartRef.current = {
      x: e.clientX - (position?.x || 0),
      y: e.clientY - (position?.y || 0),
    }

    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e) => {
    if (!isDraggingRef.current || !modalRef.current) return

    const rect = modalRef.current.getBoundingClientRect()
    const rawX = e.clientX - dragStartRef.current.x
    const rawY = e.clientY - dragStartRef.current.y

    const maxX = Math.max(16, window.innerWidth - rect.width - 16)
    const maxY = Math.max(16, window.innerHeight - rect.height - 16)

    const boundedX = Math.min(Math.max(16, rawX), maxX)
    const boundedY = Math.min(Math.max(16, rawY), maxY)

    setPosition({ x: boundedX, y: boundedY })
  }

  const handlePointerUp = (e) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    }
  }

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose?.()
  }

  const handleTestPrint = async () => {
    playBeep()
    setTesting(true)
    setTestStatus(null)

    const testText =
      '================================\n' +
      '      NUEVO IMPERIO BURGER      \n' +
      '================================\n' +
      'TEST DE CONEXION TCP / RAW\n' +
      `IP: ${ip.trim() || '192.168.1.213'} : ${port || 9100}\n` +
      `Fecha: ${new Date().toLocaleString('es-MX')}\n` +
      'Impresion nativa exitosa!\n' +
      '================================\n\n\n\n'

    try {
      await updateConfig({ printerIp: ip.trim() || '192.168.1.213', printerPort: Number(port) || 9100, autoPrint: auto })
      const successNative = await imprimirTicket(testText, 'native')

      if (successNative) {
        playSuccess()
        setTestStatus({ success: true, message: 'Impresion enviada con exito!' })
      } else {
        const successAuto = await imprimirTicket(testText, 'auto')
        if (successAuto) {
          playSuccess()
          setTestStatus({ success: true, message: 'Impresion enviada con exito (fallback)!' })
        } else {
          playError()
          setTestStatus({ success: false, message: 'No se pudo conectar a la impresora TCP' })
        }
      }
    } catch (err) {
      playError()
      setTestStatus({ success: false, message: err.message || 'Error en prueba de impresion' })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = (e) => {
    e.preventDefault()
    updateConfig({ printerIp: ip.trim() || '192.168.1.213', printerPort: Number(port) || 9100, autoPrint: auto })
    playSuccess()
    if (onToast) onToast({ tone: 'success', title: 'Configuracion guardada', detail: 'Impresora configurada correctamente' })
    onClose?.()
  }

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div className="absolute inset-0" aria-hidden="true" />

      <div
        ref={modalRef}
        style={
          position
            ? {
                position: 'fixed',
                left: `${position.x}px`,
                top: `${position.y}px`,
                margin: 0,
              }
            : undefined
        }
        className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-neutral-900 p-5 shadow-2xl select-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="flex items-center justify-between border-b border-white/10 pb-3 cursor-grab active:cursor-grabbing touch-none select-none"
        >
          <div className="flex items-center gap-2">
            <GripHorizontal className="text-white/40" size={16} />
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-saffron-400/10 text-saffron-400">
              <Printer size={16} />
            </span>
            <h2 className="text-sm font-bold text-bone">Configurar Impresora</h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-bone-muted hover:bg-white/10 hover:text-bone transition-colors"
            aria-label="Cerrar modal"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-3 space-y-3 select-text">
          <div>
            <label className="block text-xs font-semibold text-bone-muted mb-1">
              Direccion IP de Impresora
            </label>
            <input
              type="text"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="192.168.1.213"
              required
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-bone focus:border-saffron-400 focus:outline-none focus:ring-1 focus:ring-saffron-400"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-bone-muted mb-1">
              Puerto TCP (RAW)
            </label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="9100"
              required
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-bone focus:border-saffron-400 focus:outline-none focus:ring-1 focus:ring-saffron-400"
            />
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-xl border border-white/5 bg-white/[0.02] p-2.5 hover:bg-white/[0.05] transition-colors">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-white/10 text-saffron-400 focus:ring-saffron-400 focus:ring-offset-0"
            />
            <div>
              <span className="block text-xs font-semibold text-bone">Impresion Automatica</span>
              <span className="block text-[10px] text-bone-muted">
                Imprimir tickets y comandas al cobrar/enviar
              </span>
            </div>
          </label>

          {testStatus && (
            <div
              className={`flex items-start gap-2 rounded-xl p-2.5 text-xs ${
                testStatus.success
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              }`}
            >
              {testStatus.success ? <Check size={15} className="shrink-0 mt-0.5" /> : <AlertCircle size={15} className="shrink-0 mt-0.5" />}
              <span>{testStatus.message}</span>
            </div>
          )}

          <div className="pt-1 space-y-2 select-none">
            <button
              type="button"
              onClick={handleTestPrint}
              disabled={testing}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-saffron-400/30 bg-saffron-400/10 py-2 text-xs font-bold text-saffron-400 hover:bg-saffron-400/20 transition-colors disabled:opacity-50"
            >
              <Wifi size={15} />
              {testing ? 'Probando conexion...' : 'Probar Conexion (Test Print)'}
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2 text-xs font-semibold text-bone-muted hover:bg-white/10 hover:text-bone transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 rounded-xl bg-saffron-grad py-2 text-xs font-bold text-ink-950 shadow-glow hover:brightness-110 transition-all"
              >
                Guardar Configuracion
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
