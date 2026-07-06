import { useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  Download,
  Eye,
  FileWarning,
  Filter,
  Search,
  X,
} from 'lucide-react'
import {
  escucharReportesFranquiciado,
  obtenerReportesFranquiciado,
} from '../services/franquiciadoService'
import {
  escucharInventarioOperativo,
  obtenerInventarioOperativo,
} from '../services/inventarioService'
import { escucharMateriales } from '../services/materialesService'
import { escucharPedidos, obtenerPedidos } from '../services/pedidosService'
import {
  escucharReportesOperativos,
  obtenerReportesOperativos,
} from '../services/reportesService'
import type { InventarioOperativo } from '../types/material'
import type {
  AccionSolicitante,
  CondicionMaterial,
  EstadoPedido,
  Pedido,
} from '../types/pedido'
import type { ReporteFranquiciado } from '../types/reporteFranquiciado'
import type { ReporteOperativo } from '../types/reporteOperativo'

type FiltrosReporte = {
  busqueda: string
  estado: 'todos' | EstadoPedido
  accion: 'todos' | AccionSolicitante
  condicion: 'todos' | CondicionMaterial
}


const filtrosIniciales: FiltrosReporte = {
  busqueda: '',
  estado: 'todos',
  accion: 'todos',
  condicion: 'todos',
}


