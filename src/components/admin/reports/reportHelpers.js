/**
 * Utilidades de los reportes.
 *
 * Se separan del panel porque son funciones puras y faciles de equivocar: una fecha mal
 * recortada en el reporte hace creer que el restaurante no vendio nada.
 */

/**
 * Rango por defecto: de hoy al domingo de la semana en curso.
 *
 * Se muestra la semana que ya empezó, no los ultimos siete dias: un admin que abre
 * reportes un martes quiere ver como va la semana que esta corriendo, no una ventana
 * deslizante que mezcla dos lunes.
 */
export function defaultRange(today = new Date()) {
  const end = new Date(today)
  const daysUntilSunday = end.getDay()
  const start = new Date(end)
  start.setDate(end.getDate() - daysUntilSunday)
  return { from: toInputDate(start), to: toInputDate(end) }
}

/** Ultimos N dias, contando hoy. Para el boton rapido de "7 dias". */
export function lastDays(days, today = new Date()) {
  const start = new Date(today)
  start.setDate(today.getDate() - (days - 1))
  return { from: toInputDate(start), to: toInputDate(today) }
}

/** Date -> "YYYY-MM-DD" en hora local, no en UTC. */
export function toInputDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Etiqueta legible del rango. Todo en hora local: el usuario compara contra su reloj de
 * pared, no contra UTC.
 */
export function rangeLabel(from, to) {
  const parse = (value) => {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
  }
  const format = (date) =>
    date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
  return `${format(parse(from))} – ${format(parse(to))}`
}

/**
 * Dia de negocio en hora local, para el encabezado del corte.
 *
 * Se calcula con getFullYear/getDate y no con toISOString(): toISOString convierte a UTC
 * y entre las 18:00 y las 23:59 devuelve el dia siguiente. Un corte de las 20:00
 * terminaria rotulado con la fecha de manana.
 */
export function localDayLabel(iso) {
  const date = new Date(iso)
  return date.toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

/** "14:32" en hora local, para ver a qué hora se cobró un ticket. */
export function localTime(iso) {
  return new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** "20 sep, 14:32" para listados largos donde el día importa. */
export function localDateTime(iso) {
  const date = new Date(iso)
  return `${date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, ${localTime(iso)}`
}

/**
 * Duracion del turno en formato corto. Un turno de 8 h 40 se lee mejor como "8 h 40 min"
 * que como un numero crudo de segundos.
 */
export function durationLabel(fromIso, toIso) {
  const minutes = Math.max(
    0,
    Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000),
  )
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  if (rest === 0) return `${hours} h`
  return `${hours} h ${rest} min`
}

/**
 * Atajos de rango para el filtro de fechas.
 *
 * Cada atajo lleva su propia funcion resolve: el botón calcula el rango al pulsarse, no
 * al pintarse. Si el rango se calculara al montar, "Hoy" seguiría apuntando al día en que
 * se abrió la pantalla y no cambiaría al cruzar la medianoche.
 *
 * Vive aquí y no en RangePicker porque un archivo que exporta un componente y una función
 * más rompe el refresco en caliente de React.
 */
export function buildPresets() {
  return [
    {
      id: 'hoy',
      label: 'Hoy',
      resolve: () => {
        const today = toInputDate(new Date())
        return { from: today, to: today }
      },
    },
    { id: 'semana', label: 'Esta semana', resolve: () => defaultRange() },
    { id: '7', label: '7 días', resolve: () => lastDays(7) },
    { id: '30', label: '30 días', resolve: () => lastDays(30) },
  ]
}
