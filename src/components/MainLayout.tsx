import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarDays,
  DatabaseZap,
  LogOut,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
} from 'lucide-react'
import disensaLogo from '../assets/disensa-logo.svg'
import { useAuth } from '../auth/authState'
import { describirRol, puedeAcceder } from '../auth/permisos'
import {
  escucharAlertasNoRevisadas,
  limpiarAlertasNoRevisadas,
  obtenerAlertasNoRevisadas,
} from '../lib/alertNotifications'
import RealtimeAlertToast from './RealtimeAlertToast'
import ThemeToggle from './ThemeToggle'

const menu = [
  { nombre: 'Dashboard', ruta: '/dashboard', icono: BarChart3 },
  { nombre: 'Pedidos', ruta: '/pedidos', icono: Truck },
  { nombre: 'Inventario', ruta: '/inventario', icono: Boxes },
  { nombre: 'Alertas', ruta: '/alertas', icono: AlertTriangle },
  { nombre: 'Reglas', ruta: '/reglas', icono: SlidersHorizontal },
  { nombre: 'Reportes', ruta: '/reportes', icono: ScrollText },
  { nombre: 'Calendario', ruta: '/calendario', icono: CalendarDays },
  { nombre: 'Estado del sistema', ruta: '/estado-sistema', icono: DatabaseZap },
  { nombre: 'Usuarios', ruta: '/usuarios', icono: ShieldCheck },
]

export default function MainLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { cerrarSesion: cerrarSesionAuth, perfil, user } = useAuth()
  const [alertasNoRevisadas, setAlertasNoRevisadas] = useState(obtenerAlertasNoRevisadas)
  const menuVisible = menu.filter((item) => puedeAcceder(perfil?.rol, item.ruta))
  const paginaActiva = menu.find((item) => location.pathname.startsWith(item.ruta))

  useEffect(() => escucharAlertasNoRevisadas(setAlertasNoRevisadas), [])

  useEffect(() => {
    if (location.pathname.startsWith('/alertas')) {
      limpiarAlertasNoRevisadas()
    }
  }, [location.pathname])

  async function cerrarSesion() {
    await cerrarSesionAuth()
    navigate('/login')
  }

  return (
    <div className="app-shell min-h-screen bg-[#fbf8ff] text-[#1a1b22]">
      <aside className="app-sidebar border-b border-[#d8d2df] bg-white/85 p-4 backdrop-blur lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:h-screen lg:w-[260px] lg:flex-col lg:border-b-0 lg:border-r lg:p-5">
        <div className="flex items-center gap-3 lg:block">
          <img
            src={disensaLogo}
            alt="Disensa"
            className="app-brand-logo h-10 w-10 rounded-lg bg-white object-contain ring-1 ring-[#e5dde9] lg:mb-3 lg:h-12 lg:w-12"
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#0f0f11]">Disensa Prioridad</h1>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#4c4546]">
              Logistics Management
            </p>
          </div>
        </div>

        {perfil && (
          <div className="app-role-card mt-4 hidden rounded border border-[#e4e4e7] bg-[#f7f7f8] px-3 py-2 lg:block">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#767676]">
              Rol activo
            </p>
            <p className="mt-1 text-sm font-semibold text-[#1a1a1a]">{perfil.rol}</p>
          </div>
        )}

        <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:mt-8 lg:block lg:flex-1 lg:space-y-1 lg:overflow-visible lg:pb-0">
          {menuVisible.map((item) => {
            const Icono = item.icono

            return (
              <NavLink
                key={item.ruta}
                to={item.ruta}
                className={({ isActive }) =>
                  `group relative flex shrink-0 items-center gap-3 rounded px-3 py-2.5 text-sm font-medium outline-none ring-orange-200 focus-visible:ring-2 lg:px-4 ${
                    isActive
                      ? 'border-r-4 border-[#a33e00] bg-[#eeeeee] text-[#a33e00]'
                      : 'text-[#3f3f46] hover:bg-[#f1effa] hover:text-[#111111]'
                  }`
                }
              >
                <Icono size={20} strokeWidth={2} />
                <span>{item.nombre}</span>
                {item.ruta === '/alertas' && alertasNoRevisadas.length > 0 && (
                  <span className="absolute right-2 top-1/2 flex h-3 w-3 -translate-y-1/2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>

        <div className="app-user-footer mt-4 hidden border-t border-[#e4e4e7] pt-4 lg:mt-auto lg:block">
          <div className="mb-3 flex items-center gap-3">
            <div className="app-avatar flex h-10 w-10 items-center justify-center rounded-full bg-black text-xs font-bold text-white">
              {(perfil?.nombre || user?.email || 'U').slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#1a1a1a]">
                {perfil?.nombre || user?.email || 'Usuario'}
              </p>
              <p className="truncate text-xs text-[#69636d]">
                {perfil ? describirRol(perfil.rol) : 'Usuario interno'}
              </p>
            </div>
          </div>
          <button
            onClick={cerrarSesion}
            className="app-logout-button flex w-full items-center gap-3 rounded border border-[#d7d7db] bg-white px-3 py-2 text-sm font-semibold text-[#3f3f46] hover:bg-[#f7f7f8] hover:text-[#111111]"
          >
            <LogOut size={18} />
            Cerrar sesion
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 lg:ml-[260px]">
        <header className="app-header sticky top-0 z-20 flex min-h-16 items-center justify-between gap-4 border-b border-[#d8d2df] bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
          <h2 className="app-page-title hidden text-xl font-bold tracking-tight text-[#0f0f11] sm:block">
            {paginaActiva?.nombre || 'Disensa Prioridad'}
          </h2>

          <div className="flex-1" />

          <div className="flex items-center gap-2 text-[#1a1a1a]">
            <RealtimeAlertToast />
            <ThemeToggle className="hidden sm:inline-flex" />
            <span className="hidden items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 md:inline-flex">
              <span className="h-2 w-2 rounded-full bg-green-600" />
              En linea
            </span>
          </div>
        </header>

        <section className="animate-surface-in p-4 sm:p-6">
          <Outlet />
        </section>
      </main>
    </div>
  )
}
