import { create } from 'zustand'
import supabase from '../lib/supabase'

export const useAuthStore = create((set) => ({
  employee: null,
  // El PIN se guarda SOLO en memoria, nunca en localStorage ni en sessionStorage.
  // No esSession: el proyecto no usa Supabase Auth, así que open_shift, close_shift,
  // create_order y complete_order revalidan el PIN en cada llamada. Sin guardarlo, no
  // habría forma de volver a autorizar una venta ya abierta en la tablet.
  // El costo es explícito: el PIN queda accesible a cualquier script de la página.
  // Por eso el bundle no guarda nada y cerrar sesión lo borra.
  pin: null,
  loading: false,
  error: null,

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
    set({ employee, pin, loading: false, error: null })
    return { data: employee, error: null }
  },

  signOut: () => set({ employee: null, pin: null, error: null, loading: false }),

  /** Limpia el mensaje de error al empezar a teclear de nuevo. */
  clearError: () => set({ error: null }),
}))
