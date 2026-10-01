import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Login from './pages/Login'
import POS from './pages/POS'
import Kitchen from './pages/Kitchen'
import Admin from './pages/Admin'
import Cashier from './pages/Cashier'
import Tables from './pages/Tables'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/pos" element={<POS />} />
        <Route path="/tables" element={<Tables />} />
        <Route path="/caja" element={<Cashier />} />
        <Route path="/kitchen" element={<Kitchen />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
