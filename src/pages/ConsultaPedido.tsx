import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { useConfirmar } from '../components/ConfirmacionProvider'
import { Link } from 'react-router'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  FileWarning,
  PackageCheck,
  Search,
  Send,
  Truck,
} from 'lucide-react'
import {
  confirmarEntregaFranquiciado,
  consultarPedidosInvitado,
  crearReporteFranquiciado,
  normalizarCedula,
  tieneReporteActivoPedido,
} from '../services/franquiciadoService'
import { escucharPedidos, solicitarNotaCredito } from '../services/pedidosService'
import { registrarAuditoria } from '../services/auditoriaService'
import {
  claseSemaforoBadge,
  claseSemaforoBarra,
  describirTiempoPedido,
  etiquetaSemaforo,
  resolverSemaforoPedido,
} from '../lib/semaforoOperativo'
import {
  esCodigoClienteORucValido,
  soloDigitos,
  textoDescripcion,
  textoMixtoOperativo,
} from '../lib/validacionesFormulario'
import type { EstadoPedido, Pedido } from '../types/pedido'
import type { MotivoReporteFranquiciado } from '../types/reporteFranquiciado'

type ConsultaForm = {
  codigo: string
  cedula: string
}

type ReporteForm = {
  motivo: MotivoReporteFranquiciado
  descripcion: string
}

const consultaInicial: ConsultaForm = {
  codigo: '',
  cedula: '',
}

const reporteInicial: ReporteForm = {
  motivo: 'retraso',
  descripcion: '',
}

const estadosFlujo: EstadoPedido[] = [
  'pendiente',
  'en_revision',
  'aprobado',
  'en_despacho',
  'entregado',
]

const motivosReporte: Array<{ valor: MotivoReporteFranquiciado; etiqueta: string }> = [
  { valor: 'retraso', etiqueta: 'Retraso del pedido' },
  { valor: 'material_defectuoso', etiqueta: 'Material defectuoso' },
  { valor: 'nota_credito', etiqueta: 'Solicitar nota de credito' },
  { valor: 'otro', etiqueta: 'Otro motivo' },
]

function etiquetaNc(estado: string) {
  if (estado === 'en_revision') return 'En revisión'
  if (estado === 'aprobada') return 'Aprobada'
  if (estado === 'efectiva') return 'Reembolsada'
  if (estado === 'rechazada') return 'Rechazada'
  return 'Solicitada'
}

function textoNc(estado: string) {
  if (estado === 'en_revision') return 'Bodega está revisando tu solicitud de nota de crédito.'
  if (estado === 'aprobada') return 'Tu nota de crédito fue aprobada. Se hará efectiva en breve.'
  if (estado === 'efectiva') return 'Reembolso realizado. Este material queda como nota de crédito efectiva.'
  if (estado === 'rechazada') return 'Tu solicitud de nota de crédito fue rechazada por bodega.'
  return 'Solicitud enviada. Bodega la revisará y te confirmará el reembolso.'
}

const disensaLogo = '/disensa-holcim-logo-source.png'

