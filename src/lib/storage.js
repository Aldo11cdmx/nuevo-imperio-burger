/*
 * Adaptador de almacenamiento neutro entre web y Capacitor.
 *
 * En Android, @capacitor/preferences escribe en EncryptedSharedPreferences (AES-256),
 * así que datos como la sesión o comandas offline no quedan en localStorage (que sí
 * es legible desde el JS de la página). En web (vite preview) cae a localStorage.
 */
import { Preferences } from '@capacitor/preferences'
import { Capacitor } from '@capacitor/core'

const native = Capacitor.isPluginAvailable('Preferences')

export const storage = {
  async getItem(key) {
    if (native) {
      const { value } = await Preferences.getItem({ key })
      return value
    }
    return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null
  },
  async setItem(key, value) {
    const v = value ?? ''
    if (native) {
      await Preferences.setItem({ key, value: String(v) })
    } else if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, String(v))
    }
  },
  async removeItem(key) {
    if (native) {
      await Preferences.removeItem({ key })
    } else if (typeof window !== 'undefined') {
      window.localStorage.removeItem(key)
    }
  },
}

// Helpers de sesión: JSON con fallback seguro.
export async function getJSON(key, fallback) {
  try {
    const raw = await storage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export async function setJSON(key, value) {
  await storage.setItem(key, JSON.stringify(value))
}
