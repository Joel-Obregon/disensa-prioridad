import { Navigate, Route, Routes } from 'react-router'
import Login from './pages/Login'
import ConsultaPedido from './pages/ConsultaPedido'
import Dashboard from './pages/Dashboard'
import Inventario from './pages/Inventario'
import Pedidos from './pages/Pedidos'
import Reglas from './pages/Reglas'
import Alertas from './pages/Alertas'
import Reportes from './pages/Reportes'
import Calendario from './pages/Calendario'
import Usuarios from './pages/Usuarios'
import EstadoSistema from './pages/EstadoSistema'
import MainLayout from './components/MainLayout'
import ProtectedRoute from './auth/ProtectedRoute'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/consulta-pedido" element={<ConsultaPedido />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<MainLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/materiales" element={<Navigate to="/inventario" replace />} />
          <Route path="/inventario" element={<Inventario />} />
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/calendario" element={<Calendario />} />
          <Route path="/reglas" element={<Reglas />} />
          <Route path="/alertas" element={<Alertas />} />
          <Route path="/reportes" element={<Reportes />} />
          <Route path="/estado-sistema" element={<EstadoSistema />} />
          <Route path="/usuarios" element={<Usuarios />} />
        </Route>
      </Route>
    </Routes>
  )
}
