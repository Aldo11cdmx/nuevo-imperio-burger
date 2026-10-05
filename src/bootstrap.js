import { useAuthStore } from './store/useAuthStore'
import { initCapacitor } from './lib/capacitorBoot'

let booted = false

export async function initApp() {
  if (booted) return
  booted = true
  // Inicia listeners nativos (Network, AppState, KeepAwake, heartbeat) y
  // la splash. En web es un no-op.
  await initCapacitor()
  // Recupera empleado + pin de Preferences (EncryptedSharedPreferences) y
  // revalida el PIN con el server si hace > 30 min.
  await useAuthStore.getState().init()
}
