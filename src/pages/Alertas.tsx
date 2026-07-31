import { useEffect, useMemo, useState } from 'react'
import {
  BellRing,
  CheckCircle2,
  Eye,
  Filter,
  PackageX,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react'
import {
  claseSemaforoBadge,
  claseSemaforoBarra,
  claseSemaforoBorde,
  describirTiempoPedido,
  resolverSemaforoPedido,
} from '../lib/semaforoOperativo'
import { registrarAuditoria } from '../services/auditoriaService'
import { useAuth } from '../auth/authState'
import { limpiarAlertasNoRevisadas } from '../lib/alertNotifications'
import {
  actualizarEstadoAlerta,
  escucharCambiosAlertas,
  obtenerAlertas,
} from '../services/alertasService'
import { obtenerInventarioOperativo } from '../services/inventarioService'
import { obtenerReglas } from '../services/reglasService'
import { leerVisibilidadAlertas } from '../lib/reglasAlertas'
import type { Alerta } from '../types/alerta'
import type { ReglaNegocio } from '../types/regla'
import type { SemaforoOperativo } from '../lib/semaforoOperativo'
import type { EstadoPedido } from '../types/pedido'

type AlertaVista = Alerta & { fusionadas?: string[] }

type CategoriaAlertas = 'materiales' | 'priorizacion'
type VistaAlertas = 'operativas' | 'historial'
type FiltrosAlertas = {
  busqueda: string
  fechaDesde: string
  fechaHasta: string
  material: string
  nivel: 'todos' | Alerta['nivel']
}

const categoriasAlertas = [
  {
    id: 'materiales',
    label: 'Falta de materiales',
    descripcion: 'Stock bajo, sin stock o reabastecimiento pendiente',
    icono: PackageX,
  },
  {
    id: 'priorizacion',
    label: 'Priorizacion de pedidos',
    descripcion: 'Reglas de negocio, urgencia, riesgo y despacho',
    icono: ShieldAlert,
  },
] satisfies Array<{
  id: CategoriaAlertas
  label: string
  descripcion: string
  icono: typeof BellRing
}>

const filtrosIniciales: FiltrosAlertas = {
  busqueda: '',
  fechaDesde: '',
  fechaHasta: '',
  material: 'todos',
  nivel: 'todos',
}

const vistas: Array<{ id: VistaAlertas; label: string }> = [
  { id: 'operativas', label: 'Operativas' },
  { id: 'historial', label: 'Historial' },
]

export default function Alertas() {
  const { perfil } = useAuth()
  const rolUsuario = perfil?.rol
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [reglas, setReglas] = useState<ReglaNegocio[]>([])
  const [categoria, setCategoria] = useState<CategoriaAlertas>('priorizacion')
  const [vista, setVista] = useState<VistaAlertas>('operativas')
  const [filtros, setFiltros] = useState<FiltrosAlertas>(filtrosIniciales)
  const [alertaDetalle, setAlertaDetalle] = useState<Alerta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  async function cargarAlertas({ silencioso = false }: { silencioso?: boolean } = {}) {
    if (!silencioso) setCargando(true)
    setError('')

    const [alertasResult, inventarioResult] = await Promise.all([
      obtenerAlertas({ sincronizarStock: !silencioso }),
      obtenerInventarioOperativo(),
    ])

    const { data, error } = alertasResult

    if (error) {
      setError(
        'No se pudo leer la tabla alertas. Revisa que exista en Supabase y que tenga permisos SELECT.'
      )
      setAlertas([])
      setCargando(false)
      return
    }

    // Falta de materiales: solo se muestran las alertas de stock cuyo material
    // existe en el modulo de inventario (misma lista del modulo Inventario).
    const llavesInventario = new Set<string>()
    ;(inventarioResult.data || []).forEach((material) => {
      if (material.id) llavesInventario.add(`id:${material.id}`)
      if (material.nombre) llavesInventario.add(`nombre:${normalizarTexto(material.nombre)}`)
      if (material.codigo_material) {
        llavesInventario.add(`codigo:${normalizarTexto(material.codigo_material)}`)
      }
    })

    const alertasVisibles =
      inventarioResult.error || llavesInventario.size === 0
        ? data || []
        : (data || []).filter(
            (alerta) => !esAlertaFaltaMaterial(alerta) || materialEnInventario(alerta, llavesInventario)
          )

    setAlertas(alertasVisibles)

    const reglasRes = await obtenerReglas()
    if (!reglasRes.error) setReglas(reglasRes.data || [])

    setCargando(false)
  }

  async function cambiarEstado(alerta: Alerta, estado: Alerta['estado']) {
    setError('')

    // Una tarjeta puede agrupar varias alertas del mismo pedido (retraso +
    // reporte): al cerrarla se cierran todas las alertas fusionadas.
    const ids = (alerta as AlertaVista).fusionadas?.length
      ? ((alerta as AlertaVista).fusionadas as string[])
      : [alerta.id]

    for (const id of ids) {
      const { error } = await actualizarEstadoAlerta(id, estado)
      if (error) {
        setError(error.message)
        return
      }
    }

    await registrarAuditoria({
      entidad: 'alertas',
      entidad_id: alerta.id,
      accion: `alerta_${estado}`,
      detalle: `${alerta.tipo_alerta}: ${alerta.mensaje}`,
    })

    cargarAlertas({ silencioso: true })
  }

  useEffect(() => {
    limpiarAlertasNoRevisadas()

    const timer = window.setTimeout(cargarAlertas, 0)
    let refrescoTimer: number | undefined
    const dejarDeEscuchar = escucharCambiosAlertas(() => {
      if (refrescoTimer) window.clearTimeout(refrescoTimer)
      refrescoTimer = window.setTimeout(() => {
        cargarAlertas({ silencioso: true })
      }, 300)
    })

    return () => {
      window.clearTimeout(timer)
      if (refrescoTimer) window.clearTimeout(refrescoTimer)
      dejarDeEscuchar()
    }
  }, [])

  // Regla parametrizable: que alertas se muestran (por color y por categoria).
  const visibilidad = useMemo(() => leerVisibilidadAlertas(reglas), [reglas])
  const categoriasVisibles = useMemo(
    () =>
      categoriasAlertas.filter((item) =>
        item.id === 'materiales' ? visibilidad.materiales : visibilidad.pedidos,
      ),
    [visibilidad],
  )

  const categoriaActiva: CategoriaAlertas = categoriasVisibles.some((item) => item.id === categoria)
    ? categoria
    : categoriasVisibles[0]?.id ?? categoria

  const conteoCategorias = useMemo(() => {
    const operativas = alertas.filter(alertaOperativa)
    return {
      // Materiales en semaforo rojo/amarillo (alertas de stock activas).
      materiales: operativas.filter(esAlertaFaltaMaterial).length,
      priorizacion: fusionarAlertasPorPedido(
        operativas.filter(
          (alerta) => !esAlertaFaltaMaterial(alerta) && esAlertaPriorizacionPedido(alerta)
        )
      ).length,
    }
  }, [alertas])

  // El suministrador solo ve alertas ligadas a pedidos (no de materiales/stock).
  const alertasRol = useMemo(() => {
    if (rolUsuario !== 'suministrador') return alertas
    return alertas.filter(esAlertaDePedido)
  }, [alertas, rolUsuario])

  const alertasPorCategoria = useMemo(() => {
    if (categoriaActiva === 'materiales') {
      // Falta de materiales = solo alertas de stock (semaforo rojo y amarillo),
      // sin reposiciones del suministrador.
      return alertasRol.filter(
        (alerta) => esAlertaFaltaMaterial(alerta) && alerta.nivel !== 'informativa'
      )
    }

    return alertasRol.filter(
      (alerta) => !esAlertaFaltaMaterial(alerta) && esAlertaPriorizacionPedido(alerta)
    )
  }, [alertasRol, categoriaActiva])

  const materialesFiltro = useMemo(() => {
    const materiales = alertasRol
      .map(materialAlerta)
      .filter((material): material is string => Boolean(material))

    return [...new Set(materiales)].sort((a, b) => a.localeCompare(b))
  }, [alertasRol])

  const alertasFiltradas = useMemo(() => {
    const tokens = normalizarTexto(filtros.busqueda)
      .split(/\s+/)
      .filter(Boolean)

    return alertasPorCategoria.filter((alerta) => {
      const material = materialAlerta(alerta)
      const textoCompleto = normalizarTexto(
        [
          alerta.tipo_alerta,
          alerta.mensaje,
          alerta.pedido_codigo || '',
          alerta.pedido_estado || '',
          material || '',
          alerta.responsable || '',
        ].join(' ')
      )
      const coincideTexto =
        tokens.length === 0 || tokens.every((token) => textoCompleto.includes(token))
      const coincideNivel = filtros.nivel === 'todos' || alerta.nivel === filtros.nivel
      const coincideMaterial =
        filtros.material === 'todos' ||
        normalizarTexto(material || '') === normalizarTexto(filtros.material)
      const coincideFecha = filtrarPorFecha(
        alerta.created_at,
        filtros.fechaDesde,
        filtros.fechaHasta
      )

      const coincideColor = alerta.nivel === 'critica' ? visibilidad.rojas : visibilidad.amarillas

      return coincideTexto && coincideNivel && coincideMaterial && coincideFecha && coincideColor
    })
  }, [alertasPorCategoria, filtros, visibilidad])

  const alertasOperativas = useMemo(
    () =>
      alertasFiltradas
        .filter(alertaOperativa)
        .sort(ordenarPorCriticidad),
    [alertasFiltradas]
  )

  const alertasVisibles = useMemo(() => {
    const base =
      vista === 'operativas'
        ? alertasOperativas
        : alertasFiltradas
            .filter((alerta) => !alertaOperativa(alerta))
            .sort(ordenarPorFechaReciente)
    return fusionarAlertasPorPedido(base)
  }, [alertasFiltradas, alertasOperativas, vista])

  const resumen = useMemo(() => {
    if (categoriaActiva === 'materiales') {
      const operativas = alertasPorCategoria.filter(alertaOperativa).length
      return [
        {
          titulo: 'Materiales en semaforo rojo y amarillo',
          valor: operativas,
          detalle: 'Stock bajo o sin cobertura, segun el semaforo de inventario',
          icono: PackageX,
          clase: 'border-orange-200 bg-orange-50 text-orange-700',
        },
      ]
    }
    const operativas = alertasPorCategoria.filter(alertaOperativa).length
    return [
      {
        titulo: 'Operativas',
        valor: operativas,
        detalle: 'Ordenadas por criticidad',
        icono: BellRing,
        clase: 'border-orange-200 bg-orange-50 text-orange-700',
      },
    ]
  }, [alertasPorCategoria, categoriaActiva])

  const seccionesAlertas = useMemo(() => {
    if (vista === 'historial') {
      return [
        {
          id: 'historial',
          titulo: 'Historial de alertas resueltas',
          detalle:
            'Alertas cerradas por el equipo o por sincronizacion automatica. Se conservan sin borrado por tiempo.',
          icono: CheckCircle2,
          alertas: alertasVisibles,
        },
      ]
    }

    const criticas = alertasVisibles.filter((alerta) => ['critico', 'alto'].includes(semaforoAlerta(alerta)))
    const riesgo = alertasVisibles.filter((alerta) => semaforoAlerta(alerta) === 'riesgo')
    const seguimiento = alertasVisibles.filter((alerta) => semaforoAlerta(alerta) === 'a_tiempo')

    return [
      ...(criticas.length > 0
        ? [
            {
              id: 'criticas',
              titulo: 'Criticidad alta',
              detalle: 'Primero se atienden las alertas con riesgo operativo inmediato.',
              icono: ShieldAlert,
              alertas: criticas,
            },
          ]
        : []),
      ...(riesgo.length > 0
        ? [
            {
              id: 'riesgo',
              titulo: 'En riesgo',
              detalle: 'Alertas que requieren seguimiento durante la jornada.',
              icono: BellRing,
              alertas: riesgo,
            },
          ]
        : []),
      ...(seguimiento.length > 0
        ? [
            {
              id: 'seguimiento',
              titulo: 'Seguimiento',
              detalle: 'Alertas informativas o de baja urgencia.',
              icono: CheckCircle2,
              alertas: seguimiento,
            },
          ]
        : []),
    ]
  }, [alertasVisibles, vista])

  return (
    <div className="alertas-module space-y-5">
      <div className="flex flex-col gap-4 border-b border-[#d8d2df] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#a33e00]">
            <ShieldAlert size={16} />
            Centro de alertas visuales
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#0f0f11]">Alertas operativas</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#5f5964]">
            Priorizacion visual de stock, pedidos urgentes, retrasos y novedades de despacho.
          </p>
        </div>

        <button
          onClick={() => cargarAlertas()}
          className="inline-flex items-center justify-center gap-2 border border-[#c99582] bg-white px-4 py-2.5 text-sm font-semibold uppercase tracking-[0.08em] text-[#2b160f] transition hover:bg-[#fff1eb]"
        >
          <RefreshCw size={16} />
          Actualizar
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {resumen.map((item) => {
          const Icono = item.icono

          return (
            <article key={item.titulo} className={`alertas-kpi border-l-4 bg-white p-5 ${item.clase}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em]">{item.titulo}</p>
                  <strong className="font-tabular mt-4 block text-4xl">{cargando ? '-' : item.valor}</strong>
                </div>
                <span className="alertas-kpi-icon inline-flex h-11 w-11 items-center justify-center text-[#a33e00]">
                  <Icono size={23} />
                </span>
              </div>
              <p className="mt-3 text-sm opacity-85">{item.detalle}</p>
            </article>
          )
        })}
      </div>

      <section className="alertas-panel border border-[#d8d2df] bg-white p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.1em] text-[#3f3f46]">
          <ShieldAlert size={18} className="text-orange-600" />
          Tipo de alerta
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {categoriasVisibles.map((item) => {
            const Icono = item.icono
            const activo = categoriaActiva === item.id

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCategoria(item.id)}
                className={`alertas-choice flex min-h-24 items-start justify-between gap-3 border p-4 text-left transition ${
                  activo
                    ? 'border-[#a33e00] bg-[#261812] text-white'
                    : 'border-[#e3d6d0] bg-[#fffaf7] text-[#261812] hover:border-[#c99582] hover:bg-[#fff1eb]'
                }`}
              >
                <span className="flex min-w-0 gap-3">
                  <span
                    className={`mt-1 p-2 ${
                      activo ? 'bg-white/10 text-white' : 'bg-[#fdece5] text-[#a33e00]'
                    }`}
                  >
                    <Icono size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{item.label}</span>
                    <span className={`mt-1 block text-sm ${activo ? 'text-white/75' : 'text-slate-500'}`}>
                      {item.descripcion}
                    </span>
                  </span>
                </span>
                <span
                  className={`px-3 py-1 text-xs font-semibold ${
                    activo ? 'bg-white text-[#261812]' : 'bg-white text-[#6d2b12]'
                  }`}
                >
                  {conteoCategorias[item.id]}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="alertas-panel border border-[#d8d2df] bg-white p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.1em] text-[#3f3f46]">
          <Filter size={18} className="text-orange-600" />
          Vista
        </div>
        <div className="flex flex-wrap gap-2">
          {vistas.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setVista(item.id)}
              className={`px-4 py-2 text-sm font-semibold transition ${
                vista === item.id
                  ? 'bg-[#261812] text-white'
                  : 'border border-[#dfad9c] bg-white text-[#3f2d25] hover:bg-[#fff1eb]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="alertas-panel border border-[#d8d2df] bg-white p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.1em] text-[#3f3f46]">
          <Search size={18} className="text-orange-600" />
          Filtros
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="block text-sm font-medium text-[#3f2d25] xl:col-span-1">
            Buscar
            <input
              value={filtros.busqueda}
              onChange={(event) => setFiltros({ ...filtros, busqueda: event.target.value })}
              placeholder="Pedido, material o mensaje"
              className="mt-1 w-full border-2 border-[#ed1c24] px-3 py-2 outline-none focus:ring-1 focus:ring-[#a33e00]"
            />
          </label>

          <label className="block text-sm font-medium text-[#3f2d25]">
            Material
            <select
              value={filtros.material}
              onChange={(event) => setFiltros({ ...filtros, material: event.target.value })}
              className="mt-1 w-full border border-[#dfad9c] bg-white px-3 py-2 outline-none focus:ring-1 focus:ring-[#a33e00]"
            >
              <option value="todos">Sin filtro</option>
              {materialesFiltro.map((material) => (
                <option key={material} value={material}>
                  {material}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-[#3f2d25]">
            Desde
            <input
              type="date"
              value={filtros.fechaDesde}
              onChange={(event) => setFiltros({ ...filtros, fechaDesde: event.target.value })}
              className="mt-1 w-full border border-[#dfad9c] bg-white px-3 py-2 outline-none focus:ring-1 focus:ring-[#a33e00]"
            />
          </label>

          <label className="block text-sm font-medium text-[#3f2d25]">
            Hasta
            <input
              type="date"
              value={filtros.fechaHasta}
              onChange={(event) => setFiltros({ ...filtros, fechaHasta: event.target.value })}
              className="mt-1 w-full border border-[#dfad9c] bg-white px-3 py-2 outline-none focus:ring-1 focus:ring-[#a33e00]"
            />
          </label>

          <label className="block text-sm font-medium text-[#3f2d25]">
            Nivel
            <select
              value={filtros.nivel}
              onChange={(event) =>
                setFiltros({ ...filtros, nivel: event.target.value as FiltrosAlertas['nivel'] })
              }
              className="mt-1 w-full border border-[#dfad9c] bg-white px-3 py-2 outline-none focus:ring-1 focus:ring-[#a33e00]"
            >
              <option value="todos">Sin filtro</option>
              <option value="critica">Critica</option>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="informativa">Informativa</option>
            </select>
          </label>

        </div>
      </section>

      <div className="space-y-4">
        {cargando && (
          <p className="border border-[#d8d2df] bg-white p-6 text-[#5f5964]">
            Cargando alertas...
          </p>
        )}

        {!cargando && alertasVisibles.length > 0 && seccionesAlertas.map((seccion) => (
            <section
              key={seccion.id}
              className="alertas-panel overflow-hidden border border-[#d8d2df] bg-white"
            >
              <div className="flex flex-col gap-3 border-b border-[#eadbd6] bg-[#fffaf7] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="alertas-section-icon inline-flex h-10 w-10 items-center justify-center text-[#a33e00]">
                    <seccion.icono size={20} />
                  </span>
                  <div>
                    <h2 className="font-semibold text-[#0f0f11]">{seccion.titulo}</h2>
                    <p className="mt-1 text-sm text-[#5f5964]">{seccion.detalle}</p>
                  </div>
                </div>
                <span className="w-fit bg-[#261812] px-3 py-1 text-xs font-semibold text-white">
                  {seccion.alertas.length} alertas
                </span>
              </div>

              {seccion.alertas.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">
                  No hay alertas en este grupo.
                </p>
              ) : (
                <div className="space-y-3 p-4">
                  {seccion.alertas.map((alerta) => (
                    <TarjetaAlerta
                      key={alerta.id}
                      alerta={alerta}
                      onCerrar={(alertaSeleccionada) => cambiarEstado(alertaSeleccionada, 'cerrada')}
                      onVerDetalle={setAlertaDetalle}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}

        {!cargando && alertasVisibles.length === 0 && (
          <p className="border border-dashed border-[#d8d2df] bg-white p-8 text-center text-[#5f5964]">
            No hay alertas en esta vista.
          </p>
        )}
      </div>

      {alertaDetalle && (
        <DetalleAlerta alerta={alertaDetalle} onClose={() => setAlertaDetalle(null)} />
      )}
    </div>
  )
}

function TarjetaAlerta({
  alerta,
  onCerrar,
  onVerDetalle,
}: {
  alerta: Alerta
  onCerrar: (alerta: Alerta) => void
  onVerDetalle: (alerta: Alerta) => void
}) {
  const tiempoPedido = tiempoPedidoAlerta(alerta)

  return (
    <article className={`alerta-card relative overflow-hidden border bg-white p-5 pl-6 ${bordeAlerta(alerta)}`}>
      <span
        aria-hidden="true"
        className={`alerta-card-rail absolute left-0 top-5 h-[calc(100%-2.5rem)] w-1 ${colorRailAlerta(alerta)}`}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <span className={`alerta-card-icon mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center ${fondoIcono(alerta)}`}>
            <BellRing size={20} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-[#111111]">
                {formatearEtiqueta(alerta.tipo_alerta || 'alerta_visual')}
              </h2>
              <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${colorNivel(alerta.nivel)}`}>
                {alerta.nivel || 'informativa'}
              </span>
              <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${colorEstado(alertaOperativa(alerta) ? alerta.estado : 'cerrada')}`}>
                {etiquetaEstadoAlerta(alerta.estado, alerta)}
              </span>
            </div>
            <p className="mt-2 max-w-5xl text-sm leading-6 text-[#4c4546]">
              {alerta.mensaje || 'Alerta sin mensaje registrado.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="alerta-chip bg-[#f4ebe7] px-3 py-1 font-semibold text-[#6d2b12]">
                {tiempoDesde(alerta.created_at)}
              </span>
              {tiempoPedido && (
                <span className={`alerta-chip px-3 py-1 font-semibold ${colorTiempoPedido(alerta)}`}>
                  Pedido asociado: {tiempoPedido}
                </span>
              )}
              {alerta.pedido_codigo && (
                <span className="alerta-chip bg-blue-50 px-3 py-1 font-semibold text-blue-700">
                  Pedido #{alerta.pedido_codigo}
                </span>
              )}
              {alerta.pedido_estado && (
                <span className="alerta-chip bg-[#f4ebe7] px-3 py-1 font-semibold text-[#6d2b12]">
                  Estado pedido: {formatearEtiqueta(alerta.pedido_estado)}
                </span>
              )}
              {alerta.pedido_material && (
                <span className="alerta-chip bg-amber-50 px-3 py-1 font-semibold text-amber-700">
                  Material: {alerta.pedido_material}
                </span>
              )}
              {alerta.responsable && (
                <span className="alerta-chip bg-purple-50 px-3 py-1 font-semibold text-purple-700">
                  Responsable: {alerta.responsable}
                </span>
              )}
              {typeof alerta.dias_sin_gestion === 'number' && (
                <span className="alerta-chip bg-red-50 px-3 py-1 font-semibold text-red-700">
                  {alerta.dias_sin_gestion}+ dias sin gestion
                </span>
              )}
            </div>
            <p className="mt-3 text-xs font-medium text-[#69636d]">
              {describirAlerta(alerta)}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${claseSemaforoBarra(semaforoAlerta(alerta))}`} />
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {esAlertaPriorizacionPedido(alerta) && (
          <button
            type="button"
            onClick={() => onVerDetalle(alerta)}
            className="alerta-action-button inline-flex items-center gap-2 border border-[#e3bfb1] px-3 py-2 text-xs font-semibold text-[#a33e00] transition hover:bg-[#fff1ec]"
          >
            <Eye size={14} />
            Ver detalle
          </button>
        )}
        <button
          type="button"
          disabled={alerta.estado === 'cerrada'}
          onClick={() => onCerrar(alerta)}
          className="alerta-action-button inline-flex items-center gap-2 border border-green-200 px-3 py-2 text-xs font-semibold text-green-700 transition hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckCircle2 size={14} />
          Cerrar alerta
        </button>
      </div>
    </article>
  )
}

function DetalleAlerta({ alerta, onClose }: { alerta: Alerta; onClose: () => void }) {
  const cantidadOperativa = cantidadOperativaAlerta(alerta)
  const unidad = alerta.pedido_unidad_medida || ''
  const stockDisponible = alerta.pedido_stock_disponible
  const stockPosterior =
    typeof stockDisponible === 'number' && typeof cantidadOperativa === 'number'
      ? stockDisponible - cantidadOperativa
      : null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm">
      <section className="alertas-modal mt-10 w-full max-w-5xl bg-white shadow-2xl">
        <div className="flex flex-col gap-3 border-b border-[#eadbd6] bg-[#fffaf7] p-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#a33e00]">Detalle de alerta</p>
            <h2 className="mt-1 text-2xl font-bold text-[#0f0f11]">
              {formatearEtiqueta(alerta.tipo_alerta || 'alerta_visual')}
            </h2>
            <p className="mt-1 text-sm text-[#5f5964]">{tiempoDesde(alerta.created_at)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-[#dfad9c] bg-white px-4 py-2 text-sm font-semibold text-[#3f2d25] transition hover:bg-[#fff1eb]"
          >
            Cerrar
          </button>
        </div>

        <div className="grid gap-6 p-5 xl:grid-cols-[1fr_0.8fr]">
          <div className="space-y-5">
            <section className="border border-[#eadbd6] p-4">
              <h3 className="font-semibold text-[#0f0f11]">Resumen</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <InfoDato label="Nivel" valor={alerta.nivel || 'informativa'} destaque={colorNivel(alerta.nivel)} />
                <InfoDato label="Estado alerta" valor={formatearEtiqueta(alerta.estado || 'activa')} />
                <InfoDato label="Tiempo alerta" valor={tiempoDesde(alerta.created_at)} />
                <InfoDato label="Responsable" valor={alerta.responsable || 'Sin asignar'} />
                <InfoDato label="Accion sugerida" valor={describirAlerta(alerta)} />
              </div>
              <p className="mt-4 bg-[#fffaf7] px-4 py-3 text-sm leading-6 text-[#4c4546]">
                {alerta.mensaje || 'Alerta sin mensaje registrado.'}
              </p>
            </section>

            <section className="border border-[#eadbd6] p-4">
              <h3 className="font-semibold text-[#0f0f11]">Detalle del pedido priorizado</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <InfoDato label="Pedido" valor={alerta.pedido_codigo || 'Sin codigo'} />
                <InfoDato label="Estado pedido" valor={formatearEtiqueta(alerta.pedido_estado || 'Sin estado')} />
                <InfoDato label="Tiempo pedido" valor={tiempoPedidoAlerta(alerta) || 'Sin fecha requerida'} />
                <InfoDato label="Fecha solicitud" valor={formatearFechaHora(alerta.pedido_fecha_solicitud)} />
                <InfoDato label="Fecha estimada de entrega" valor={formatearFechaHora(alerta.pedido_fecha_compromiso)} />
                <InfoDato label="Solicitante" valor={alerta.pedido_solicitante || 'Sin registrar'} />
                <InfoDato label="Cedula/RUC" valor={alerta.pedido_cedula_solicitante || 'Sin registrar'} />
                <InfoDato label="Flujo" valor={describirFlujoAlerta(alerta)} />
                <InfoDato label="Urgencia" valor={formatearEtiqueta(alerta.pedido_urgencia || 'Sin registrar')} />
                <InfoDato label="Impacto" valor={formatearEtiqueta(alerta.pedido_accion_solicitante || 'despachar')} />
                <InfoDato
                  label="Condicion operativa"
                  valor={formatearEtiqueta(alerta.pedido_condicion_material || 'normal')}
                />
                <InfoDato
                  label="Prioridad"
                  valor={
                    typeof alerta.pedido_prioridad_calculada === 'number'
                      ? `${alerta.pedido_prioridad_calculada}/100`
                      : 'Sin calcular'
                  }
                />
              </div>
            </section>
          </div>

          <div className="space-y-5">
            <section className="border border-[#eadbd6] p-4">
              <h3 className="font-semibold text-[#0f0f11]">Material y stock</h3>
              <div className="mt-3 grid grid-cols-1 gap-3">
                <InfoDato label="Material" valor={alerta.pedido_material || 'Sin material'} />
                <InfoDato
                  label="Cantidad a atender"
                  valor={
                    typeof cantidadOperativa === 'number'
                      ? `${cantidadOperativa} ${unidad}`.trim()
                      : 'Sin cantidad'
                  }
                />
                <InfoDato
                  label="Stock disponible"
                  valor={
                    typeof stockDisponible === 'number'
                      ? `${stockDisponible} ${unidad}`.trim()
                      : 'Sin stock'
                  }
                />
                <InfoDato
                  label="Stock si aprueba"
                  valor={
                    typeof stockPosterior === 'number'
                      ? `${stockPosterior} ${unidad}`.trim()
                      : 'Sin calcular'
                  }
                  destaque={
                    typeof stockPosterior === 'number' && stockPosterior < 0
                      ? claseSemaforoBadge('critico')
                      : undefined
                  }
                />
                <InfoDato
                  label="Despacho"
                  valor={
                    alerta.pedido_despachado_at
                      ? `${formatearFechaHora(alerta.pedido_despachado_at)} por ${alerta.pedido_despachado_por || 'Bodega'}`
                      : 'Sin despacho registrado'
                  }
                />
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  )
}

function InfoDato({
  destaque,
  label,
  valor,
}: {
  destaque?: string
  label: string
  valor: string
}) {
  return (
    <div className="alerta-info-box bg-[#fffaf7] p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#7e7576]">{label}</p>
      {destaque ? (
        <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${destaque}`}>
          {valor}
        </span>
      ) : (
        <p className="mt-1 text-sm font-semibold text-[#0f0f11]">{valor}</p>
      )}
    </div>
  )
}

function colorNivel(nivel?: Alerta['nivel']) {
  if (nivel === 'critica') return claseSemaforoBadge('critico')
  if (nivel === 'alta' || nivel === 'media') return claseSemaforoBadge('riesgo')
  return claseSemaforoBadge('a_tiempo')
}

function colorEstado(estado?: Alerta['estado']) {
  if (estado === 'cerrada') return 'bg-green-100 text-green-700'
  return 'bg-orange-100 text-orange-700'
}

function etiquetaEstadoAlerta(estado?: Alerta['estado'], alerta?: Alerta) {
  if (alerta && !alertaOperativa(alerta)) return 'resuelta'
  return estado === 'cerrada' ? 'resuelta' : 'operativa'
}

function bordeAlerta(alerta: Alerta) {
  if (!alertaOperativa(alerta)) return 'border-green-200 opacity-80'
  return claseSemaforoBorde(semaforoAlerta(alerta))
}

function fondoIcono(alerta: Alerta) {
  if (!alertaOperativa(alerta)) return 'bg-green-50 text-green-700 ring-1 ring-green-100'
  const semaforo = semaforoAlerta(alerta)
  if (semaforo === 'critico') return 'bg-red-50 text-red-700 ring-1 ring-red-100'
  if (semaforo === 'alto') return 'bg-orange-50 text-orange-700 ring-1 ring-orange-100'
  if (semaforo === 'riesgo') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
  return 'bg-green-50 text-green-700 ring-1 ring-green-100'
}

function colorRailAlerta(alerta: Alerta) {
  if (!alertaOperativa(alerta)) return 'bg-green-500'
  const semaforo = semaforoAlerta(alerta)
  if (semaforo === 'critico') return 'bg-red-600'
  if (semaforo === 'alto') return 'bg-orange-500'
  if (semaforo === 'riesgo') return 'bg-yellow-500'
  if (semaforo === 'a_tiempo') return 'bg-green-500'
  return 'bg-slate-400'
}

function describirAlerta(alerta: Alerta) {
  if (!alertaOperativa(alerta)) {
    return 'Alerta resuelta. No aparece en la vista operativa diaria.'
  }

  if (alerta.tipo_alerta === 'stock_bajo') {
    return 'Inventario bajo minimo: coordinar reposicion antes de afectar despacho.'
  }

  if (alerta.tipo_alerta === 'priorizacion_pedido') {
    return 'Pedido priorizado: revisar stock, fecha requerida y despacho.'
  }

  if (alerta.tipo_alerta === 'pedido_sin_gestion') {
    return 'Escalar por antiguedad y definir responsable de cierre.'
  }

  if (alerta.tipo_alerta === 'pedido_no_encontrado_despacho') {
    return 'Validar el pedido contra la gestion de despacho.'
  }

  if (alerta.tipo_alerta.includes('nota_credito')) {
    return 'Revisar aprobacion y seguimiento de nota de credito.'
  }

  if (alerta.tipo_alerta === 'reabastecimiento_transito_pendiente') {
    return 'Monitorear transito y fecha estimada de reabastecimiento.'
  }

  if (alerta.nivel === 'critica') return 'Atencion inmediata recomendada.'
  if (alerta.nivel === 'alta') return 'Revisar durante la jornada.'
  return 'Seguimiento operativo.'
}

function esAlertaFaltaMaterial(alerta: Alerta) {
  const tipo = normalizarTexto(alerta.tipo_alerta || '')
  const texto = normalizarTexto(`${alerta.tipo_alerta || ''} ${alerta.mensaje || ''}`)

  // 0) Una alerta de priorizacion/retraso de pedido SIEMPRE pertenece a la
  //    pestana de priorizacion (aunque el pedido tenga poco o cero stock, o su
  //    mensaje mencione materiales). Todo pedido retrasado, reprogramado,
  //    reabierto o critico debe verse en Priorizacion mientras este abierto.
  const tipoPriorizacion =
    tipo.includes('priorizacion') ||
    tipo.includes('retras') ||
    tipo.includes('reagend') ||
    tipo.includes('reabierto') ||
    tipo.includes('sin_gestion') ||
    tipo.includes('urgencia') ||
    tipo.includes('nota_credito') ||
    tipo.includes('reporte')
  if (tipoPriorizacion) return false

  // 1) Alertas cuyo tipo/mensaje son de inventario (stock, existencia, etc.).
  const esAlertaDeStock =
    tipo.includes('stock') ||
    tipo.includes('material') ||
    tipo.includes('existencia') ||
    tipo.includes('reabastecimiento') ||
    tipo.includes('inventario') ||
    texto.includes('sin stock') ||
    texto.includes('stock bajo') ||
    texto.includes('bajo el minimo') ||
    texto.includes('bajo minimo') ||
    texto.includes('material no planificable') ||
    texto.includes('transito pendiente') ||
    texto.includes('reabastecimiento') ||
    texto.includes('agotars')

  if (esAlertaDeStock) return true

  // 2) Una alerta de priorizacion/retraso de pedido NO es de falta de material,
  //    aunque el pedido tenga poco stock (se clasifica como priorizacion).
  const esPriorizacionPedido =
    tipo.includes('priorizacion') ||
    tipo.includes('retras') ||
    tipo.includes('sin_gestion') ||
    tipo.includes('despacho') ||
    tipo.includes('urgencia') ||
    tipo.includes('nota_credito')

  if (esPriorizacionPedido) return false

  // 3) Fallback: un pedido explicitamente sin stock se muestra como falta de material.
  const cantidadOperativa = cantidadOperativaAlerta(alerta)
  const estadoPedido = alerta.pedido_estado || ''
  const stockPendienteDeValidar = !['en_despacho', 'entregado', 'cancelado', 'rechazado'].includes(
    estadoPedido
  )

  return (
    alerta.pedido_estado === 'sin_stock' ||
    (stockPendienteDeValidar &&
      typeof alerta.pedido_stock_disponible === 'number' &&
      typeof cantidadOperativa === 'number' &&
      alerta.pedido_stock_disponible < cantidadOperativa)
  )
}

function esAlertaDePedido(alerta: Alerta): boolean {
  return (
    Boolean(alerta.pedido_id) ||
    Boolean(alerta.pedido_codigo) ||
    esAlertaPriorizacionPedido(alerta)
  )
}

function esAlertaPriorizacionPedido(alerta: Alerta) {
  const tipo = normalizarTexto(alerta.tipo_alerta || '')
  const texto = normalizarTexto(`${alerta.tipo_alerta || ''} ${alerta.mensaje || ''}`)

  return (
    Boolean(alerta.pedido_id || alerta.pedido_codigo) ||
    alerta.pedido_estado === 'retrasado' ||
    tipo.includes('pedido') ||
    tipo.includes('priorizacion') ||
    tipo.includes('urgencia') ||
    tipo.includes('despacho') ||
    tipo.includes('retras') ||
    tipo.includes('sin_gestion') ||
    tipo.includes('no_encontrado') ||
    tipo.includes('nota_credito') ||
    texto.includes('retras') ||
    texto.includes('sin gestion') ||
    texto.includes('60 dias') ||
    texto.includes('no se encuentra') ||
    texto.includes('vencido') ||
    texto.includes('fecha compromiso') ||
    texto.includes('nota de credito') ||
    texto.includes('urgencia') ||
    tipo.includes('franquiciado')
  )
}

function alertaOperativa(alerta: Alerta) {
  if (alerta.estado === 'cerrada') return false
  if (esAlertaReporteFranquiciado(alerta)) return true
  return !pedidoAlertaCerrado(alerta)
}

function pedidoAlertaCerrado(alerta: Alerta) {
  return ['entregado', 'cancelado', 'rechazado'].includes(alerta.pedido_estado || '')
}

function esAlertaReporteFranquiciado(alerta: Alerta) {
  const tipo = normalizarTexto(alerta.tipo_alerta || '')
  const texto = normalizarTexto(alerta.mensaje || '')

  return tipo.includes('reporte_franquiciado') || texto.includes('reporte del franquiciado')
}

// Agrupa en una sola tarjeta las alertas de un mismo pedido (p. ej. retraso y
// reabierto por reporte) para no mostrar la misma incidencia dos veces.
function clavePedidoFusion(alerta: Alerta): string | null {
  if (esAlertaFaltaMaterial(alerta)) return null
  if (!esAlertaPriorizacionPedido(alerta)) return null
  if (alerta.pedido_id) return `id:${alerta.pedido_id}`
  if (alerta.pedido_codigo) return `cod:${normalizarTexto(alerta.pedido_codigo)}`
  return null
}

function fusionarAlertasPorPedido(alertas: Alerta[]): AlertaVista[] {
  const grupos = new Map<string, Alerta[]>()
  const orden: Array<string | Alerta> = []

  alertas.forEach((alerta) => {
    const clave = clavePedidoFusion(alerta)
    if (!clave) {
      orden.push(alerta)
      return
    }
    if (!grupos.has(clave)) {
      grupos.set(clave, [])
      orden.push(clave)
    }
    grupos.get(clave)!.push(alerta)
  })

  return orden.map((item) => {
    if (typeof item !== 'string') return item
    const grupo = grupos.get(item) as Alerta[]
    return grupo.length === 1 ? grupo[0] : sintetizarAlertaPedido(grupo)
  })
}

function sintetizarAlertaPedido(grupo: Alerta[]): AlertaVista {
  const base = [...grupo].sort(ordenarPorCriticidad)[0]
  const retraso = grupo.find((alerta) => !esAlertaReporteFranquiciado(alerta))
  const reporte = grupo.find((alerta) => esAlertaReporteFranquiciado(alerta))
  const codigo = base.pedido_codigo || grupo.map((alerta) => alerta.pedido_codigo).find(Boolean) || ''

  const partes: string[] = []
  if (retraso) partes.push(`atrasado (${detalleRetrasoDesde(retraso.mensaje)})`)
  if (reporte) {
    const motivo = motivoReporteDesde(reporte.mensaje)
    partes.push(`reabierto por reporte del franquiciado${motivo ? ` (motivo: ${motivo})` : ''}`)
  }

  const nivel: Alerta['nivel'] = grupo.some((alerta) => alerta.nivel === 'critica')
    ? 'critica'
    : grupo.some((alerta) => alerta.nivel === 'alta')
      ? 'alta'
      : base.nivel

  return {
    ...base,
    nivel,
    tipo_alerta:
      retraso && reporte ? 'pedido_retrasado_reabierto_por_reporte' : base.tipo_alerta,
    mensaje: partes.length ? `Pedido ${codigo}: ${partes.join(' y ')}.` : base.mensaje,
    fusionadas: grupo.map((alerta) => alerta.id),
  }
}

function detalleRetrasoDesde(mensaje?: string | null): string {
  const coincidencia = (mensaje || '').match(/(\d+)\s*d(?:ias)?\s*de\s*retraso/i)
  return coincidencia ? `${coincidencia[1]} d de retraso` : 'con retraso'
}

function motivoReporteDesde(mensaje?: string | null): string {
  const coincidencia = (mensaje || '').match(/motivo:\s*(.+?)\.?\s*$/i)
  return coincidencia ? coincidencia[1].trim() : ''
}

function semaforoAlerta(alerta: Alerta): SemaforoOperativo {
  // Una alerta de un pedido ya cerrado deja de ser operativa.
  if (pedidoAlertaCerrado(alerta)) return 'cerrado'

  // Alerta ligada a un pedido: su color es EXACTAMENTE el del semaforo del pedido
  // (verde/amarillo/naranja/rojo) para que coincida en todo el sistema.
  if (alerta.pedido_fecha_compromiso) {
    const semaforo = resolverSemaforoPedido({
      estado: estadoPedidoAlerta(alerta.pedido_estado),
      fecha_compromiso: alerta.pedido_fecha_compromiso,
      prioridad_calculada: alerta.pedido_prioridad_calculada ?? undefined,
    })
    // La alerta se vuelve ROJA desde la reprogramacion (naranja) en adelante.
    return semaforo === 'alto' ? 'critico' : semaforo
  }

  // Alertas sin pedido (inventario/stock): color segun su nivel.
  if (alerta.nivel === 'critica') return 'critico'
  if (alerta.nivel === 'alta' || alerta.nivel === 'media') return 'riesgo'
  return 'a_tiempo'
}

function ordenarPorCriticidad(a: Alerta, b: Alerta) {
  const pesos: Record<SemaforoOperativo, number> = {
    critico: 0,
    alto: 1,
    riesgo: 2,
    a_tiempo: 3,
    cerrado: 4,
  }

  const diferencia = pesos[semaforoAlerta(a)] - pesos[semaforoAlerta(b)]
  if (diferencia !== 0) return diferencia
  return ordenarPorFechaReciente(a, b)
}

function ordenarPorFechaReciente(a: Alerta, b: Alerta) {
  return fechaAlertaMs(b.created_at) - fechaAlertaMs(a.created_at)
}

function fechaAlertaMs(fecha?: string | null) {
  const date = new Date(fecha || '')
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function filtrarPorFecha(
  fecha: string | null | undefined,
  fechaDesde: string,
  fechaHasta: string
) {
  if (!fechaDesde && !fechaHasta) return true

  const fechaMs = fechaAlertaMs(fecha)
  if (!fechaMs) return false

  if (fechaDesde) {
    const desde = new Date(`${fechaDesde}T00:00:00`).getTime()
    if (!Number.isNaN(desde) && fechaMs < desde) return false
  }

  if (fechaHasta) {
    const hasta = new Date(`${fechaHasta}T23:59:59`).getTime()
    if (!Number.isNaN(hasta) && fechaMs > hasta) return false
  }

  return true
}

function materialAlerta(alerta: Alerta) {
  if (alerta.pedido_material) return alerta.pedido_material

  const mensaje = alerta.mensaje || ''
  const match = mensaje.match(/Material\s+(.+?)\s+(?:bajo|sin|en|no|con|requiere)/i)

  return match?.[1]?.trim() || null
}

function materialEnInventario(alerta: Alerta, llaves: Set<string>) {
  if (alerta.material_id && llaves.has(`id:${alerta.material_id}`)) return true

  const nombre = materialAlerta(alerta)
  return Boolean(nombre && llaves.has(`nombre:${normalizarTexto(nombre)}`))
}

function cantidadOperativaAlerta(alerta: Alerta) {
  if (typeof alerta.pedido_cantidad_despacho === 'number' && alerta.pedido_cantidad_despacho > 0) {
    return alerta.pedido_cantidad_despacho
  }

  if (typeof alerta.pedido_cantidad === 'number') return alerta.pedido_cantidad
  return null
}

function tiempoDesde(fecha?: string | null) {
  if (!fecha) return 'Sin fecha de alerta'

  const fechaAlerta = new Date(fecha)
  if (Number.isNaN(fechaAlerta.getTime())) return 'Sin fecha de alerta'

  const minutos = Math.max(0, Math.floor((Date.now() - fechaAlerta.getTime()) / 60000))

  if (minutos < 1) return 'Alerta creada ahora'
  if (minutos < 60) return `Alerta creada hace ${minutos} min`

  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `Alerta creada hace ${horas} h`

  const dias = Math.floor(horas / 24)
  return `Alerta creada hace ${dias} d`
}

function tiempoPedidoAlerta(alerta: Alerta) {
  if (!alerta.pedido_fecha_compromiso) return null

  return describirTiempoPedido({
    estado: estadoPedidoAlerta(alerta.pedido_estado),
    fecha_compromiso: alerta.pedido_fecha_compromiso,
  })
}

function colorTiempoPedido(alerta: Alerta) {
  const texto = normalizarTexto(tiempoPedidoAlerta(alerta) || '')

  if (texto.includes('retraso')) return claseSemaforoBadge('critico')
  if (texto.includes('vence')) return claseSemaforoBadge('riesgo')
  return claseSemaforoBadge('a_tiempo')
}

function estadoPedidoAlerta(estado?: string | null): EstadoPedido {
  const estados: EstadoPedido[] = [
    'pendiente',
    'en_revision',
    'aprobado',
    'en_despacho',
    'retrasado',
    'sin_stock',
    'entregado',
    'cancelado',
    'rechazado',
  ]

  return estados.includes(estado as EstadoPedido) ? (estado as EstadoPedido) : 'pendiente'
}

function describirFlujoAlerta(alerta: Alerta) {
  const origen = alerta.pedido_origen ? formatearEtiqueta(alerta.pedido_origen) : 'Sin origen'
  const destino = alerta.pedido_destino ? formatearEtiqueta(alerta.pedido_destino) : 'Sin destino'

  return `${origen} a ${destino}`
}

function formatearFechaHora(fecha?: string | null) {
  if (!fecha) return 'Sin registrar'
  const date = new Date(fecha)
  if (Number.isNaN(date.getTime())) return 'Sin registrar'
  return date.toLocaleString()
}

function formatearEtiqueta(valor: string) {
  return valor.replace(/_/g, ' ')
}

function normalizarTexto(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}
