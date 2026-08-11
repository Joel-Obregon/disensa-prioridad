import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import {
  PackagePlus,
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
import { useAuth } from '../auth/authState'
import { describirRol, puedeAcceder } from '../auth/permisos'
import {
  escucharAlertasNoRevisadas,
  limpiarAlertasNoRevisadas,
  obtenerAlertasNoRevisadas,
} from '../lib/alertNotifications'
import {
  agregarReporteNoRevisado,
  escucharReportesNoRevisados,
  limpiarReportesNoRevisados,
  obtenerReportesNoRevisados,
  quitarReporteNoRevisado,
  type ReporteNoRevisado,
} from '../lib/reportNotifications'
import { supabase } from '../services/supabaseClient'
import { obtenerReglas } from '../services/reglasService'
import {
  esAlertaDeReporte,
  leerAlertasReportesHabilitadas,
  leerRecordatorioMinutos,
} from '../lib/reglasAlertas'
import type { Alerta } from '../types/alerta'
import RealtimeAlertToast from './RealtimeAlertToast'
import ThemeToggle from './ThemeToggle'

const menu = [
  { nombre: 'Dashboard', ruta: '/dashboard', icono: BarChart3 },
  { nombre: 'Pedidos', ruta: '/pedidos', icono: Truck },
  { nombre: 'Reposición', ruta: '/reposicion', icono: PackagePlus },
  { nombre: 'Inventario', ruta: '/inventario', icono: Boxes },
  { nombre: 'Alertas', ruta: '/alertas', icono: AlertTriangle },
  { nombre: 'Reglas', ruta: '/reglas', icono: SlidersHorizontal },
  { nombre: 'Reportes', ruta: '/reportes', icono: ScrollText },
  { nombre: 'Calendario', ruta: '/calendario', icono: CalendarDays },
  { nombre: 'Estado del sistema', ruta: '/estado-sistema', icono: DatabaseZap },
  { nombre: 'Usuarios', ruta: '/usuarios', icono: ShieldCheck },
]

const disensaLogo = '/disensa-holcim-logo-source.png'

export default function MainLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { cerrarSesion: cerrarSesionAuth, perfil, user } = useAuth()
  const [alertasNoRevisadas, setAlertasNoRevisadas] = useState(obtenerAlertasNoRevisadas)
  const [reportesNoRevisados, setReportesNoRevisados] = useState(obtenerReportesNoRevisados)
  const [segundosTitileo, setSegundosTitileo] = useState(30)
  const [titilando, setTitilando] = useState(true)
  const [alertasReportesHabilitadas, setAlertasReportesHabilitadas] = useState(true)
  const menuVisible = menu.filter((item) => puedeAcceder(perfil?.rol, item.ruta))
  const nivelReportePendiente = nivelMasCriticoReporte(reportesNoRevisados)

  useEffect(() => escucharAlertasNoRevisadas(setAlertasNoRevisadas), [])
  useEffect(() => escucharReportesNoRevisados(setReportesNoRevisados), [])

  // Las reglas se actualizan en tiempo real: una controla el recordatorio del
  // menu Alertas y otra permite activar/desactivar los avisos de reportes.
  useEffect(() => {
    let activo = true
    const cargarReglas = () =>
      obtenerReglas().then((resultado) => {
        if (!activo || resultado.error) return
        const reglas = resultado.data || []
        const minutos = leerRecordatorioMinutos(reglas)
        setSegundosTitileo(minutos > 0 ? minutos * 60 : 0)
        setAlertasReportesHabilitadas(leerAlertasReportesHabilitadas(reglas))
      })

    void cargarReglas()
    const channel = supabase
      .channel('reglas-alertas-reportes-menu')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reglas_negocio' },
        () => void cargarReglas(),
      )
      .subscribe()

    return () => {
      activo = false
      supabase.removeChannel(channel)
    }
  }, [])

  // Titileo periodico mientras haya alertas pendientes (setState solo en timers).
  useEffect(() => {
    if (alertasNoRevisadas.length === 0 || segundosTitileo <= 0) return
    const parpadear = () => {
      setTitilando(true)
      window.setTimeout(() => setTitilando(false), 1500)
    }
    const inicial = window.setTimeout(parpadear, 100)
    const intervalo = window.setInterval(parpadear, segundosTitileo * 1000)
    return () => {
      window.clearTimeout(inicial)
      window.clearInterval(intervalo)
    }
  }, [alertasNoRevisadas.length, segundosTitileo])

  // Re-sincroniza por tiempo las alertas de retraso: cuando un pedido cruza de
  // tramo (verde, amarillo o rojo, o de vuelta) su alerta se actualiza y salta
  // via realtime, sin que nadie tenga que tocar el pedido.
  useEffect(() => {
    let activo = true
    const sincronizar = () => {
      if (!activo) return
      void supabase
        .rpc('sincronizar_alertas_retraso_pedidos')
        .then(undefined, () => undefined)
    }
    const arranque = window.setTimeout(sincronizar, 2000)
    const ciclo = window.setInterval(sincronizar, 180_000)
    return () => {
      activo = false
      window.clearTimeout(arranque)
      window.clearInterval(ciclo)
    }
  }, [])

  useEffect(() => {
    if (!alertasReportesHabilitadas) {
      limpiarReportesNoRevisados()
      return
    }

    const channel = supabase
      .channel('alertas-reportes-menu-tiempo-real')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'alertas',
        },
        (payload) => {
          const alerta = payload.new as Partial<Alerta>
          if (
            !alerta.id ||
            !esAlertaDeReporte({
              tipo_alerta: alerta.tipo_alerta || '',
              mensaje: alerta.mensaje || '',
            })
          ) {
            return
          }

          if (alerta.estado === 'cerrada') {
            quitarReporteNoRevisado(alerta.id)
            return
          }

          if (payload.eventType !== 'INSERT') return

          agregarReporteNoRevisado({
            id: alerta.id,
            nivel: nivelAlertaValido(alerta.nivel),
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [alertasReportesHabilitadas])

  useEffect(() => {
    if (location.pathname.startsWith('/alertas')) {
      limpiarAlertasNoRevisadas()
    }

    if (location.pathname.startsWith('/reportes')) {
      limpiarReportesNoRevisados()
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
            className="h-9 w-auto rounded object-contain lg:mb-3 lg:h-11"
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
                  `group relative flex shrink-0 items-center gap-3 rounded px-3 py-2.5 text-sm font-medium outline-none ring-red-200 focus-visible:ring-2 lg:px-4 ${
                    isActive
                      ? 'border-r-4 border-[#c8102e] bg-[#eeeeee] text-[#c8102e]'
                      : 'text-[#3f3f46] hover:bg-[#f1effa] hover:text-[#111111]'
                  }`
                }
              >
                <Icono size={20} strokeWidth={2} />
                <span>{item.nombre}</span>
                {item.ruta === '/alertas' && alertasNoRevisadas.length > 0 && (
                  <span className="absolute right-2 top-1/2 flex h-3 w-3 -translate-y-1/2">
                    {titilando && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                    )}
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
                  </span>
                )}
                {item.ruta === '/reportes' &&
                  alertasReportesHabilitadas &&
                  reportesNoRevisados.length > 0 && (
                  <span className="absolute right-2 top-1/2 flex h-3 w-3 -translate-y-1/2">
                    <span
                      className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${clasePulsoReporte(nivelReportePendiente)}`}
                    />
                    <span
                      className={`relative inline-flex h-3 w-3 rounded-full ${claseIndicadorReporte(nivelReportePendiente)}`}
                    />
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
        <header className="app-header pointer-events-none fixed right-4 top-3 z-40 flex justify-end sm:right-6">
          <div className="pointer-events-auto flex items-center gap-2 text-[#1a1a1a]">
            {perfil?.rol !== 'suministrador' && <RealtimeAlertToast />}
            <ThemeToggle className="hidden sm:inline-flex" />
            <span className="hidden items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 md:inline-flex">
              <span className="h-2 w-2 rounded-full bg-green-600" />
              En linea
            </span>
          </div>
        </header>

        <section className="animate-surface-in p-4 pt-20 sm:p-6 sm:pt-20">
          <Outlet />
        </section>
      </main>
    </div>
  )
}

function nivelAlertaValido(nivel: Alerta['nivel'] | undefined): Alerta['nivel'] {
  return ['informativa', 'media', 'alta', 'critica'].includes(nivel || '')
    ? (nivel as Alerta['nivel'])
    : 'informativa'
}

function nivelMasCriticoReporte(reportes: ReporteNoRevisado[]): Alerta['nivel'] {
  if (reportes.some((reporte) => reporte.nivel === 'critica')) return 'critica'
  if (reportes.some((reporte) => reporte.nivel === 'alta')) return 'alta'
  if (reportes.some((reporte) => reporte.nivel === 'media')) return 'media'
  return 'informativa'
}

function claseIndicadorReporte(nivel: Alerta['nivel']) {
  if (nivel === 'critica') return 'bg-red-600'
  if (nivel === 'alta' || nivel === 'media') return 'bg-yellow-500'
  return 'bg-green-500'
}

function clasePulsoReporte(nivel: Alerta['nivel']) {
  if (nivel === 'critica') return 'bg-red-500'
  if (nivel === 'alta' || nivel === 'media') return 'bg-yellow-400'
  return 'bg-green-400'
}
