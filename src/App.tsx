import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import MainLayout from './components/MainLayout'
import ProtectedRoute from './auth/ProtectedRoute'
import { ConfirmacionProvider } from './components/ConfirmacionProvider'

const Login = lazy(() => import('./pages/Login'))
const ConsultaPedido = lazy(() => import('./pages/ConsultaPedido'))
const RestablecerContrasena = lazy(() => import('./pages/RestablecerContrasena'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Inventario = lazy(() => import('./pages/Inventario'))
const Pedidos = lazy(() => import('./pages/Pedidos'))
const Reposicion = lazy(() => import('./pages/Reposicion'))
const Reglas = lazy(() => import('./pages/Reglas'))
const Alertas = lazy(() => import('./pages/Alertas'))
const Reportes = lazy(() => import('./pages/Reportes'))
const Calendario = lazy(() => import('./pages/Calendario'))
const Usuarios = lazy(() => import('./pages/Usuarios'))
const EstadoSistema = lazy(() => import('./pages/EstadoSistema'))

export default function App() {
  return (
    <ConfirmacionProvider>
      <Suspense fallback={<CargandoRuta />}>
        <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/consulta-pedido" element={<ConsultaPedido />} />
        <Route path="/restablecer-contrasena" element={<RestablecerContrasena />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<MainLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/materiales" element={<Navigate to="/inventario" replace />} />
            <Route path="/inventario" element={<Inventario />} />
            <Route path="/pedidos" element={<Pedidos />} />
            <Route path="/reposicion" element={<Reposicion />} />
            <Route path="/calendario" element={<Calendario />} />
            <Route path="/reglas" element={<Reglas />} />
            <Route path="/alertas" element={<Alertas />} />
            <Route path="/reportes" element={<Reportes />} />
            <Route path="/estado-sistema" element={<EstadoSistema />} />
            <Route path="/usuarios" element={<Usuarios />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </ConfirmacionProvider>
  )
}

function CargandoRuta() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#f9f4f2] text-sm font-semibold text-[#c8102e] dark:bg-[#0f0f10]">
      Cargando modulo...
    </div>
  )
}
