import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

/**
 * Genera y descarga un comprobante PDF oficial de Corte de Caja (Corte X / Corte Z).
 */
export function generateShiftPDF({ shift, business, staffName, expenses = [] }) {
  const doc = new jsPDF()

  // Encabezado con estilo
  const darkInk = [11, 10, 12]
  doc.setFillColor(...darkInk)
  doc.rect(0, 0, 210, 36, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(business?.name || 'Nuevo Imperio Burger', 14, 18)

  doc.setFontSize(10)
  doc.setTextColor(240, 168, 48) // Color Saffron
  doc.text('REPORTE OFICIAL DE CORTE DE CAJA (CORTE Z)', 14, 28)

  // Metadatos del turno
  doc.setTextColor(40, 40, 40)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)

  const dateStr = new Date().toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  })
  doc.text(`Cajero responsable: ${staffName || 'Cajero'}`, 14, 46)
  doc.text(`Fecha y Hora de Cierre: ${dateStr}`, 14, 53)
  doc.text(`ID de Turno: #${shift.id ? shift.id.slice(0, 8) : '---'}`, 14, 60)

  // Tabla de métricas principales
  const formatMoney = (val) => `$${Number(val || 0).toFixed(2)} MXN`

  autoTable(doc, {
    startY: 68,
    head: [['Métrica de Caja', 'Monto']],
    body: [
      ['Fondo Inicial (Apertura)', formatMoney(shift.opening_float)],
      ['Ventas en Efectivo', formatMoney(shift.cash_sales)],
      ['Ventas con Tarjeta', formatMoney(shift.card_sales)],
      ['Ventas por Transferencia / Plataforma', formatMoney(shift.transfer_sales)],
      ['Total de Gastos de Caja Chica', `-${formatMoney(shift.total_expenses)}`],
      ['Efectivo Esperado en Gaveta', formatMoney(shift.expected_cash)],
      ['Efectivo Declarado / Contado', formatMoney(shift.actual_cash)],
      ['Diferencia (Sobrante / Faltante)', formatMoney(shift.difference)],
    ],
    theme: 'striped',
    headStyles: { fillStyle: darkInk, textColor: [255, 255, 255], fontStyle: 'bold' },
  })

  // Desglose de Gastos si existen
  if (expenses && expenses.length > 0) {
    const finalY = (doc).lastAutoTable.finalY + 12
    doc.setFont('helvetica', 'bold')
    doc.text('Desglose de Gastos de Caja Chica del Turno:', 14, finalY)

    autoTable(doc, {
      startY: finalY + 4,
      head: [['Hora', 'Motivo / Concepto', 'Monto']],
      body: expenses.map((e) => [
        new Date(e.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
        e.reason,
        formatMoney(e.amount),
      ]),
      theme: 'grid',
      headStyles: { fillStyle: [40, 40, 40], textColor: [255, 255, 255] },
    })
  }

  // Pie de página
  const pageHeight = doc.internal.pageSize.height
  doc.setFontSize(8)
  doc.setTextColor(120, 120, 120)
  doc.text('Nuevo Imperio Burger POS — Comprobante impreso del sistema', 14, pageHeight - 10)

  // Descarga el PDF localmente
  const filename = `corte_caja_${Date.now()}.pdf`
  doc.save(filename)
}
