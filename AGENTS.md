# AGENTS.md — Nuevo Imperio Burger POS

Contexto rápido para cualquier agente que trabaje en este repo.

## Stack
- React 19 + Vite 8 + TailwindCSS 3 + Zustand 5 + Supabase JS.
- App nativa Android vía **Capacitor 8** (`android/` versionado; sin PWA, sin manifest ni service worker).
- `vite.config.ts` es mínimo (solo `@vitejs/plugin-react`); no hay PWA plugin.

## Comandos
- `npm run lint` — oxlint. Corregir warnings antes de commitear.
- `npm run build` — build de producción en `dist/`.
- `npm run dev` — preview Vite.
- `npm run cap:sync` — build + `npx cap sync android`.
- `npm run android:debug` / `android:release` / `android:bundle` — compilan el APK en `android/app/build/outputs/apk/debug/app-debug.apk`.
- `npm run version:bump` — incrementa `versionCode`/`versionName` en `android/app/build.gradle`.
- `npm run assets` — genera íconos/splash Android con `@capacitor/assets` desde `assets/`.

## Native Android
- AGP 8.13.0 → requiere **JDK 17** (21 recomendado). Gradle wrapper 8.14.3.
- `MainActivity.java`: modo inmersivo + reaplicación en `onWindowFocusChanged`; back button manejado en JS vía `@capacitor/app` (`App.addListener('backButton')`).
- `AndroidManifest.xml`: `screenOrientation="sensorLandscape"` + permiso `INTERNET`.
- `capacitor.config.json` (no `.ts`: `@capacitor/cli` v8 es CJS y este proyecto es `"type":"module"`).

## Convenciones JS
- Store principal: `src/store/useOrderStore.js`, `useCartStore`, `useTableStore`, `useAuthStore` (Zustand).
- Cliente Supabase: `src/lib/supabase.js` (solo anon key; persistSession + autoRefreshToken).
- Moneda/hora: `src/lib/format.js` (`formatMXN`). Texto UI en es-MX.
- Commits pequeños, por área (ver guía de commits en contexto).
