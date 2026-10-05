import { createClient } from '@supabase/supabase-js'
import { storage } from './storage'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Copia .env.example a .env y completa los valores.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // La sesión de Supabase Auth (si se usara) se persiste con el adaptador de
    // Preferences, que en Android es EncryptedSharedPreferences: sobrevive al
    // cierre de la app y al reinicio de la tablet, y no expone los bytes a JS.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: storage,
  },
})

export default supabase
