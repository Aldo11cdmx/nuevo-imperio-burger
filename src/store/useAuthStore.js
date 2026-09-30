import { create } from 'zustand'
import supabase from '../lib/supabase'

export const useAuthStore = create((set) => ({
  employee: null,
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
    set({ employee, loading: false, error: null })
    return { data: employee, error: null }
  },

  signOut: () => set({ employee: null, error: null, loading: false }),

  /** Limpia el mensaje de error al empezar a teclear de nuevo. */
  clearError: () => set({ error: null }),
}))