export default function ConsultaPedido() {
  const confirmar = useConfirmar()
  const [consulta, setConsulta] = useState<ConsultaForm>(consultaInicial)
  const [reporte, setReporte] = useState<ReporteForm>(reporteInicial)
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [pedidosGrupo, setPedidosGrupo] = useState<Pedido[]>([])
  const [cargando, setCargando] = useState(false)
  const [enviandoReporte, setEnviandoReporte] = useState(false)
  const [confirmandoEntrega, setConfirmandoEntrega] = useState(false)
  const [reporteActivo, setReporteActivo] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  async function consultar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCargando(true)
    setError('')
    setMensaje('')
    setPedido(null)
    setPedidosGrupo([])

    const codigo = consulta.codigo.trim()
    const cedula = normalizarCedula(consulta.cedula)

    if (!codigo || !esCodigoClienteORucValido(cedula)) {
      setError('Ingresa el codigo del pedido y un codigo de cliente, cedula o RUC de 6 a 13 digitos.')
      setCargando(false)
      return
    }

    const { data, error } = await consultarPedidosInvitado(codigo, cedula)

    if (error) {
      setError(
        'No se pudo consultar el pedido. Ejecuta el SQL de acceso invitado en Supabase y vuelve a intentar.'
      )
      setCargando(false)
      return
    }

    if (!data || data.length === 0) {
      setError('No encontramos un pedido con ese codigo y cedula.')
      setCargando(false)
      return
    }

    const principal = data[0]
    setPedidosGrupo(data)
    setPedido(principal)
    setConsulta({ codigo, cedula })
    setReporteActivo(await tieneReporteActivoPedido(principal))
    setCargando(false)
  }

  async function enviarReporte(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!pedido) return

    setEnviandoReporte(true)
    setError('')
    setMensaje('')

    if (reporte.descripcion.trim().length < 12) {
      setError('Describe el problema con un poco mas de detalle.')
      setEnviandoReporte(false)
      return
    }

    const { error } = await crearReporteFranquiciado({
      pedido_id: pedido.id,
      codigo_consulta: pedido.codigo,
      cedula_solicitante: pedido.cedula_solicitante || consulta.cedula,
      solicitante: pedido.solicitante,
      motivo: reporte.motivo,
      descripcion: `Material reportado: ${pedido.material}\n\n${reporte.descripcion}`,
    })

    if (error) {
      setError('No se pudo registrar el reporte. Revisa la tabla reportes_franquiciado.')
      setEnviandoReporte(false)
      return
    }

    const esNotaCredito = reporte.motivo === 'nota_credito'
    if (esNotaCredito) {
      const { error: errorNc } = await solicitarNotaCredito(pedido.id, reporte.descripcion.trim())
      if (!errorNc) {
        setPedido({ ...pedido, estado_nc: 'solicitada', motivo_nc: reporte.descripcion.trim() })
        setPedidosGrupo((prev) =>
          prev.map((p) => (p.id === pedido.id ? { ...p, estado_nc: 'solicitada' } : p)),
        )
      }
    }

    setReporte(reporteInicial)
    setReporteActivo(true)
    setMensaje(
      esNotaCredito
        ? 'Solicitud de nota de crédito enviada. Bodega la revisará y confirmará el reembolso del material.'
        : 'Reporte recibido. El equipo operativo lo revisara en el modulo de reportes.',
    )
    setEnviandoReporte(false)
  }

  async function confirmarEntrega() {
    if (!pedido) return

    const confirmado = await confirmar({
      titulo: 'Confirmar entrega',
      mensaje: `¿Confirmas que recibiste el pedido ${pedido.codigo_consulta || pedido.codigo}? Esta acción actualizará el estado para el equipo operativo.`,
      confirmarTexto: 'Sí, recibí el pedido',
      peligro: false,
    })

    if (!confirmado) return

    setConfirmandoEntrega(true)
    setError('')
    setMensaje('')

    const { data, error } = await confirmarEntregaFranquiciado(pedido, consulta.cedula)

    if (error) {
      setError(error.message || 'No se pudo confirmar la entrega del pedido.')
      setConfirmandoEntrega(false)
      return
    }

    await registrarAuditoria({
      entidad: 'pedidos',
      entidad_id: pedido.id,
      accion: 'confirmar_entrega_franquiciado',
      detalle: `${pedido.codigo}: entrega confirmada por franquiciado en consulta invitada.`,
      responsable: 'Franquiciado',
    })

    setPedido((data as Pedido | null) || { ...pedido, estado: 'entregado', fecha_entrega: new Date().toISOString() })
    setMensaje('Entrega confirmada. El equipo operativo ya vera el pedido como entregado.')
    setConfirmandoEntrega(false)
  }

  async function seleccionarMaterial(seleccionado: Pedido) {
    setPedido(seleccionado)
    setReporte(reporteInicial)
    setError('')
    setMensaje('')
    setReporteActivo(await tieneReporteActivoPedido(seleccionado))
  }

  const pedidoConsultadoId = pedido?.id

  useEffect(() => {
    if (!pedidoConsultadoId || !consulta.codigo || !consulta.cedula) return

    let cancelado = false

    async function refrescarPedidoConsultado() {
      const { data } = await consultarPedidosInvitado(consulta.codigo, consulta.cedula)
      if (cancelado || !data || data.length === 0) return
      setPedidosGrupo(data)
      const actual = data.find((item) => item.id === pedidoConsultadoId) || data[0]
      setPedido(actual)
      setReporteActivo(await tieneReporteActivoPedido(actual))
    }

    const dejarDeEscucharPedidos = escucharPedidos(refrescarPedidoConsultado)

    return () => {
      cancelado = true
      dejarDeEscucharPedidos()
    }
  }, [consulta.cedula, consulta.codigo, pedidoConsultadoId])

  const progreso = useMemo(
    () => (reporteActivo ? 80 : calcularProgreso(pedido?.estado)),
    [pedido?.estado, reporteActivo],
  )
  const semaforo = reporteActivo ? 'riesgo' : pedido ? resolverSemaforoPedido(pedido) : null

  return (
    <div className="min-h-screen bg-[#fbf8ff] px-3 py-4 sm:px-5 lg:px-8 lg:py-6 xl:px-10">
      <main className="mx-auto grid w-full max-w-[1800px] overflow-hidden border border-[#cfc4c5] bg-white lg:min-h-[calc(100vh-3rem)] lg:grid-cols-[minmax(280px,0.26fr)_minmax(0,1fr)]">
        <aside className="relative hidden overflow-hidden border-r border-[#cfc4c5] bg-[#f4f2fd] p-8 lg:flex lg:flex-col xl:p-10">
          <div className="absolute inset-0 opacity-70 [background-image:radial-gradient(#cfc4c5_1px,transparent_1px)] [background-size:24px_24px]" />
          <div className="relative z-10">
            <img src={disensaLogo} alt="Disensa" className="mb-8 h-12 w-auto rounded object-contain" />
            <h1 className="text-3xl font-bold tracking-tight text-[#0f0f11]">Disensa Prioridad</h1>
            <p className="mt-5 max-w-xs text-lg leading-7 text-[#4c4546]">
              Consulta rapida de estado logistico para franquiciados.
            </p>
          </div>
          <div className="relative z-10 mt-auto">
            <Truck className="text-[#7e7576]" size={36} />
          </div>
        </aside>

        <section className="min-w-0 space-y-6 p-5 sm:p-8 lg:p-10 xl:p-12">
          <div className="flex flex-col gap-4 border-b border-[#cfc4c5] pb-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#a33e00]">Consulta de invitado</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#0f0f11]">Consulta de pedidos</h1>
              <p className="mt-2 text-sm text-[#5f5964]">
                Ingresa los datos para verificar el estado de tu orden.
              </p>
            </div>
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 rounded-md border-2 border-[#ed1c24] px-4 py-2.5 text-sm font-bold text-[#c8102e] transition hover:bg-[#fff0f0]"
            >
              <ArrowLeft size={16} />
              Regresar
            </Link>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(360px,460px)_minmax(0,1fr)]">
        <section className="self-start rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-orange-100 p-3 text-orange-700">
              <Search size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Consultar pedido</h2>
              <p className="mt-1 text-sm text-slate-500">
                Usa el codigo del pedido y el codigo de cliente o RUC del franquiciado.
              </p>
            </div>
          </div>

          <form onSubmit={consultar} className="mt-6 space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              Codigo unico
              <input
                value={consulta.codigo}
                onChange={(event) =>
                  setConsulta({
                    ...consulta,
                    codigo: textoMixtoOperativo(event.target.value, 60),
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Ej. PED-394049"
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Codigo de cliente o RUC
              <input
                type="text"
                inputMode="numeric"
                maxLength={13}
                pattern="\d*"
                value={consulta.cedula}
                onChange={(event) =>
                  setConsulta({ ...consulta, cedula: soloDigitos(event.target.value, 13) })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Ej. 6192102"
              />
            </label>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}

            {mensaje && (
              <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                {mensaje}
              </p>
            )}

            <button
              type="submit"
              disabled={cargando}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 font-semibold text-white transition hover:bg-orange-700 disabled:opacity-60"
            >
              <Search size={18} />
              {cargando ? 'Consultando...' : 'Consultar estado'}
            </button>
          </form>
        </section>

        <section className="space-y-6">
          {!pedido && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
              <ClipboardList className="mx-auto text-orange-600" size={36} />
              <p className="mt-3 font-semibold text-slate-800">Busca un pedido para ver su avance.</p>
              <p className="mt-1 text-sm">
                El franquiciado no necesita correo ni contrasena; debe coincidir pedido y cliente.
              </p>
            </div>
          )}

          {pedido && (
            <>
              {pedidosGrupo.length > 1 && (
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-semibold text-slate-700">
                    Este pedido tiene {pedidosGrupo.length} materiales. Elige por cual quieres consultar o reclamar:
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {pedidosGrupo.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => seleccionarMaterial(item)}
                        className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                          item.id === pedido.id
                            ? 'border-[#c8102e] bg-[#fff1ec] text-[#c8102e]'
                            : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {item.material}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <article className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-orange-700">
                      {pedido.codigo_consulta || pedido.codigo}
                    </p>
                    <h2 className="mt-1 text-2xl font-bold text-slate-900">{pedido.material}</h2>
                    <p className="mt-1 text-sm text-slate-500">{pedido.solicitante}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${colorEstado(pedido)}`}>
                    {semaforo ? etiquetaSemaforo(semaforo) : formatearEtiqueta(pedido.estado)}
                  </span>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <Dato
                    icono={<PackageCheck size={18} />}
                    label="Solicitado"
                    valor={`${pedido.cantidad} ${pedido.unidad_medida}`}
                  />
                  <Dato
                    icono={<Truck size={18} />}
                    label="Por despachar"
                    valor={`${cantidadParaDespacho(pedido)} ${pedido.unidad_medida}`}
                  />
                  <Dato
                    icono={<AlertTriangle size={18} />}
                    label="Fecha estimada de entrega"
                    valor={formatearFecha(pedido.fecha_compromiso)}
                  />
                  <Dato
                    icono={<AlertTriangle size={18} />}
                    label="Tiempo"
                    valor={describirTiempoPedido(pedido, { reabiertoPorReporte: reporteActivo })}
                  />
                </div>

                {reporteActivo && (
                  <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
                    <p className="font-semibold">Pedido reabierto por tu reporte</p>
                    <p className="mt-1">
                      El equipo operativo esta gestionando tu reporte. El avance se mantiene en 80%
                      hasta resolverlo.
                    </p>
                  </div>
                )}

                {pedido.estado_nc && (
                  <div className="mt-4 rounded-lg border border-violet-300 bg-violet-50 p-4 text-sm text-violet-900">
                    <p className="font-semibold">Nota de crédito — {etiquetaNc(pedido.estado_nc)}</p>
                    <p className="mt-1">{textoNc(pedido.estado_nc)}</p>
                  </div>
                )}

                <div className="mt-6">
                  <div className="mb-3 flex items-center justify-between text-sm">
                    <span className="font-semibold text-slate-700">Avance operativo</span>
                    <strong className="text-slate-900">{progreso}%</strong>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${
                        semaforo ? claseSemaforoBarra(semaforo) : 'bg-orange-500'
                      }`}
                      style={{ width: `${progreso}%` }}
                    />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {estadosFlujo.map((estado) => (
                      <div
                        key={estado}
                        className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                          estadoCompletado(pedido.estado, estado)
                            ? 'border-orange-200 bg-orange-50 text-orange-700'
                            : 'border-slate-200 bg-slate-50 text-slate-500'
                        }`}
                      >
                        {formatearEtiqueta(estado)}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-900">Confirmacion del franquiciado</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {textoConfirmacionEntrega(pedido.estado)}
                      </p>
                    </div>
                    {puedeConfirmarEntrega(pedido.estado) && (
                      <button
                        type="button"
                        onClick={confirmarEntrega}
                        disabled={confirmandoEntrega}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-60"
                      >
                        <CheckCircle2 size={18} />
                        {confirmandoEntrega ? 'Confirmando...' : 'Confirmar entrega'}
                      </button>
                    )}
                    {pedido.estado === 'entregado' && (
                      <span className="inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">
                        <CheckCircle2 size={16} />
                        Entrega confirmada
                      </span>
                    )}
                  </div>
                </div>
              </article>

              <form
                onSubmit={enviarReporte}
                className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-red-100 p-3 text-red-700">
                    <FileWarning size={22} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Reportar novedad</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Registra retrasos, material defectuoso u otra novedad del pedido.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-[0.8fr_1.2fr]">
                  <label className="block text-sm font-medium text-slate-700">
                    Motivo
                    <select
                      value={reporte.motivo}
                      onChange={(event) =>
                        setReporte({
                          ...reporte,
                          motivo: event.target.value as MotivoReporteFranquiciado,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      {motivosReporte.map((motivo) => (
                        <option key={motivo.valor} value={motivo.valor}>
                          {motivo.etiqueta}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-slate-700">
                    Detalle
                    <textarea
                      value={reporte.descripcion}
                      onChange={(event) =>
                        setReporte({
                          ...reporte,
                          descripcion: textoDescripcion(event.target.value, 800),
                        })
                      }
                      rows={3}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="Describe lo ocurrido"
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={enviandoReporte}
                  className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  <Send size={18} />
                  {enviandoReporte ? 'Enviando...' : 'Enviar reporte'}
                </button>
              </form>
            </>
          )}
        </section>
          </div>
        </section>
      </main>
    </div>
  )
}

function Dato({
  icono,
  label,
  valor,
}: {
  icono: ReactNode
  label: string
  valor: string
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-orange-700">{icono}</div>
      <p className="mt-3 text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{valor}</p>
    </div>
  )
}

function calcularProgreso(estado?: EstadoPedido) {
  if (!estado) return 0
  if (estado === 'cancelado' || estado === 'rechazado') return 0
  if (estado === 'retrasado' || estado === 'sin_stock') return 35
  const indice = estadosFlujo.indexOf(estado)
  if (indice < 0) return 20
  return Math.round(((indice + 1) / estadosFlujo.length) * 100)
}

function estadoCompletado(actual: EstadoPedido, estado: EstadoPedido) {
  if (actual === 'cancelado' || actual === 'rechazado') return false
  if (actual === 'retrasado' || actual === 'sin_stock') {
    return estado === 'pendiente' || estado === 'en_revision'
  }
  return estadosFlujo.indexOf(estado) <= estadosFlujo.indexOf(actual)
}

function textoConfirmacionEntrega(estado: EstadoPedido) {
  if (puedeConfirmarEntrega(estado)) {
    return 'Cuando recibas el material, confirma la entrega para cerrar el proceso operativo.'
  }

  if (estado === 'entregado') {
    return 'El pedido ya fue confirmado como entregado por el franquiciado.'
  }

  if (estado === 'cancelado' || estado === 'rechazado') {
    return 'Este pedido no permite confirmacion de entrega porque esta cerrado.'
  }

  return 'La confirmacion se habilitara cuando bodega marque el pedido como en despacho.'
}

function puedeConfirmarEntrega(estado: EstadoPedido) {
  return !['entregado', 'cancelado', 'rechazado'].includes(estado)
}

function colorEstado(pedido: Pedido) {
  return claseSemaforoBadge(resolverSemaforoPedido(pedido))
}

function cantidadParaDespacho(pedido: Pedido) {
  return pedido.cantidad_despacho && pedido.cantidad_despacho > 0
    ? pedido.cantidad_despacho
    : pedido.cantidad
}

function formatearFecha(fecha: string) {
  const date = new Date(fecha)
  if (Number.isNaN(date.getTime())) return 'Sin fecha'
  return date.toLocaleDateString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatearEtiqueta(valor: string) {
  return valor.replace(/_/g, ' ')
}
