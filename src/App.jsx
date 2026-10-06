import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { useBackButton } from './hooks/useBackButton'
import ConnectionBadge from './components/ui/ConnectionBadge'
import Login from './pages/Login'
import POS from './pages/POS'
import Kitchen from './pages/Kitchen'
import Admin from './pages/Admin'
import Cashier from './pages/Cashier'
import Tables from './pages/Tables'

function LayoutShell({ children }) {
  useBackButton()
  return (
    <>
      {children}
      <ConnectionBadge />
    </>
  )
}

function ViewportLock() {
  const location = useLocation()

  useEffect(() => {
    // Cada navegación táctil en una tablet POS puede quedar pillada por el
    // zoom de webkit; forzamos el viewport a escala 1 para evitar saltos.
    const vp = document.querySelector('meta[name="viewport"]')
    if (vp) {
      const c = vp.getAttribute('content') || ''
      const sinZoom = c.replace(/user-scalable=[^,]+/, 'user-scalable=no')
      vp.setAttribute('content', sinZoom)
    }
  }, [location.pathname])

  return null
}

export default function App() {
  return (
    <HashRouter>
      <div className="w-full overflow-x-hidden">
        <ViewportLock />
        <Routes>
        <Route
          path="/"
          element={
            <LayoutShell>
              <Login />
            </LayoutShell>
          }
        />
        <Route
          path="/pos"
          element={
            <LayoutShell>
              <POS />
            </LayoutShell>
          }
        />
        <Route
          path="/tables"
          element={
            <LayoutShell>
              <Tables />
            </LayoutShell>
          }
        />
        <Route
          path="/caja"
          element={
            <LayoutShell>
              <Cashier />
            </LayoutShell>
          }
        />
        <Route
          path="/kitchen"
          element={
            <LayoutShell>
              <Kitchen />
            </LayoutShell>
          }
        />
        <Route
          path="/admin"
          element={
            <LayoutShell>
              <Admin />
            </LayoutShell>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </div>
    </HashRouter>
  )
}
