import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './authState'
import { puedeAcceder, rutaInicialPorRol } from './permisos'

export default function ProtectedRoute() {
  const { cargando, perfil, session } = useAuth()
  const location = useLocation()

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600">
        Validando sesion...
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (!perfil) {
    return <Navigate to="/login" replace state={{ error: 'sin_perfil' }} />
  }

  if (!puedeAcceder(perfil.rol, location.pathname)) {
    return <Navigate to={rutaInicialPorRol(perfil.rol)} replace />
  }

  return <Outlet />
}
