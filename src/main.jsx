import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initApp } from './bootstrap'
import './index.css'
import App from './App.jsx'

const rootEl = document.getElementById('root')

initApp()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[bootstrap] falló la inicialización nativa/auth:', err)
  })
  .finally(() => {
    createRoot(rootEl).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
