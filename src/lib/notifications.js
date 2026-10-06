import { Capacitor } from '@capacitor/core'

let localNotificationsPlugin = null

async function getPlugin() {
  if (localNotificationsPlugin) return localNotificationsPlugin
  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      localNotificationsPlugin = LocalNotifications
    } catch {
      // Si el paquete no está instalado o nativo no lo soporta, cae al fallback
    }
  }
  return localNotificationsPlugin
}

/** Solicita permisos de notificación nativos y web */
export async function requestNotificationPermission() {
  try {
    const plugin = await getPlugin()
    if (plugin) {
      const status = await plugin.checkPermissions()
      if (status.display !== 'granted') {
        await plugin.requestPermissions()
      }
    } else if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        await Notification.requestPermission()
      }
    }
  } catch (e) {
    console.warn('[notifications] fallo al solicitar permisos:', e)
  }
}

/** Envía una notificación nativa o web con fallback */
export async function sendNotification({ id, title, body }) {
  try {
    const plugin = await getPlugin()
    if (plugin) {
      await plugin.schedule({
        notifications: [
          {
            id: id ?? Math.floor(Math.random() * 100000),
            title,
            body,
            schedule: { at: new Date(Date.now() + 100) },
            smallIcon: 'ic_stat_name',
          },
        ],
      })
    } else if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.svg' })
    }
  } catch (e) {
    console.warn('[notifications] fallo al enviar:', e)
  }
}

/** Alerta de nueva comanda registrada */
export function notifyNewOrder(order) {
  if (!order) return
  const code = order.code ? `#${order.code}` : ''
  const table = order.table_number ? `Mesa ${order.table_number}` : 'Para llevar'
  sendNotification({
    id: Number(order.code) || Math.floor(Math.random() * 100000),
    title: `🔥 Nueva Comanda ${code}`,
    body: `${table} — Creada correctamente`,
  })
}

/** Alerta cuando una comanda está lista para servir */
export function notifyOrderReady(order) {
  if (!order) return
  const code = order.code ? `#${order.code}` : ''
  const table = order.table_number ? `Mesa ${order.table_number}` : 'Para llevar'
  sendNotification({
    id: (Number(order.code) || 1000) + 50000,
    title: `✅ Comanda Lista ${code}`,
    body: `${table} está lista para servir`,
  })
}

/** Alerta de stock mínimo alcanzado */
export function notifyLowStock(product) {
  if (!product) return
  sendNotification({
    id: Math.floor(Math.random() * 100000),
    title: `⚠️ Stock Bajo: ${product.name}`,
    body: `Quedan solo ${product.stock} unidad(es) disponible(s)`,
  })
}
