/*
 * Store global para la configuración de la impresora térmica IP (Socket TCP RAW).
 */
import { create } from 'zustand'
import { storage } from '../lib/storage'

const PRINTER_CONFIG_KEY = 'nib:printer_config'

const DEFAULT_CONFIG = {
  printerIp: '192.168.1.213',
  printerPort: 9100,
  autoPrint: true,
}

export const usePrinterStore = create((set, get) => ({
  printerIp: DEFAULT_CONFIG.printerIp,
  printerPort: DEFAULT_CONFIG.printerPort,
  autoPrint: DEFAULT_CONFIG.autoPrint,
  loaded: false,

  loadConfig: async () => {
    try {
      const raw = await storage.getItem(PRINTER_CONFIG_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        set({
          printerIp: parsed.printerIp ?? DEFAULT_CONFIG.printerIp,
          printerPort: Number(parsed.printerPort) || DEFAULT_CONFIG.printerPort,
          autoPrint: parsed.autoPrint ?? DEFAULT_CONFIG.autoPrint,
          loaded: true,
        })
      } else {
        set({ loaded: true })
      }
    } catch {
      set({ loaded: true })
    }
  },

  updateConfig: async (config) => {
    const next = {
      printerIp: config.printerIp ?? get().printerIp,
      printerPort: Number(config.printerPort) || get().printerPort,
      autoPrint: config.autoPrint ?? get().autoPrint,
    }
    set(next)
    await storage.setItem(PRINTER_CONFIG_KEY, JSON.stringify(next))
  },
}))
