import { create } from 'zustand'
import supabase from '../lib/supabase'
import { getJSON, setJSON, storage } from '../lib/storage'

const SESSION_KEY = 'nib:auth'
// Revalidar el PIN en foreground solo si hace más de este tiempo: login_with_pin
// está detrás de rate limit (3 intentos / 3 min por PIN), así que no se puede
// llamar a cada resurrección de la app sin correr el mesero a un lockout.
const REVALIDATE_EVERY_MS = 30 * 60_000

export const useAuthStore = create((set, get) => ({
  employee: null,
  // El PIN se guarda SOLO en memoria, nunca en localStorage ni en sessionStorage.
  // No esSession: el proyecto no usa Supabase Auth, así que open_shift, close_shift,
  // create_order y complete_order revalidan el PIN en cada llamada. Sin guardarlo, no
  // habría forma de volver a autorizar una venta ya abierta en la tablet.
  // El costo es explícito: el PIN queda accesible a cualquier script de la página.
  // Por eso el bundle no guarda nada y cerrar sesión lo borra.
  //
  // En el APK, el "almacenamiento" es Preferences (= EncryptedSharedPreferences en
  // Android), que no es legible desde JS de la página: allí el PIN persiste entre
  // cierres y reinicios, y se revalida en foreground. En web (vite preview) cae a
  // in-memory: el PIN se pierde al recargar, como siempre.
  pin: null,
  loading: false,
  error: null,

  /** Carga la sesión guardada (empleado + pin) si existe. */
  init: async () => {
    const session = await getJSON(SESSION_KEY, null)
    if (session?.employee) {
      set({ employee: session.employee, pin: session.pin ?? null })
    }
    return get().refreshSession()
  },

  /**
   * Revalida el PIN contra el servidor cada REVALIDATE_EVERY_MS. login_with_pin
   * es SECURITY DEFINER y sólo devuelve id/full_name/role: el rate limit se mantiene
   * y no se expone el hash. Si el PIN fue revocado, cae a signOut de golpe.
   */
  refreshSession: async () => {
    const session = await getJSON(SESSION_KEY, null)
    if (!session?.pin) return null
    const now = Date.now()
    if (now - (session.lastValidatedAt ?? 0) < REVALIDATE_EVERY_MS) return null

    const { data, error } = await supabase.rpc('login_with_pin', { p_pin: session.pin })
    const result = Array.isArray(data) ? data[0] : data
    if (error || !result || result.ok !== true) {
      get().signOut()
      return null
    }
    await setJSON(SESSION_KEY, { ...session, lastValidatedAt: now })
    set({ employee: { id: result.id, full_name: result.full_name, role: result.role } })
    return get().employee
  },

  /**
   * Autenticación táctil. La tabla employees está sin políticas RLS a propósito: el PIN se
   * valida con login_with_pin, que corre como SECURITY DEFINER en el servidor y devuelve
   * solo id, full_name y role (nunca pin_hash).
   *
   * El fallo viene como { ok: false, message } y no como excepción a propósito: si la
   * función lanzara, Postgres abortaría la transacción y el contador anti-fuerza-bruta
   * se perdería con ella.
   */
  signInWithPin: async (pin) => {
    set({ loading: true, error: null })

    const { data, error } = await supabase.rpc('login_with_pin', { p_pin: pin })

    if (error) {
      set({ loading: false, error: error.message })
      return { data: null, error }
    }

    const result = Array.isArray(data) ? data[0] : data

    if (!result || result.ok !== true) {
      const failure = { message: result?.message ?? 'PIN no reconocido' }
      set({ loading: false, error: failure.message })
      return { data: null, error: failure }
    }

    const employee = { id: result.id, full_name: result.full_name, role: result.role }
    await setJSON(SESSION_KEY, { employee, pin, lastValidatedAt: Date.now() })
    set({ employee, pin, loading: false, error: null })
    return { data: employee, error: null }
  },

  signOut: async () => {
    await storage.removeItem(SESSION_KEY)
    set({ employee: null, pin: null, error: null, loading: false })
  },

  /** Limpia el mensaje de error al empezar a teclear de nuevo. */
  clearError: () => set({ error: null }),
}))