const estadosPedido: Array<FiltrosReporte['estado']> = [
  'todos',
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

const accionesSolicitante: Array<FiltrosReporte['accion']> = [
  'todos',
  'despachar',
  'nota_credito',
  'esperar_pedido',
]

const condicionesMaterial: Array<FiltrosReporte['condicion']> = [
  'todos',
  'normal',
  'no_planificable',
  'restrictivo',
  'urgente_despacho',
  'caducidad',
]



export default function Reportes() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [materiales, setMateriales] = useState<InventarioOperativo[]>([])
  const [reportesFranquiciado, setReportesFranquiciado] = useState<ReporteFranquiciado[]>([])
  const [reportesOperativos, setReportesOperativos] = useState<ReporteOperativo[]>([])
  const [filtros, setFiltros] = useState<FiltrosReporte>(filtrosIniciales)
  const [cargando, setCargando] = useState(true)
  const [reporteDetalle, setReporteDetalle] = useState<ReporteFranquiciado | null>(null)
  const [verHistorialReportes, setVerHistorialReportes] = useState(false)
  const [pestana, setPestana] = useState<'despacho' | 'franquiciado'>('despacho')

  async function cargarReportes() {
    const [
      pedidosResult,
      materialesResult,
      reportesFranquiciadoResult,
      reportesOperativosResult,
    ] = await Promise.all([
      obtenerPedidos(),
      obtenerInventarioOperativo(),
      obtenerReportesFranquiciado(),
      obtenerReportesOperativos(),
    ])

    setPedidos(pedidosResult.data || [])
    setMateriales(materialesResult.data || [])
    setReportesFranquiciado(reportesFranquiciadoResult.data || [])
    setReportesOperativos(reportesOperativosResult.data || [])
    setCargando(false)
  }


  useEffect(() => {
    const timer = window.setTimeout(cargarReportes, 0)
    const dejarDeEscucharPedidos = escucharPedidos(cargarReportes)
    const dejarDeEscucharInventario = escucharInventarioOperativo(cargarReportes)
    const dejarDeEscucharMateriales = escucharMateriales(cargarReportes)
    const dejarDeEscucharReportes = escucharReportesOperativos(cargarReportes)
    const dejarDeEscucharReportesFranquiciado = escucharReportesFranquiciado(cargarReportes)

    return () => {
      window.clearTimeout(timer)
      dejarDeEscucharPedidos()
      dejarDeEscucharInventario()
      dejarDeEscucharMateriales()
      dejarDeEscucharReportes()
      dejarDeEscucharReportesFranquiciado()
    }
  }, [])

  const pedidosNormalizados = useMemo(() => {
    return pedidos.map((pedido) => ({
      ...pedido,
      accion_solicitante: pedido.accion_solicitante || 'despachar',
      condicion_material: pedido.condicion_material || 'normal',
      cantidad_despacho: cantidadParaDespacho(pedido),
    }))
  }, [pedidos])

  const pedidosFiltrados = useMemo(() => {
    return pedidosNormalizados.filter((pedido) => {
      const coincideEstado = filtros.estado === 'todos' || pedido.estado === filtros.estado
      const coincideAccion =
        filtros.accion === 'todos' || pedido.accion_solicitante === filtros.accion
      const coincideCondicion =
        filtros.condicion === 'todos' || pedido.condicion_material === filtros.condicion

      return coincideEstado && coincideAccion && coincideCondicion
    })
  }, [filtros, pedidosNormalizados])

  const materialesPorDespachar = useMemo(() => {
    const mapa = new Map<
      string,
      { material: string; solicitado: number; stock: number; unidad: string; pedidos: number }
    >()

    pedidosFiltrados
      .filter((pedido) => pedidoPendienteDespacho(pedido.estado))
      .forEach((pedido) => {
        const material = materiales.find(
          (item) =>
            item.id === pedido.material_id ||
            normalizarTexto(item.nombre) === normalizarTexto(pedido.material)
        )
        const nombre = material?.nombre || pedido.material
        const anterior = mapa.get(nombre)
        const solicitado = cantidadParaDespacho(pedido)

        mapa.set(nombre, {
          material: nombre,
          solicitado: (anterior?.solicitado || 0) + solicitado,
          stock: material?.stock_disponible_operativo ?? pedido.stock_disponible,
          unidad: material?.unidad_medida || pedido.unidad_medida,
          pedidos: (anterior?.pedidos || 0) + 1,
        })
      })

    materiales.forEach((material) => {
      if (!materialNecesitaSeguimiento(material)) return

      const nombre = material.nombre
      const anterior = mapa.get(nombre)
      const solicitado = Math.max(
        anterior?.solicitado || 0,
        umbralNormalMaterial(material) - Math.max(0, material.stock_disponible_operativo)
      )

      mapa.set(nombre, {
        material: nombre,
        solicitado,
        stock: material.stock_disponible_operativo,
        unidad: material.unidad_medida,
        pedidos: anterior?.pedidos || material.casos_bodega_fq || 0,
      })
    })

    return [...mapa.values()].sort((a, b) => b.solicitado - a.solicitado)
  }, [materiales, pedidosFiltrados])

  const resumenOperativo = useMemo(() => {
    const entregados = pedidosFiltrados.filter((pedido) => pedido.estado === 'entregado').length
    const cumplimiento =
      pedidosFiltrados.length === 0
        ? 0
        : Math.round((entregados / pedidosFiltrados.length) * 100)
    const cantidadPendiente = materialesPorDespachar.reduce(
      (total, item) => total + item.solicitado,
      0
    )
    const ncOEspera = pedidosFiltrados.filter(
      (pedido) =>
        pedido.accion_solicitante === 'nota_credito' ||
        pedido.accion_solicitante === 'esperar_pedido'
    ).length
    const condicionesOperativas = pedidosFiltrados.filter(
      (pedido) => pedido.condicion_material && pedido.condicion_material !== 'normal'
    ).length

    return [
      {
        nombre: 'Cumplimiento',
        valor: `${cumplimiento}%`,
      },
      {
        nombre: 'Por despachar',
        valor: cantidadPendiente,
      },
      {
        nombre: 'NC o espera',
        valor: ncOEspera,
      },
      {
        nombre: 'Condicion operativa',
        valor: condicionesOperativas,
      },
      {
        nombre: 'Reportes internos',
        valor: reportesOperativos.filter((reporte) => reporte.estado !== 'resuelto').length,
      },
      {
        nombre: 'Reportes invitado',
        valor: reportesFranquiciado.filter((reporte) => reporte.estado !== 'cerrado').length,
      },
    ]
  }, [materialesPorDespachar, pedidosFiltrados, reportesFranquiciado, reportesOperativos])

  const reportesFranquiciadoFiltrados = useMemo(() => {
    const texto = normalizarTexto(filtros.busqueda)

    if (!texto) return reportesFranquiciado

    return reportesFranquiciado.filter((reporte) => {
      const pedidoRelacionado =
        pedidos.find((pedido) => pedido.id === reporte.pedido_id) ||
        pedidos.find((pedido) => pedido.codigo === reporte.codigo_consulta)

      return normalizarTexto(
        [
          reporte.codigo_consulta,
          reporte.cedula_solicitante,
          reporte.solicitante || '',
          reporte.motivo,
          reporte.descripcion,
          reporte.estado,
          reporte.created_at || '',
          pedidoRelacionado?.codigo || '',
          pedidoRelacionado?.codigo_consulta || '',
          pedidoRelacionado?.material || '',
          pedidoRelacionado?.solicitante || '',
          pedidoRelacionado?.estado || '',
        ].join(' ')
      ).includes(texto)
    })
  }, [filtros.busqueda, pedidos, reportesFranquiciado])

  const reportesFranquiciadoActivos = useMemo(
    () => reportesFranquiciadoFiltrados.filter((reporte) => reporte.estado !== 'cerrado'),
    [reportesFranquiciadoFiltrados],
  )

  const reportesFranquiciadoHistorial = useMemo(
    () => reportesFranquiciadoFiltrados.filter((reporte) => reporte.estado === 'cerrado'),
    [reportesFranquiciadoFiltrados],
  )

  const pedidoDetalleReporte = useMemo(() => {
    if (!reporteDetalle) return null

    return (
      pedidos.find((pedido) => pedido.id === reporteDetalle.pedido_id) ||
      pedidos.find((pedido) => pedido.codigo === reporteDetalle.codigo_consulta) ||
      null
    )
  }, [pedidos, reporteDetalle])

  return (
    <div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Reportes</h1>
          <p className="mt-1 text-slate-500">
            Indicadores para pedidos, despacho, inventario e impacto operativo.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => exportarPedidosCsv(pedidosFiltrados)}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <Download size={16} />
            Exportar pedidos
          </button>
          <button
            type="button"
            onClick={() => exportarDespachoCsv(materialesPorDespachar)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-700"
          >
            <Download size={16} />
            Exportar despacho
          </button>
        </div>
      </div>


      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2 font-semibold text-slate-800">
          <Filter size={18} className="text-orange-600" />
          Filtros del reporte
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.4fr)_repeat(3,minmax(160px,1fr))]">
          <label className="block text-sm font-medium text-slate-700">
            Busqueda
            <span className="mt-1 flex min-h-11 items-center gap-2 rounded-lg border-2 border-[#ed1c24] bg-white px-4 focus-within:ring-2 focus-within:ring-orange-500">
              <Search size={17} className="text-slate-400" />
              <input
                value={filtros.busqueda}
                onChange={(event) => setFiltros({ ...filtros, busqueda: event.target.value })}
                placeholder="Pedido, cliente, motivo o detalle..."
                className="w-full border-0 bg-transparent p-0 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:ring-0"
              />
            </span>
          </label>
          <FiltroSelect
            label="Estado"
            value={filtros.estado}
            opciones={estadosPedido}
            onChange={(estado) =>
              setFiltros({ ...filtros, estado: estado as FiltrosReporte['estado'] })
            }
          />
          <FiltroSelect
            label="Impacto"
            value={filtros.accion}
            opciones={accionesSolicitante}
            onChange={(accion) =>
              setFiltros({ ...filtros, accion: accion as FiltrosReporte['accion'] })
            }
          />
          <FiltroSelect
            label="Condicion operativa"
            value={filtros.condicion}
            opciones={condicionesMaterial}
            onChange={(condicion) =>
              setFiltros({
                ...filtros,
                condicion: condicion as FiltrosReporte['condicion'],
              })
            }
          />
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {resumenOperativo.map((item) => (
            <div key={item.nombre} className="border-l border-slate-200 pl-4 first:border-l-0 first:pl-0">
              <p className="text-xs font-semibold uppercase text-slate-500">{item.nombre}</p>
              <strong className="mt-1 block text-xl text-slate-900">
                {cargando ? '-' : item.valor}
              </strong>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setPestana('despacho')}
            className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition ${
              pestana === 'despacho'
                ? 'border-[#a33e00] bg-[#261812] text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="flex items-center gap-2 font-semibold">
              <Boxes size={18} />
              Materiales que necesitan despacho
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${pestana === 'despacho' ? 'bg-white text-[#261812]' : 'bg-slate-100 text-slate-600'}`}>
              {materialesPorDespachar.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPestana('franquiciado')}
            className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition ${
              pestana === 'franquiciado'
                ? 'border-[#a33e00] bg-[#261812] text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="flex items-center gap-2 font-semibold">
              <FileWarning size={18} />
              Reportes de franquiciado
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${pestana === 'franquiciado' ? 'bg-white text-[#261812]' : 'bg-amber-100 text-amber-700'}`}>
              {reportesFranquiciadoActivos.length}
            </span>
          </button>
        </div>
      </section>

      {pestana === 'despacho' && (
      <div className="mt-6">
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-200 p-5 font-semibold text-slate-800">
            <Boxes size={18} className="text-orange-600" />
            Materiales que necesitan despacho
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-5 py-3 text-left">Material</th>
                  <th className="px-5 py-3 text-left">Solicitado</th>
                  <th className="px-5 py-3 text-left">Stock</th>
                </tr>
              </thead>
              <tbody>
                {materialesPorDespachar.map((item) => {
                  return (
                    <tr key={item.material} className="border-t border-slate-100">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-800">{item.material}</p>
                        <p className="text-xs text-slate-500">{item.pedidos} pedidos</p>
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        {item.solicitado} {item.unidad}
                      </td>
                      <td className="px-5 py-4 text-slate-600">{item.stock}</td>
                    </tr>
                  )
                })}

                {!cargando && materialesPorDespachar.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-5 py-8 text-center text-slate-500">
                      Sin materiales pendientes de despacho.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

      </div>
      )}

      {pestana === 'franquiciado' && (
      <>
      <section className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-200 p-5 font-semibold text-slate-800">
          <FileWarning size={18} className="text-orange-600" />
          Reportes activos de franquiciados invitados
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-5 py-3 text-left">Pedido</th>
                <th className="px-5 py-3 text-left">Solicitante</th>
                <th className="px-5 py-3 text-left">Motivo</th>
                <th className="px-5 py-3 text-left">Estado</th>
                <th className="px-5 py-3 text-left">Fecha</th>
                <th className="px-5 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {reportesFranquiciadoActivos.map((reporte) => (
                <tr key={reporte.id} className="border-t border-slate-100 align-top">
                  <td className="px-5 py-4">
                    <p className="font-semibold text-slate-800">{reporte.codigo_consulta}</p>
                    <p className="text-xs text-slate-500">
                      Cliente/RUC {reporte.cedula_solicitante}
                    </p>
                  </td>
                  <td className="px-5 py-4 text-slate-600">{reporte.solicitante || '-'}</td>
                  <td className="px-5 py-4 text-slate-600">
                    {formatearEtiqueta(reporte.motivo)}
                  </td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                      {formatearEtiqueta(reporte.estado)}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-600">
                    {reporte.created_at ? new Date(reporte.created_at).toLocaleString() : '-'}
                  </td>
                  <td className="px-5 py-4">
                    <button
                      type="button"
                      onClick={() => setReporteDetalle(reporte)}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      <Eye size={15} />
                      Ver detalle
                    </button>
                  </td>
                </tr>
              ))}

              {!cargando && reportesFranquiciadoActivos.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                    {filtros.busqueda.trim()
                      ? 'No hay reportes activos que coincidan con la busqueda.'
                      : 'No hay reportes activos de franquiciados.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {reportesFranquiciadoHistorial.length > 0 && (
        <section className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setVerHistorialReportes((valor) => !valor)}
            className="flex w-full items-center justify-between gap-2 border-b border-slate-200 p-5 text-left font-semibold text-slate-800"
          >
            <span className="flex items-center gap-2">
              <FileWarning size={18} className="text-slate-400" />
              Historial de reportes cerrados ({reportesFranquiciadoHistorial.length})
            </span>
            <span className="text-xs font-medium text-slate-500">
              {verHistorialReportes ? 'Ocultar' : 'Ver'}
            </span>
          </button>
          {verHistorialReportes && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="px-5 py-3 text-left">Pedido</th>
                    <th className="px-5 py-3 text-left">Solicitante</th>
                    <th className="px-5 py-3 text-left">Motivo</th>
                    <th className="px-5 py-3 text-left">Estado</th>
                    <th className="px-5 py-3 text-left">Fecha</th>
                    <th className="px-5 py-3 text-left">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {reportesFranquiciadoHistorial.map((reporte) => (
                    <tr key={reporte.id} className="border-t border-slate-100 align-top">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-800">{reporte.codigo_consulta}</p>
                        <p className="text-xs text-slate-500">
                          Cliente/RUC {reporte.cedula_solicitante}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-slate-600">{reporte.solicitante || '-'}</td>
                      <td className="px-5 py-4 text-slate-600">
                        {formatearEtiqueta(reporte.motivo)}
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                          {formatearEtiqueta(reporte.estado)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        {reporte.created_at ? new Date(reporte.created_at).toLocaleString() : '-'}
                      </td>
                      <td className="px-5 py-4">
                        <button
                          type="button"
                          onClick={() => setReporteDetalle(reporte)}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          <Eye size={15} />
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      </>
      )}

      {reporteDetalle && (
        <ReporteDetalleModal
          pedido={pedidoDetalleReporte}
          reporte={reporteDetalle}
          onClose={() => setReporteDetalle(null)}
        />
      )}
    </div>
  )
}

function ReporteDetalleModal({
  onClose,
  pedido,
  reporte,
}: {
  onClose: () => void
  pedido: Pedido | null
  reporte: ReporteFranquiciado
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <section className="w-full max-w-4xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#c8102e]">
              Detalle del reporte
            </p>
            <h2 className="mt-1 text-2xl font-bold text-slate-900">{reporte.codigo_consulta}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Cliente/RUC {reporte.cedula_solicitante} - {formatearEtiqueta(reporte.motivo)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-5 p-5 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">Novedad reportada</h3>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
              {reporte.descripcion}
            </p>
            {reporte.motivo === 'material_defectuoso' &&
              reporte.cantidad_defectuosa != null && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold uppercase text-amber-800">
                    Detalle del material defectuoso
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-white px-2 py-2">
                      <p className="text-[11px] font-semibold uppercase text-slate-500">Pidio</p>
                      <p className="mt-1 text-sm font-bold text-slate-800">{reporte.cantidad_pedida ?? '-'}</p>
                    </div>
                    <div className="rounded-lg bg-white px-2 py-2">
                      <p className="text-[11px] font-semibold uppercase text-slate-500">Defectuoso</p>
                      <p className="mt-1 text-sm font-bold text-red-700">{reporte.cantidad_defectuosa}</p>
                    </div>
                    <div className="rounded-lg bg-white px-2 py-2">
                      <p className="text-[11px] font-semibold uppercase text-slate-500">Le queda</p>
                      <p className="mt-1 text-sm font-bold text-green-700">
                        {Math.max(0, (reporte.cantidad_pedida ?? 0) - (reporte.cantidad_defectuosa ?? 0))}
                      </p>
                    </div>
                  </div>
                  {reporte.remedio && (
                    <p className="mt-2 text-sm font-medium text-amber-900">
                      Remedio solicitado:{' '}
                      {reporte.remedio === 'nota_credito' ? 'Nota de credito' : 'Reposicion del material'}
                    </p>
                  )}
                </div>
              )}
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">
                {formatearEtiqueta(reporte.estado)}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                {formatearFechaReporte(reporte.created_at)}
              </span>
            </div>
          </article>

          <article className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">Pedido relacionado</h3>
            {pedido ? (
              <div className="mt-3 space-y-3 text-sm">
                <DatoReporte label="Pedido" valor={pedido.codigo_consulta || pedido.codigo} />
                <DatoReporte label="Cliente" valor={pedido.solicitante} />
                <DatoReporte label="Material" valor={pedido.material} />
                <DatoReporte
                  label="Cantidad"
                  valor={`${cantidadParaDespacho(pedido)} ${pedido.unidad_medida}`}
                />
                <DatoReporte label="Estado" valor={formatearEtiqueta(pedido.estado)} />
                <DatoReporte
                  label="Fecha compromiso"
                  valor={formatearFechaReporte(pedido.fecha_compromiso)}
                />
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                No se encontro un pedido sincronizado con este reporte. Revisa el codigo de
                consulta o la relacion `pedido_id`.
              </p>
            )}
          </article>
        </div>
      </section>
    </div>
  )
}

function DatoReporte({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{valor || '-'}</p>
    </div>
  )
}



function FiltroSelect({
  label,
  onChange,
  opciones,
  value,
}: {
  label: string
  onChange: (value: string) => void
  opciones: string[]
  value: string
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border-2 border-slate-400 bg-white px-4 py-2 outline-none focus:ring-2 focus:ring-orange-500"
      >
        {opciones.map((opcion) => (
          <option key={opcion} value={opcion}>
            {formatearEtiqueta(opcion)}
          </option>
        ))}
      </select>
    </label>
  )
}

function cantidadParaDespacho(pedido: Pedido) {
  return pedido.cantidad_despacho && pedido.cantidad_despacho > 0
    ? pedido.cantidad_despacho
    : pedido.cantidad
}

function pedidoCerrado(estado: EstadoPedido) {
  return ['entregado', 'cancelado', 'rechazado'].includes(estado)
}

function pedidoPendienteDespacho(estado: EstadoPedido) {
  return !pedidoCerrado(estado) && estado !== 'en_despacho'
}

function materialNecesitaSeguimiento(material: InventarioOperativo) {
  return material.stock_disponible_operativo < umbralNormalMaterial(material)
}

function umbralMinimoMaterial(material: InventarioOperativo) {
  return Math.max(
    1,
    material.pedido_maximo_material || 0,
    material.stock_minimo || 0,
    material.demanda_bodega_fq || 0
  )
}

function umbralNormalMaterial(material: InventarioOperativo) {
  return Math.max(umbralMinimoMaterial(material) * 3, material.stock_objetivo_material || 0)
}

function formatearEtiqueta(valor: string) {
  return valor.replace(/_/g, ' ')
}

function formatearFechaReporte(fecha?: string | null) {
  if (!fecha) return '-'
  const date = new Date(fecha)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function normalizarTexto(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function exportarPedidosCsv(pedidos: Pedido[]) {
  const filas = pedidos.map((pedido) => ({
    codigo: pedido.codigo,
    solicitante: pedido.solicitante,
    material: pedido.material,
    cantidad: pedido.cantidad,
    cantidad_despacho: cantidadParaDespacho(pedido),
    unidad_medida: pedido.unidad_medida,
    estado: pedido.estado,
    impacto: pedido.accion_solicitante || 'despachar',
    condicion_operativa: pedido.condicion_material || 'normal',
    fecha_compromiso: pedido.fecha_compromiso,
  }))

  descargarCsv('reporte-pedidos.csv', filas)
}

function exportarDespachoCsv(
  materiales: Array<{
    material: string
    solicitado: number
    stock: number
    unidad: string
    pedidos: number
  }>
) {
  const filas = materiales.map((item) => ({
    material: item.material,
    solicitado: item.solicitado,
    stock: item.stock,
    faltante: Math.max(0, item.solicitado - item.stock),
    unidad: item.unidad,
    pedidos: item.pedidos,
  }))

  descargarCsv('materiales-por-despachar.csv', filas)
}

function descargarCsv(nombre: string, filas: Array<Record<string, string | number>>) {
  if (filas.length === 0) return

  const encabezados = Object.keys(filas[0])
  const contenido = [
    'sep=;',
    encabezados.join(';'),
    ...filas.map((fila) =>
      encabezados
        .map((encabezado) => escaparCsv(String(fila[encabezado] ?? '')))
        .join(';')
    ),
  ].join('\n')

  const blob = new Blob([`\uFEFF${contenido}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nombre
  link.click()
  URL.revokeObjectURL(url)
}

function escaparCsv(valor: string) {
  if (!/[";\n]/.test(valor)) return valor
  return `"${valor.replace(/"/g, '""')}"`
}
