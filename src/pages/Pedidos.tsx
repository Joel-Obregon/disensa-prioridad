import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Download,
  Edit3,
  Eye,
  MoreVertical,
  Plus,
  RotateCcw,
  Search,
  Truck,
  XCircle,
} from 'lucide-react'
import { useAuth } from '../auth/authState'
import { construirFrecuenciaClientes, ordenarPorPrioridad } from '../lib/prioridad'
import { useConfirmar } from '../components/ConfirmacionProvider'
import { silenciarAlertasPedido } from '../lib/alertSilencio'
import {
  claseSemaforoBadge,
  claseSemaforoBarra,
  describirTiempoPedido,
  etiquetaSemaforo,
  resolverSemaforoPedido,
  type SemaforoOperativo,
} from '../lib/semaforoOperativo'
import {
  esCodigoClienteORucValido,
  esEnteroPositivo,
  soloDigitos,
  soloEnteroNoNegativo,
  soloTextoNombre,
} from '../lib/validacionesFormulario'
import MaterialSearchSelect from '../components/MaterialSearchSelect'
import { registrarAuditoria } from '../services/auditoriaService'
import { obtenerAlertas } from '../services/alertasService'
import {
  escucharReportesFranquiciado,
  marcarReposicionEnviada,
  obtenerReportesFranquiciado,
} from '../services/franquiciadoService'
import { escucharInventarioOperativo, obtenerInventarioOperativo } from '../services/inventarioService'
import ModalExito from '../components/ModalExito'
import ModalAlerta from '../components/ModalAlerta'
import {
  obtenerPrioridadCriterios,
  suscribirseACriteriosPrioridad,
  type PrioridadCriterio,
} from '../services/prioridadCriteriosService'
import { escucharMateriales, obtenerMateriales } from '../services/materialesService'
import {
  actualizarCantidadDespachoPedido,
  actualizarNotaCredito,
  actualizarPedido,
  actualizarEstadoPedido,
  crearPedido,
  despacharPedido,
  escucharPedidos,
  obtenerClientesFranquiciado,
  obtenerPedidos,
} from '../services/pedidosService'
import {
  obtenerDetallesPedidosOperativos,
  type PedidoDetalleOperativo,
} from '../services/pedidosOperativosService'
import type { Alerta } from '../types/alerta'
import type { Material } from '../types/material'
import type {
  AccionSolicitante,
  CondicionMaterial,
  EstadoPedido,
  Pedido,
  TipoCasoPedido,
  UrgenciaPedido,
} from '../types/pedido'
import { ETIQUETAS_TIPO_CASO } from '../types/pedido'
import type { ReporteFranquiciado } from '../types/reporteFranquiciado'
import type { RolUsuario } from '../types/usuario'

type PedidoForm = {
  material_id: string
  cantidad: string
  cantidad_despacho: string
  origen: 'suministrador' | 'bodega'
  destino: 'bodega' | 'franquiciado'
  solicitante: string
  cedula_solicitante: string
  fecha_compromiso: string
  urgencia: UrgenciaPedido
  tipo_cliente: 'bodega' | 'franquiciado' | 'obra_critica'
  accion_solicitante: AccionSolicitante
  condicion_material: CondicionMaterial
  tipo_caso: TipoCasoPedido
}

type FiltrosPedido = {
  estado: 'todos' | EstadoPedido
  suministrador: string
  planificable: 'todos' | 'planificable' | 'no planificable' | 'agotar stock'
  periodo: string
}

type DetallesOperativosLookup = {
  porCodigoPedido: Map<string, PedidoDetalleOperativo>
  porConsulta: Map<string, PedidoDetalleOperativo>
}

type MaterialesLookup = {
  porId: Map<string, Material>
  porCodigo: Map<string, Material>
  porNombre: Map<string, Material>
}

type VistaPedidos = 'operativos' | 'historial'

type ClienteSolicitante = {
  nombre: string
  documento: string
}

const formularioInicial: PedidoForm = {
  material_id: '',
  cantidad: '',
  cantidad_despacho: '',
  origen: 'bodega',
  destino: 'franquiciado',
  solicitante: '',
  cedula_solicitante: '',
  fecha_compromiso: '',
  urgencia: 'media',
  tipo_cliente: 'franquiciado',
  accion_solicitante: 'despachar',
  condicion_material: 'normal',
  tipo_caso: 'falta_stock',
}

const filtrosIniciales: FiltrosPedido = {
  estado: 'todos',
  suministrador: 'todos',
  planificable: 'todos',
  periodo: 'todos',
}

const estadosPedido: EstadoPedido[] = [
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

const PEDIDOS_POR_PAGINA = 100

export default function Pedidos() {
  const { perfil } = useAuth()
  const rol = perfil?.rol || 'administrador'
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [materiales, setMateriales] = useState<Material[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [reportesFranquiciado, setReportesFranquiciado] = useState<ReporteFranquiciado[]>([])
  const [detallesOperativos, setDetallesOperativos] = useState<PedidoDetalleOperativo[]>([])
  const [clientesMaestro, setClientesMaestro] = useState<{ codigo_cliente: string | null; nombre_cliente: string | null }[]>([])
  const [catmanResponsable, setCatmanResponsable] = useState<Map<string, string>>(new Map())
  const [modalExito, setModalExito] = useState('')
  const [modalAlerta, setModalAlerta] = useState('')
  const [criteriosPrioridad, setCriteriosPrioridad] = useState<PrioridadCriterio[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const [vistaPedidos, setVistaPedidos] = useState<VistaPedidos>('operativos')
  const [filtros, setFiltros] = useState<FiltrosPedido>(filtrosIniciales)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [pedidoEditandoId, setPedidoEditandoId] = useState('')
  const [pedidoDetalle, setPedidoDetalle] = useState<Pedido | null>(null)
  const [reponiendoId, setReponiendoId] = useState<string | null>(null)
  const [formulario, setFormulario] = useState<PedidoForm>(formularioInicial)
  const [materialesPedido, setMaterialesPedido] = useState<{ material_id: string; cantidad: string }[]>([])

  async function cargarDatos() {
    const [
      pedidosResult,
      materialesResult,
      alertasResult,
      reportesFranquiciadoResult,
      detallesOperativosResult,
    ] =
      await Promise.all([
        obtenerPedidos(),
        obtenerMateriales(),
        obtenerAlertas({ incluirStockDerivado: false, sincronizarStock: false }),
        obtenerReportesFranquiciado(),
        obtenerDetallesPedidosOperativos(),
      ])

    if (!materialesResult.error) {
      setMateriales(materialesResult.data || [])
    }
    if (!alertasResult.error) setAlertas(alertasResult.data || [])
    if (!reportesFranquiciadoResult.error) {
      setReportesFranquiciado(reportesFranquiciadoResult.data || [])
    }
    if (!detallesOperativosResult.error) setDetallesOperativos(detallesOperativosResult.data || [])

    if (pedidosResult.error) {
      setError('No se pudieron cargar los pedidos desde Supabase.')
      setPedidos([])
      setCargando(false)
      return
    }

    setPedidos(pedidosResult.data || [])
    setCargando(false)
  }

  async function registrarPedido(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setGuardando(true)
    setError('')

    const material = materiales.find((item) => item.id === formulario.material_id)
    const cedulaSolicitante = normalizarCedula(formulario.cedula_solicitante)

    if (
      !formulario.solicitante.trim() ||
      !esCodigoClienteORucValido(cedulaSolicitante) ||
      !formulario.fecha_compromiso
    ) {
      setError('Completa solicitante, fecha requerida y codigo cliente/cedula/RUC entre 6 y 13 digitos.')
      setGuardando(false)
      return
    }

    if (formulario.material_id && !esEnteroPositivo(formulario.cantidad)) {
      setError('La cantidad solicitada debe ser un numero entero mayor a cero.')
      setGuardando(false)
      return
    }

    if (pedidoEditandoId) {
      if (!material) {
        setError('Selecciona un material para el pedido.')
        setGuardando(false)
        return
      }

      const cantidad = Number(formulario.cantidad)
      const { error } = await actualizarPedido(pedidoEditandoId, {
        codigo: pedidos.find((pedido) => pedido.id === pedidoEditandoId)?.codigo,
        codigo_consulta: pedidos.find((pedido) => pedido.id === pedidoEditandoId)?.codigo_consulta || undefined,
        codigo_material: material.codigo_material || null,
        material_id: material.id,
        material: material.nombre,
        cantidad,
        cantidad_despacho: cantidad,
        unidad_medida: material.unidad_medida,
        stock_disponible: material.stock_actual,
        origen: formulario.origen,
        destino: formulario.destino,
        solicitante: formulario.solicitante.trim(),
        cedula_solicitante: cedulaSolicitante,
        fecha_compromiso: formulario.fecha_compromiso,
        urgencia: formulario.urgencia,
        tipo_cliente: formulario.tipo_cliente,
        accion_solicitante: formulario.accion_solicitante,
        condicion_material: formulario.condicion_material,
        tipo_caso: formulario.tipo_caso,
      })

      if (error) {
        setError(error.message)
        setGuardando(false)
        return
      }

      await registrarAuditoria({
        entidad: 'pedidos',
        entidad_id: pedidoEditandoId,
        accion: 'editar_pedido',
        detalle: `Pedido actualizado: ${material.nombre}, cantidad ${cantidad}.`,
      })

      limpiarFormulario()
      cargarDatos()
      return
    }

    // Crear: lista de materiales (los agregados + el que quede en el campo).
    const itemsMateriales = [...materialesPedido]
    if (formulario.material_id && esEnteroPositivo(formulario.cantidad)) {
      itemsMateriales.push({ material_id: formulario.material_id, cantidad: formulario.cantidad })
    }

    const materialesResueltos = itemsMateriales
      .map((item) => ({
        material: materiales.find((m) => m.id === item.material_id),
        cantidad: Number(item.cantidad),
      }))
      .filter((item) => item.material && item.cantidad > 0)

    if (materialesResueltos.length === 0) {
      setError('Agrega al menos un material al pedido.')
      setGuardando(false)
      return
    }

    const codigoConsulta = generarCodigoPedido()
    const grupoId = materialesResueltos.length > 1 ? crypto.randomUUID() : null

    for (const [indice, item] of materialesResueltos.entries()) {
      const mat = item.material
      if (!mat) continue

      const { error } = await crearPedido({
        codigo: indice === 0 ? codigoConsulta : `${codigoConsulta}-${indice + 1}`,
        codigo_consulta: codigoConsulta,
        grupo_id: grupoId,
        codigo_material: mat.codigo_material || null,
        material_id: mat.id,
        material: mat.nombre,
        cantidad: item.cantidad,
        cantidad_despacho: item.cantidad,
        unidad_medida: mat.unidad_medida,
        stock_disponible: mat.stock_actual,
        origen: formulario.origen,
        destino: formulario.destino,
        solicitante: formulario.solicitante.trim(),
        cedula_solicitante: cedulaSolicitante,
        fecha_compromiso: formulario.fecha_compromiso,
        urgencia: formulario.urgencia,
        tipo_cliente: formulario.tipo_cliente,
        accion_solicitante: formulario.accion_solicitante,
        condicion_material: formulario.condicion_material,
        tipo_caso: formulario.tipo_caso,
      })

      if (error) {
        setError(error.message)
        setGuardando(false)
        return
      }
    }

    limpiarFormulario()
    cargarDatos()
    setModalExito(
      materialesResueltos.length > 1
        ? `Tu pedido con ${materialesResueltos.length} materiales se creo correctamente.`
        : 'Tu pedido se creo correctamente.',
    )
  }

  function limpiarFormulario() {
    setFormulario(formularioInicial)
    setMaterialesPedido([])
    setPedidoEditandoId('')
    setMostrarFormulario(false)
    setGuardando(false)
  }

  function agregarMaterialALista() {
    if (!formulario.material_id || !esEnteroPositivo(formulario.cantidad)) {
      setError('Elige un material y una cantidad valida para agregarlo a la lista.')
      return
    }
    setMaterialesPedido((lista) => [
      ...lista.filter((item) => item.material_id !== formulario.material_id),
      { material_id: formulario.material_id, cantidad: formulario.cantidad },
    ])
    setFormulario({ ...formulario, material_id: '', cantidad: '' })
    setError('')
  }

  function quitarMaterialDeLista(materialId: string) {
    setMaterialesPedido((lista) => lista.filter((item) => item.material_id !== materialId))
  }

  function iniciarNuevoPedido() {
    if (mostrarFormulario && !pedidoEditandoId) {
      setMostrarFormulario(false)
      return
    }

    setPedidoEditandoId('')
    setFormulario(formularioInicial)
    setMostrarFormulario(true)
  }

  function actualizarSolicitante(valor: string) {
    const solicitante = soloTextoNombre(valor, 100)
    const cliente = clientesDisponibles.find(
      (item) => normalizarTexto(item.nombre) === normalizarTexto(solicitante)
    )

    setFormulario({
      ...formulario,
      solicitante,
      cedula_solicitante: cliente?.documento || formulario.cedula_solicitante,
    })
  }

  function iniciarEdicion(pedido: Pedido) {
    const material = materiales.find(
      (item) =>
        item.id === pedido.material_id ||
        normalizarTexto(item.nombre) === normalizarTexto(pedido.material)
    )

    setPedidoEditandoId(pedido.id)
    setFormulario({
      material_id: material?.id || pedido.material_id || '',
      cantidad: String(pedido.cantidad),
      cantidad_despacho: String(cantidadParaDespacho(pedido)),
      origen: pedido.origen,
      destino: pedido.destino,
      solicitante: pedido.solicitante,
      cedula_solicitante: pedido.cedula_solicitante || '',
      fecha_compromiso: toDatetimeLocal(pedido.fecha_compromiso),
      urgencia: pedido.urgencia,
      tipo_cliente: pedido.tipo_cliente,
      accion_solicitante: pedido.accion_solicitante || 'despachar',
      condicion_material: pedido.condicion_material || 'normal',
      tipo_caso: pedido.tipo_caso || 'falta_stock',
    })
    setMostrarFormulario(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function cambiarEstado(pedido: Pedido, estado: EstadoPedido) {
    setError('')

    if (estado === 'cancelado') {
      const confirmado = await confirmar({
        titulo: 'Cancelar pedido',
        mensaje: `¿Seguro que quieres cancelar ${pedido.codigo}? El pedido se marcará como cancelado.`,
        confirmarTexto: 'Sí, cancelar',
      })
      if (!confirmado) return
    }

    const contexto = contextoOperativoPedido(pedido)
    const pedidoContextual = {
      ...pedido,
      material_id: contexto.material?.id || pedido.material_id,
      stock_disponible: contexto.stockDisponible,
    }

    if (estado === 'aprobado' && !stockSuficientePedido(pedido, contexto.stockDisponible)) {
      setModalAlerta('La operación no es posible por falta de stock.')
      setError(
        `No hay disponibilidad suficiente para aprobar ${pedido.codigo}. Stock disponible: ${contexto.stockDisponible}; requerido: ${cantidadParaDespacho(pedido)}.`
      )
      return
    }

    silenciarAlertasPedido(pedido.id, pedido.material_id)
    const { error } = await actualizarEstadoPedido(pedido.id, estado, {
      pedido: pedidoContextual,
      codigo_material: contexto.codigoMaterial,
      responsable: contexto.flujo === 'compra' ? 'Suministrador' : 'Bodega',
    })

    if (error) {
      setError(error.message)
      return
    }

    await registrarAuditoria({
      entidad: 'pedidos',
      entidad_id: pedido.id,
      accion: 'cambiar_estado',
      detalle: `${pedido.codigo}: ${pedido.estado} -> ${estado}.`,
    })

    cargarDatos()
  }

  async function gestionarNotaCredito(
    pedido: Pedido,
    estadoNc: 'en_revision' | 'aprobada' | 'efectiva' | 'rechazada',
  ) {
    setError('')

    if (estadoNc === 'efectiva' || estadoNc === 'rechazada') {
      const ok = await confirmar({
        titulo: estadoNc === 'efectiva' ? 'Hacer efectiva la nota de crédito' : 'Rechazar nota de crédito',
        mensaje:
          estadoNc === 'efectiva'
            ? `¿Confirmas el reembolso de ${pedido.material}? El material quedará como reembolsado y saldrá de pendientes.`
            : `¿Rechazar la nota de crédito de ${pedido.material}?`,
        confirmarTexto: estadoNc === 'efectiva' ? 'Sí, reembolsar' : 'Sí, rechazar',
        peligro: estadoNc === 'rechazada',
      })
      if (!ok) return
    }

    const { error } = await actualizarNotaCredito(pedido.id, estadoNc)
    if (error) {
      setError(error.message)
      return
    }

    await registrarAuditoria({
      entidad: 'pedidos',
      entidad_id: pedido.id,
      accion: 'nota_credito',
      detalle: `${pedido.codigo}: nota de crédito -> ${estadoNc}.`,
    })

    const patch: Partial<Pedido> = { estado_nc: estadoNc }
    if (estadoNc === 'efectiva') patch.estado = 'cancelado'
    setPedidoDetalle((prev) => (prev && prev.id === pedido.id ? { ...prev, ...patch } : prev))

    setModalExito(
      estadoNc === 'efectiva'
        ? 'Nota de crédito efectiva. Material reembolsado y fuera de pendientes.'
        : estadoNc === 'rechazada'
          ? 'Nota de crédito rechazada.'
          : 'Nota de crédito actualizada.',
    )
    cargarDatos()
  }

  async function despacharPedidoSeleccionado(pedido: Pedido) {
    setError('')

    const contexto = contextoOperativoPedido(pedido)
    const pedidoContextual = {
      ...pedido,
      material_id: contexto.material?.id || pedido.material_id,
      stock_disponible: contexto.stockDisponible,
    }

    if (!stockSuficientePedido(pedido, contexto.stockDisponible)) {
      setModalAlerta('La operación no es posible por falta de stock.')
      setError(
        `No se puede despachar ${pedido.codigo}: el inventario no cubre la entrega propuesta. Stock disponible: ${contexto.stockDisponible}; requerido: ${cantidadParaDespacho(pedido)}.`
      )
      return
    }

    const confirmado = await confirmar({
      titulo: 'Confirmar despacho',
      mensaje: `¿Despachar ${pedido.codigo}? Esto descontará stock, registrará movimiento de inventario y dejará auditoría.`,
      confirmarTexto: 'Despachar',
      peligro: false,
    })

    if (!confirmado) return

    silenciarAlertasPedido(pedido.id, contexto.material?.id || pedido.material_id)
    const { error } = await despacharPedido(pedidoContextual, {
      material_id: contexto.material?.id || pedido.material_id,
      codigo_material: contexto.codigoMaterial,
      stock_disponible_operativo: contexto.stockDisponible,
      responsable: 'Bodega',
    })

    if (error) {
      setError(error.message)
      return
    }

    await registrarAuditoria({
      entidad: 'pedidos',
      entidad_id: pedido.id,
      accion: 'despachar_pedido',
      detalle: `${pedido.codigo}: despacho real registrado y stock descontado.`,
    })

    await cargarDatos()
  }

  async function reponerPedidoReportado(pedido: Pedido) {
    setError('')

    // Guard 1: ya hay una reposicion en curso (evita doble clic / doble descuento).
    if (reponiendoId) return

    // Guard 2: si el reporte ya paso a "en_revision", la reposicion ya se hizo y
    // el sistema espera la validacion del franquiciado. No se vuelve a descontar.
    if (tieneReporteActivo(pedido, pedidosConReposicionPendiente)) {
      setError(`${pedido.codigo} ya fue repuesto y espera la validacion del franquiciado.`)
      return
    }

    const contexto = contextoOperativoPedido(pedido)
    const cantidadOriginal = Math.max(1, cantidadParaDespacho(pedido))
    const cantidadIngresada = window.prompt(
      `Cantidad de ${pedido.material} a reponer por reporte del franquiciado:`,
      String(cantidadOriginal)
    )

    if (!cantidadIngresada) return

    const cantidadReposicion = Number(cantidadIngresada.replace(',', '.'))

    if (!Number.isFinite(cantidadReposicion) || cantidadReposicion <= 0 || !Number.isInteger(cantidadReposicion)) {
      setError('La cantidad a reponer debe ser un numero entero mayor a cero.')
      return
    }

    if (cantidadReposicion > contexto.stockDisponible) {
      setError(
        `No se puede reponer ${pedido.codigo}: stock disponible ${contexto.stockDisponible}; requerido ${cantidadReposicion}.`
      )
      return
    }

    const confirmado = await confirmar({
      titulo: 'Reponer pedido',
      mensaje: `¿Reponer y reenviar ${cantidadReposicion} de ${pedido.material}? Se descontará stock una sola vez y el pedido quedará a la espera de que el franquiciado valide la entrega.`,
      confirmarTexto: 'Reponer',
      peligro: false,
    })

    if (!confirmado) return

    setReponiendoId(pedido.id)

    try {
      const cantidadDespachoAnterior = pedido.cantidad_despacho ?? null
      const cantidadResult = await actualizarCantidadDespachoPedido(pedido.id, cantidadReposicion)

      if (cantidadResult.error) {
        setError(cantidadResult.error.message)
        return
      }

      const pedidoReposicion = {
        ...pedido,
        material_id: contexto.material?.id || pedido.material_id,
        cantidad_despacho: cantidadReposicion,
        stock_disponible: contexto.stockDisponible,
      }

      const { error } = await despacharPedido(pedidoReposicion, {
        material_id: contexto.material?.id || pedido.material_id,
        codigo_material: contexto.codigoMaterial,
        stock_disponible_operativo: contexto.stockDisponible,
        responsable: 'Bodega',
      })

      if (error) {
        await actualizarCantidadDespachoPedido(pedido.id, cantidadDespachoAnterior)
        setError(error.message)
        return
      }

      // La reposicion ya desconto stock: se marca el reporte como "en_revision"
      // para bloquear el boton Reponer y esperar la validacion del franquiciado.
      const marcado = await marcarReposicionEnviada(pedido)
      if (marcado.error) {
        setError(
          `Se repuso ${pedido.codigo}, pero no se pudo marcar la espera de validacion: ${marcado.error.message}`
        )
      }

      await registrarAuditoria({
        entidad: 'pedidos',
        entidad_id: pedido.id,
        accion: 'reponer_reporte_franquiciado',
        detalle: `${pedido.codigo}: reposicion por reporte de ${cantidadReposicion} ${pedido.unidad_medida || 'UN'} de ${pedido.material}. Pendiente de validacion del franquiciado.`,
      })

      await cargarDatos()
    } finally {
      setReponiendoId(null)
    }
  }

  function contextoOperativoPedido(pedido: Pedido) {
    const detalle = obtenerDetalleOperativo(pedido, detallesOperativosLookup)
    const material = buscarMaterialPedido(pedido, detalle, materialesLookup)
    const stockDisponible = stockDisponiblePedido(pedido, material, detalle)
    const flujo = flujoOperativoPedido(pedido, detalle)
    const codigoMaterial = detalle?.codigo_material || material?.codigo_material || null

    return { detalle, material, stockDisponible, flujo, codigoMaterial }
  }

  async function reactivarPedidoSeleccionado(pedido: Pedido) {
    setError('')

    const nota = window.prompt(
      `Explica por que se reactiva ${pedido.codigo}. Esta nota quedara en el historial.`
    )

    if (!nota || nota.trim().length < 8) {
      setError('Para reactivar un pedido cancelado debes agregar una nota clara.')
      return
    }

    const { error } = await actualizarEstadoPedido(pedido.id, 'pendiente')

    if (error) {
      setError(error.message)
      return
    }

    await registrarAuditoria({
      entidad: 'pedidos',
      entidad_id: pedido.id,
      accion: 'reactivar_pedido',
      detalle: `${pedido.codigo}: cancelado -> pendiente. Nota: ${nota.trim()}`,
    })

    await cargarDatos()
  }

  useEffect(() => {
    const timer = window.setTimeout(cargarDatos, 0)
    const dejarDeEscucharPedidos = escucharPedidos(cargarDatos)
    const dejarDeEscucharMateriales = escucharMateriales(cargarDatos)
    const dejarDeEscucharInventario = escucharInventarioOperativo(cargarDatos)
    const dejarDeEscucharReportes = escucharReportesFranquiciado(cargarDatos)

    return () => {
      window.clearTimeout(timer)
      dejarDeEscucharPedidos()
      dejarDeEscucharMateriales()
      dejarDeEscucharInventario()
      dejarDeEscucharReportes()
    }
  }, [])

  // Mapa material -> responsable del catman (para mostrarlo al elegir el material).
  useEffect(() => {
    let activo = true
    obtenerInventarioOperativo().then((resultado) => {
      if (!activo || resultado.error) return
      const mapa = new Map<string, string>()
      ;(resultado.data || []).forEach((material) => {
        if (material.catman_nombre) mapa.set(material.id, material.catman_nombre)
      })
      setCatmanResponsable(mapa)
    })
    return () => {
      activo = false
    }
  }, [])

  useEffect(() => {
    let activo = true
    const cargarCriterios = () =>
      obtenerPrioridadCriterios().then((resultado) => {
        if (!activo || resultado.error) return
        setCriteriosPrioridad(resultado.data || [])
      })
    cargarCriterios()
    const desuscribir = suscribirseACriteriosPrioridad(cargarCriterios)
    return () => {
      activo = false
      desuscribir()
    }
  }, [])

  useEffect(() => {
    obtenerClientesFranquiciado().then((resultado) => {
      if (!resultado.error) setClientesMaestro(resultado.data || [])
    })
  }, [])

  const confirmar = useConfirmar()

  function actualizarFiltros(filtro: Partial<FiltrosPedido>) {
    setFiltros((actuales) => ({ ...actuales, ...filtro }))
    setPagina(1)
  }

  function limpiarFiltros() {
    setBusqueda('')
    setFiltros(filtrosIniciales)
    setPagina(1)
  }

  function cambiarVistaPedidos(vista: VistaPedidos) {
    setVistaPedidos(vista)
    setPagina(1)
  }

  const materialesLookup = useMemo(() => {
    const porId = new Map<string, Material>()
    const porCodigo = new Map<string, Material>()
    const porNombre = new Map<string, Material>()

    materiales.forEach((material) => {
      porId.set(material.id, material)
      if (material.codigo_material) porCodigo.set(material.codigo_material, material)
      const llaveNombre = normalizarTexto(material.nombre)
      const actual = porNombre.get(llaveNombre)

      if (!actual || material.stock_actual < actual.stock_actual) {
        porNombre.set(llaveNombre, material)
      }
    })

    return { porId, porCodigo, porNombre }
  }, [materiales])

  const detallesOperativosLookup = useMemo(() => {
    const porCodigoPedido = new Map<string, PedidoDetalleOperativo>()
    const porConsulta = new Map<string, PedidoDetalleOperativo>()

    detallesOperativos.forEach((detalle) => {
      if (detalle.codigo_pedido) porCodigoPedido.set(detalle.codigo_pedido, detalle)
      if (detalle.codigo_consulta) porConsulta.set(detalle.codigo_consulta, detalle)
    })

    return { porCodigoPedido, porConsulta }
  }, [detallesOperativos])

  const clientesDisponibles = useMemo<ClienteSolicitante[]>(() => {
    const porNombre = new Map<string, ClienteSolicitante>()

    const registrar = (nombreRaw: string | null | undefined, documentoRaw: string) => {
      const nombre = nombreRaw?.trim()
      if (!nombre) return
      const documento = normalizarCedula(documentoRaw || '')
      const llave = normalizarTexto(nombre)
      const actual = porNombre.get(llave)
      if (!actual || (!actual.documento && documento)) {
        porNombre.set(llave, { nombre, documento })
      }
    }

    // Lista maestra de clientes: su cedula/RUC esta en codigo_cliente.
    clientesMaestro.forEach((cliente) =>
      registrar(cliente.nombre_cliente, cliente.codigo_cliente || '')
    )

    // Clientes que ya aparecen en pedidos previos.
    pedidos.forEach((pedido) => {
      const detalle = obtenerDetalleOperativo(pedido, detallesOperativosLookup)
      registrar(pedido.solicitante, detalle?.codigo_cliente || pedido.cedula_solicitante || '')
    })

    return [...porNombre.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [clientesMaestro, detallesOperativosLookup, pedidos])

  const pedidosConStockReal = useMemo(() => {
    return pedidos
      .filter(
        (pedido) =>
          flujoOperativoPedido(
            pedido,
            obtenerDetalleOperativo(pedido, detallesOperativosLookup),
          ) === 'venta',
      )
      .map((pedido) => {
      const detalleOperativo = obtenerDetalleOperativo(pedido, detallesOperativosLookup)
      const material = buscarMaterialPedido(pedido, detalleOperativo, materialesLookup)

      const base = {
        ...pedido,
        accion_solicitante: pedido.accion_solicitante || 'despachar',
        condicion_material: pedido.condicion_material || 'normal',
        cantidad_despacho: cantidadParaDespacho(pedido),
        codigo_consulta: pedido.codigo_consulta || pedido.codigo,
        cedula_solicitante: pedido.cedula_solicitante || '',
        // Preservar valor_pendiente para que calcularPrioridad() aplique
        // la regla "Valor pendiente" del motor de priorizacion
        valor_pendiente: pedido.valor_pendiente ?? 0,
      }

      const stockDisponible = stockDisponiblePedido(base, material, detalleOperativo)

      if (!material) {
        return {
          ...base,
          stock_disponible: stockDisponible,
        }
      }

      return {
        ...base,
        material: material.nombre,
        stock_disponible: stockDisponible,
        unidad_medida: material.unidad_medida || pedido.unidad_medida,
      }
    })
  }, [detallesOperativosLookup, materialesLookup, pedidos])

  const suministradoresFiltro = useMemo(() => {
    return [
      ...new Set(
        detallesOperativos
          .map((detalle) => detalle.nombre_suministrador)
          .filter((suministrador): suministrador is string => Boolean(suministrador))
      ),
    ].sort((a, b) => a.localeCompare(b))
  }, [detallesOperativos])

  const periodosFiltro = useMemo(() => {
    return [
      ...new Set(
        pedidosConStockReal
          .map((pedido) => periodoPedido(pedido.fecha_compromiso))
          .filter((periodo): periodo is string => Boolean(periodo))
      ),
    ].sort((a, b) => b.localeCompare(a))
  }, [pedidosConStockReal])

  const pedidosFiltrados = useMemo(() => {
    const texto = normalizarTexto(busqueda)
    return pedidosConStockReal.filter((pedido) => {
      const detalleOperativo = obtenerDetalleOperativo(pedido, detallesOperativosLookup)
      const coincideTexto = texto
        ? [
            pedido.codigo,
            pedido.codigo_consulta || '',
            pedido.cedula_solicitante || '',
            pedido.solicitante,
            pedido.material,
            detalleOperativo?.codigo_cliente || '',
            detalleOperativo?.zonas || '',
            detalleOperativo?.codigo_material || '',
            detalleOperativo?.nombre_material || '',
            detalleOperativo?.nombre_suministrador || '',
            pedido.estado,
            pedido.urgencia,
            pedido.accion_solicitante || '',
            pedido.condicion_material || '',
          ]
            .join(' ')
            .toLowerCase()
            .includes(texto)
        : true
      const coincideEstado = filtros.estado === 'todos' || pedido.estado === filtros.estado
      const coincideSuministrador =
        filtros.suministrador === 'todos' ||
        detalleOperativo?.nombre_suministrador === filtros.suministrador
      const coincidePlanificable =
        filtros.planificable === 'todos' ||
        detalleOperativo?.estado_planificable === filtros.planificable
      const coincidePeriodo =
        filtros.periodo === 'todos' || periodoPedido(pedido.fecha_compromiso) === filtros.periodo

      return (
        coincideTexto &&
        coincideEstado &&
        coincideSuministrador &&
        coincidePlanificable &&
        coincidePeriodo
      )
    })
  }, [busqueda, detallesOperativosLookup, filtros, pedidosConStockReal])

  const pedidosConReporteActivo = useMemo(() => {
    const codigos = new Set<string>()

    reportesFranquiciado
      .filter((reporte) => reporte.estado !== 'cerrado')
      .forEach((reporte) => {
        if (reporte.pedido_id) codigos.add(`id:${reporte.pedido_id}`)
        if (reporte.codigo_consulta) codigos.add(`codigo:${normalizarTexto(reporte.codigo_consulta)}`)
      })

    return codigos
  }, [reportesFranquiciado])

  // Pedidos cuyo reporte ya paso a "en_revision": la reposicion se envio y el
  // sistema espera la validacion del franquiciado (el boton Reponer se bloquea).
  const pedidosConReposicionPendiente = useMemo(() => {
    const codigos = new Set<string>()

    reportesFranquiciado
      .filter((reporte) => reporte.estado === 'en_revision')
      .forEach((reporte) => {
        if (reporte.pedido_id) codigos.add(`id:${reporte.pedido_id}`)
        if (reporte.codigo_consulta) codigos.add(`codigo:${normalizarTexto(reporte.codigo_consulta)}`)
      })

    return codigos
  }, [reportesFranquiciado])

  const pedidosOperativos = useMemo(
    () =>
      ordenarPorPrioridad(
        pedidosFiltrados.filter(
          (pedido) => !pedidoCerrado(pedido.estado) || tieneReporteActivo(pedido, pedidosConReporteActivo)
        ),
        criteriosPrioridad,
        construirFrecuenciaClientes(pedidos)
      ),
    [pedidosConReporteActivo, pedidosFiltrados, criteriosPrioridad, pedidos]
  )

  const pedidosHistorial = useMemo(
    () =>
      pedidosFiltrados
        .filter((pedido) => pedidoCerrado(pedido.estado) && !tieneReporteActivo(pedido, pedidosConReporteActivo))
        .sort(ordenarPedidosHistorial),
    [pedidosConReporteActivo, pedidosFiltrados]
  )

  const busquedaActiva = busqueda.trim().length > 0
  const pedidosBusqueda = useMemo(
    () => (busquedaActiva ? [...pedidosOperativos, ...pedidosHistorial] : []),
    [busquedaActiva, pedidosHistorial, pedidosOperativos]
  )
  const pedidosPriorizados = busquedaActiva
    ? pedidosBusqueda
    : vistaPedidos === 'historial'
      ? pedidosHistorial
      : pedidosOperativos

  const totalPaginas = Math.max(1, Math.ceil(pedidosPriorizados.length / PEDIDOS_POR_PAGINA))
  const paginaActual = Math.min(pagina, totalPaginas)
  const pedidosVisibles = useMemo(() => {
    const inicio = (paginaActual - 1) * PEDIDOS_POR_PAGINA
    return pedidosPriorizados.slice(inicio, inicio + PEDIDOS_POR_PAGINA)
  }, [paginaActual, pedidosPriorizados])

  const primerPedidoVisible =
    pedidosPriorizados.length === 0 ? 0 : (paginaActual - 1) * PEDIDOS_POR_PAGINA + 1
  const ultimoPedidoVisible = Math.min(paginaActual * PEDIDOS_POR_PAGINA, pedidosPriorizados.length)

  return (
    <div className="pedidos-module -m-4 min-h-[calc(100vh-4rem)] border-t border-[#efc7b8] bg-[#fff9f6] text-[#261812] sm:-m-6">
      <div className="px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 border-b border-[#efc7b8] pb-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-black">Pedidos Priorizados</h1>
            <p className="mt-2 text-base text-[#5a4136]">
              {vistaPedidos === 'historial'
                ? 'Pedidos cerrados ordenados por cierre mas reciente.'
                : 'Gestion y seguimiento de ordenes criticas.'}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => exportarPedidosCsv(pedidosPriorizados)}
              className="inline-flex items-center justify-center gap-2 border border-[#c99582] bg-white px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.08em] text-[#2b160f] transition hover:bg-[#fff1eb]"
            >
              <Download size={17} />
              Exportar
            </button>
            <button
              type="button"
              onClick={iniciarNuevoPedido}
              className="inline-flex items-center justify-center gap-2 bg-[#a33e00] px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.08em] text-white transition hover:bg-[#842f00]"
            >
              <Plus size={18} />
              {mostrarFormulario && !pedidoEditandoId ? 'Cancelar' : 'Nuevo pedido'}
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(260px,1.8fr)_repeat(4,minmax(150px,1fr))]">
          <div className="field-shell flex min-h-11 items-center border border-[#dfad9c] bg-white px-4">
            <Search size={18} className="text-[#5a4136]" />
            <input
              value={busqueda}
              onChange={(event) => {
                setBusqueda(event.target.value)
                setPagina(1)
              }}
              className="w-full border-0 bg-transparent px-3 py-2 outline-none"
              placeholder="Buscar pedido, cliente o material..."
            />
          </div>
          <FiltroSelect
            label="Estado"
            placeholder="Estado (Todos)"
            value={filtros.estado}
            onChange={(estado) =>
              actualizarFiltros({ estado: estado as FiltrosPedido['estado'] })
            }
            opciones={['todos', ...estadosPedido]}
          />
          <FiltroSelect
            label="Nombre del suministrador"
            placeholder="Suministrador (Todos)"
            value={filtros.suministrador}
            onChange={(suministrador) => actualizarFiltros({ suministrador })}
            opciones={['todos', ...suministradoresFiltro]}
          />
          <FiltroSelect
            label="Estado planificable"
            placeholder="Estado Planificable"
            value={filtros.planificable}
            onChange={(planificable) =>
              actualizarFiltros({ planificable: planificable as FiltrosPedido['planificable'] })
            }
            opciones={['todos', 'planificable', 'no planificable', 'agotar stock']}
          />
          <FiltroSelect
            label="Mes y ano"
            placeholder="Mes y ano"
            value={filtros.periodo}
            onChange={(periodo) => actualizarFiltros({ periodo })}
            opciones={['todos', ...periodosFiltro]}
            formatOption={formatearPeriodoFiltro}
          />
        </div>

        <button
          type="button"
          onClick={limpiarFiltros}
          className="mt-5 text-sm font-semibold text-[#a33e00] transition hover:text-[#7a2f00]"
        >
          Limpiar filtros
        </button>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => cambiarVistaPedidos('operativos')}
            className={`px-4 py-2 text-sm font-semibold transition ${
              vistaPedidos === 'operativos'
                ? 'bg-[#261812] text-white'
                : 'border border-[#dfad9c] bg-white text-[#3f2d25] hover:bg-[#fff1eb]'
            }`}
          >
            Operativos ({pedidosOperativos.length})
          </button>
          <button
            type="button"
            onClick={() => cambiarVistaPedidos('historial')}
            className={`px-4 py-2 text-sm font-semibold transition ${
              vistaPedidos === 'historial'
                ? 'bg-[#261812] text-white'
                : 'border border-[#dfad9c] bg-white text-[#3f2d25] hover:bg-[#fff1eb]'
            }`}
          >
            Historial cerrado ({pedidosHistorial.length})
          </button>
        </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {mostrarFormulario && (
        <form
          onSubmit={registrarPedido}
          className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-slate-800">
            {pedidoEditandoId ? 'Editar pedido' : 'Registrar pedido'}
          </h2>

          <datalist id="solicitantes-pedido">
            {clientesDisponibles.map((cliente) => (
              <option
                key={`${cliente.nombre}-${cliente.documento}`}
                value={cliente.nombre}
                label={cliente.documento ? `Codigo ${cliente.documento}` : undefined}
              />
            ))}
          </datalist>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            <MaterialSearchSelect
              label="Material"
              materiales={materiales}
              value={formulario.material_id}
              onChange={(material_id) => setFormulario({ ...formulario, material_id })}
              placeholder="Escribe nombre, codigo o categoria"
              emptyLabel="No hay materiales con esas letras."
            />

            <Campo label="Cantidad solicitada por franquiciado">
              <input
                type="text"
                inputMode="numeric"
                maxLength={7}
                pattern="\d*"
                value={formulario.cantidad}
                onChange={(event) =>
                  setFormulario({
                    ...formulario,
                    cantidad: soloEnteroNoNegativo(event.target.value, 7),
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Ej. 50"
              />
            </Campo>

            {!pedidoEditandoId && (
              <div className="md:col-span-3">
                <button
                  type="button"
                  onClick={agregarMaterialALista}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#c8102e] px-4 py-2 text-sm font-semibold text-[#c8102e] transition hover:bg-[#fff1ec]"
                >
                  <Plus size={16} /> Agregar material a la lista
                </button>

                {materialesPedido.length > 0 && (
                  <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {materialesPedido.map((item, indice) => {
                      const mat = materiales.find((m) => m.id === item.material_id)
                      return (
                        <li
                          key={item.material_id}
                          className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                        >
                          <span className="min-w-0 flex-1 truncate text-slate-700">
                            <span className="mr-2 font-semibold text-[#a33e00]">{indice + 1}.</span>
                            {mat?.nombre || item.material_id} - {item.cantidad} {mat?.unidad_medida || ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => quitarMaterialDeLista(item.material_id)}
                            className="text-slate-400 transition hover:text-[#c8102e]"
                            aria-label="Quitar material"
                          >
                            <XCircle size={18} />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}

                <p className="mt-2 text-xs text-slate-500">
                  Agrega uno o varios materiales; se guardan como un solo pedido.
                </p>
              </div>
            )}

            <Campo label="Solicitante">
              <input
                list="solicitantes-pedido"
                value={formulario.solicitante}
                onChange={(event) => actualizarSolicitante(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Selecciona existente o escribe uno nuevo"
              />
            </Campo>

            <Campo label="Codigo cliente, cedula o RUC">
              <input
                type="text"
                inputMode="numeric"
                maxLength={13}
                pattern="\d*"
                value={formulario.cedula_solicitante}
                onChange={(event) =>
                  setFormulario({
                    ...formulario,
                    cedula_solicitante: soloDigitos(event.target.value, 13),
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Ej. 6192102 o 0912345678"
              />
            </Campo>

            <Campo label="Flujo del pedido">
              <input
                type="text"
                value="Bodega a franquiciado"
                readOnly
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-slate-600 outline-none"
              />
            </Campo>

            <Campo label="Fecha requerida">
              <input
                type="datetime-local"
                value={formulario.fecha_compromiso}
                onChange={(event) =>
                  setFormulario({
                    ...formulario,
                    fecha_compromiso: event.target.value,
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 outline-none focus:ring-2 focus:ring-orange-500"
              />
            </Campo>

            <Campo label="Urgencia">
              <select
                value={formulario.urgencia}
                onChange={(event) =>
                  setFormulario({
                    ...formulario,
                    urgencia: event.target.value as PedidoForm['urgencia'],
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="critica">Critica</option>
              </select>
            </Campo>

            <Campo label="Tipo de caso">
              <select
                value={formulario.tipo_caso}
                onChange={(event) =>
                  setFormulario({
                    ...formulario,
                    tipo_caso: event.target.value as TipoCasoPedido,
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 outline-none focus:ring-2 focus:ring-orange-500"
              >
                {Object.entries(ETIQUETAS_TIPO_CASO).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
            </Campo>

          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={guardando || materiales.length === 0}
              className="rounded-lg bg-slate-900 px-5 py-2 font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {guardando ? 'Guardando...' : pedidoEditandoId ? 'Guardar cambios' : 'Guardar pedido'}
            </button>
            {pedidoEditandoId && (
              <button
                type="button"
                onClick={limpiarFormulario}
                className="ml-3 rounded-lg border border-slate-300 px-5 py-2 font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancelar edicion
              </button>
            )}
          </div>
        </form>
      )}

      <section className="pedidos-table-shell mt-6 min-h-[520px] border border-[#d7e1ec] bg-[#f8fbff] p-4 pb-28 shadow-sm">
        <div className="pedidos-table-scroll overflow-x-auto overflow-y-visible pb-20">
          <table className="w-full min-w-[1480px] text-sm">
            <thead className="pedidos-table-head bg-[#fff1eb] text-[#3a1a10]">
              <tr>
                <th className="px-5 py-4 text-left">Pedido</th>
                <th className="px-5 py-4 text-left">Flujo</th>
                <th className="px-5 py-4 text-left">Material</th>
                <th className="px-5 py-4 text-left">Catman responsable</th>
                <th className="px-5 py-4 text-left">Cantidad</th>
                <th className="px-5 py-4 text-left">Resolucion</th>
                <th className="px-5 py-4 text-left">Stock disponible</th>
                <th className="px-5 py-4 text-left">Reabastecimiento pendiente</th>
                <th className="px-5 py-4 text-left">Estado</th>
                <th className="px-5 py-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pedidosVisibles.map((pedido) => {
                const enHistorial =
                  pedidoCerrado(pedido.estado) && !tieneReporteActivo(pedido, pedidosConReporteActivo)
                const reabiertoPorReporte = tieneReporteActivo(pedido, pedidosConReporteActivo)
                const reposicionPendiente = tieneReporteActivo(pedido, pedidosConReposicionPendiente)
                const cantidadPendiente = cantidadParaDespacho(pedido)
                const detalleOperativo = obtenerDetalleOperativo(pedido, detallesOperativosLookup)
                const material = buscarMaterialPedido(pedido, detalleOperativo, materialesLookup)
                const flujo = flujoOperativoPedido(pedido, detalleOperativo)
                const puedeGestionar = puedeGestionarFlujo(flujo, rol)
                const resolucion = resolucionPedido(pedido, detalleOperativo)
                const semaforoBaseRetraso = resolverSemaforoPedido(pedido)
                const semaforoRetraso =
                  reabiertoPorReporte &&
                  (semaforoBaseRetraso === 'cerrado' || semaforoBaseRetraso === 'a_tiempo')
                    ? 'riesgo'
                    : semaforoBaseRetraso
                const stockDisponible = stockDisponiblePedido(pedido, material, detalleOperativo)
                const reabastecimiento = reabastecimientoPedido(detalleOperativo)
                const estadoVisible = enHistorial
                  ? 'Cerrado'
                  : reposicionPendiente
                    ? 'Esperando validacion del franquiciado'
                    : reabiertoPorReporte
                      ? 'Reabierto por reporte'
                      : resolucion
                const semaforoProducto = resolverSemaforoProducto(
                  stockDisponible,
                  cantidadPendiente,
                  reabastecimiento
                )

                return (
                  <tr key={pedido.id} className="border-t border-[#ecd7ce] bg-white align-middle">
                    <td className="relative px-5 py-4 pl-8">
                      <span
                        aria-hidden="true"
                        className={`absolute left-0 top-1/2 h-9 w-1 -translate-y-1/2 rounded-full ${claseBarraSemaforo(semaforoRetraso)}`}
                      />
                      <p className="font-semibold text-black">{pedido.codigo}</p>
                      <p className="mt-1 text-xs font-medium text-[#7e5a4b]">
                        {describirTiempoPedido(pedido, { reabiertoPorReporte })}
                      </p>
                      <p className="mt-1 text-xs font-medium text-[#7e5a4b]">
                        Zonas: {detalleOperativo?.zonas || 'Sin zona registrada'}
                      </p>
                      <p className="text-xs font-medium text-[#7e5a4b]">{pedido.solicitante}</p>
                      <p className="text-xs font-medium text-[#7e5a4b]">
                        Codigo cliente {detalleOperativo?.codigo_cliente || pedido.cedula_solicitante || 'Sin registrar'}
                      </p>
                      <p className="mt-1 text-xs font-medium text-[#7e5a4b]">
                        {new Date(pedido.fecha_compromiso).toLocaleDateString()}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-black">
                        {etiquetaFlujo(flujo)}
                      </p>
                      <p className="mt-1 text-xs font-medium text-[#7e5a4b]">
                        {pedido.origen} a {pedido.destino}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium text-black">
                        {nombreMaterialPedido(pedido, material, detalleOperativo)}
                      </p>
                      <p className="mt-1 text-xs font-medium text-[#7e5a4b]">
                        {detalleOperativo?.nombre_suministrador ||
                          obtenerSuministradorDesdePedido(pedido) ||
                          'Sin suministrador registrado'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge texto={formatearEtiqueta(pedido.condicion_material || 'normal')} />
                        {pedido.estado_nc && (
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              pedido.estado_nc === 'efectiva'
                                ? 'bg-green-100 text-green-700'
                                : pedido.estado_nc === 'rechazada'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-violet-100 text-violet-800 ring-1 ring-violet-300'
                            }`}
                          >
                            NC: {etiquetaEstadoNc(pedido.estado_nc)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-xs font-semibold text-[#7e5a4b]">
                        {pedido.catman || catmanResponsable.get(pedido.material_id || '') || 'Sin responsable'}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-black">{pedido.cantidad}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge texto={formatearEtiqueta(pedido.accion_solicitante || 'despachar')} />
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex px-3 py-1 text-xs font-semibold ${claseResolucion(resolucion)}`}>
                        {estadoVisible}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex px-3 py-1 text-xs font-semibold ${claseSemaforoBadge(semaforoProducto)}`}
                      >
                        {stockDisponible}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-black">{reabastecimiento}</p>
                      <p className="mt-1 text-xs font-medium text-[#7e5a4b]">
                        {detalleOperativo?.fecha_reabastecimiento
                          ? formatearFechaCorta(detalleOperativo.fecha_reabastecimiento)
                          : 'Sin fecha'}
                      </p>
                      <p className="text-xs font-medium text-[#7e5a4b]">
                        OC {detalleOperativo?.orden_compra_reabastecimiento || 'sin registrar'}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-3 w-3 rounded-full ${clasePuntoSemaforo(semaforoRetraso)}`}
                            title={etiquetaSemaforo(semaforoRetraso)}
                          />
                          <span className="text-xs font-semibold text-black">
                            {estadoVisible}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-[#7e5a4b]">
                          {describirTiempoPedido(pedido, { reabiertoPorReporte })}
                        </p>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${claseSemaforoBarra(semaforoRetraso)}`} />
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right align-top">
                      <details className="pedidos-actions inline-flex flex-col items-end">
                        <summary className="inline-flex h-9 w-9 cursor-pointer list-none items-center justify-center border border-transparent text-[#5a4136] transition hover:border-[#dfad9c] hover:bg-[#fff1eb] [&::-webkit-details-marker]:hidden">
                          <MoreVertical size={18} />
                        </summary>
                        <div className="pedidos-action-menu mt-2 grid w-52 gap-2 border border-[#dfad9c] bg-white p-2 text-left shadow-lg">
                          <AccionEstado
                            label="Detalle"
                            icono={<Eye size={14} />}
                            onClick={() => setPedidoDetalle(pedido)}
                          />
                          {reabiertoPorReporte ? (
                            reposicionPendiente ? (
                              <AccionEstado
                                label="Esperando validacion"
                                icono={<Clock3 size={14} />}
                                disabled
                                onClick={() => undefined}
                              />
                            ) : (
                              <AccionEstado
                                label="Reponer y reenviar"
                                icono={<Truck size={14} />}
                                disabled={
                                  !puedeGestionar || stockDisponible <= 0 || reponiendoId === pedido.id
                                }
                                onClick={() => reponerPedidoReportado(pedido)}
                              />
                            )
                          ) : (
                            <>
                              <AccionEstado
                                label="Editar"
                                icono={<Edit3 size={14} />}
                                disabled={!puedeGestionar || pedidoCerrado(pedido.estado)}
                                onClick={() => iniciarEdicion(pedido)}
                              />
                              {flujo === 'compra' ? (
                                <>
                                  <AccionEstado
                                    label="Revisar compra"
                                    completado={etapaCumplida(pedido.estado, 'en_revision')}
                                    disabled={
                                      !puedeGestionar || !puedeCambiarA(pedido.estado, 'en_revision')
                                    }
                                    onClick={() => cambiarEstado(pedido, 'en_revision')}
                                  />
                                  <AccionEstado
                                    label="Planificar OC"
                                    completado={etapaCumplida(pedido.estado, 'aprobado')}
                                    icono={<ClipboardCheck size={14} />}
                                    disabled={
                                      !puedeGestionar || !puedeCambiarA(pedido.estado, 'aprobado')
                                    }
                                    onClick={() => cambiarEstado(pedido, 'aprobado')}
                                  />
                                  <AccionEstado
                                    label="Recibido"
                                    completado={etapaCumplida(pedido.estado, 'entregado')}
                                    icono={<CheckCircle2 size={14} />}
                                    disabled={
                                      !puedeGestionar || !puedeCambiarA(pedido.estado, 'entregado')
                                    }
                                    onClick={() => cambiarEstado(pedido, 'entregado')}
                                  />
                                </>
                              ) : (
                                <>
                                  <AccionEstado
                                    label="Revision"
                                    completado={etapaCumplida(pedido.estado, 'en_revision')}
                                    disabled={
                                      !puedeGestionar || !puedeCambiarA(pedido.estado, 'en_revision')
                                    }
                                    onClick={() => cambiarEstado(pedido, 'en_revision')}
                                  />
                                  <AccionEstado
                                    label="Aprobar"
                                    completado={etapaCumplida(pedido.estado, 'aprobado')}
                                    icono={<ClipboardCheck size={14} />}
                                    disabled={
                                      !puedeGestionar ||
                                      !puedeCambiarA(pedido.estado, 'aprobado')
                                    }
                                    onClick={() => cambiarEstado(pedido, 'aprobado')}
                                  />
                                  <AccionEstado
                                    label="Despachar"
                                    completado={etapaCumplida(pedido.estado, 'en_despacho')}
                                    icono={<Truck size={14} />}
                                    disabled={
                                      !puedeGestionar ||
                                      !puedeCambiarA(pedido.estado, 'en_despacho')
                                    }
                                    onClick={() => despacharPedidoSeleccionado(pedido)}
                                  />
                                </>
                              )}
                              <AccionEstado
                                label="Cancelar pedido"
                                icono={<XCircle size={14} />}
                                peligro
                                disabled={!puedeGestionar || !puedeCambiarA(pedido.estado, 'cancelado')}
                                onClick={() => cambiarEstado(pedido, 'cancelado')}
                              />
                              {pedido.estado === 'cancelado' && (
                                <AccionEstado
                                  label="Reactivar"
                                  icono={<RotateCcw size={14} />}
                                  disabled={!puedeGestionar}
                                  onClick={() => reactivarPedidoSeleccionado(pedido)}
                                />
                              )}
                            </>
                          )}
                        </div>
                      </details>
                    </td>
                  </tr>
                )
              })}

              {cargando && (
                <tr>
                  <td colSpan={10} className="px-5 py-10 text-center text-slate-500">
                    Cargando pedidos...
                  </td>
                </tr>
              )}

              {!cargando && pedidosPriorizados.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-5 py-10 text-center text-slate-500">
                    {vistaPedidos === 'historial'
                      ? 'No hay pedidos cerrados que coincidan con los filtros.'
                      : 'No hay pedidos operativos que coincidan con los filtros.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pedidosPriorizados.length > 0 && (
          <div className="flex flex-col gap-3 px-0 pt-5 text-sm text-[#3f2d25] sm:flex-row sm:items-center sm:justify-between">
            <span>
              Mostrando {primerPedidoVisible}-{ultimoPedidoVisible} de {pedidosPriorizados.length}{' '}
              {vistaPedidos === 'historial' ? 'pedidos cerrados' : 'pedidos operativos'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={paginaActual === 1}
                onClick={() => setPagina((actual) => Math.max(1, actual - 1))}
                className="inline-flex h-10 w-10 items-center justify-center border border-[#dfad9c] bg-white font-semibold text-[#261812] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft size={18} />
              </button>
              {paginasVisibles(paginaActual, totalPaginas).map((numeroPagina) => (
                <button
                  key={numeroPagina}
                  type="button"
                  onClick={() => setPagina(numeroPagina)}
                  className={`h-10 min-w-10 border px-3 font-semibold ${
                    paginaActual === numeroPagina
                      ? 'border-[#a33e00] bg-[#fff1eb] text-[#a33e00]'
                      : 'border-[#dfad9c] bg-white text-[#261812]'
                  }`}
                >
                  {numeroPagina}
                </button>
              ))}
              <button
                type="button"
                disabled={paginaActual === totalPaginas}
                onClick={() => setPagina((actual) => Math.min(totalPaginas, actual + 1))}
                className="inline-flex h-10 w-10 items-center justify-center border border-[#dfad9c] bg-white font-semibold text-[#261812] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </section>
      </div>

      <ModalExito mensaje={modalExito} onClose={() => setModalExito('')} />
      <ModalAlerta mensaje={modalAlerta} onClose={() => setModalAlerta('')} />

      {pedidoDetalle && (
        <DetallePedido
          alertas={alertas}
          reabiertoPorReporte={tieneReporteActivo(pedidoDetalle, pedidosConReporteActivo)}
          detalleOperativo={obtenerDetalleOperativo(pedidoDetalle, detallesOperativosLookup)}
          materiales={materiales}
          onClose={() => setPedidoDetalle(null)}
          onGestionNc={gestionarNotaCredito}
          puedeGestionarNc={rol === 'bodega' || rol === 'administrador'}
          pedido={pedidoDetalle}
        />
      )}
    </div>
  )
}

function Campo({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      {children}
    </label>
  )
}

const ETAPAS_PEDIDO: { estado: EstadoPedido; label: string }[] = [
  { estado: 'pendiente', label: 'Pendiente' },
  { estado: 'en_revision', label: 'En revisión' },
  { estado: 'aprobado', label: 'Aprobado' },
  { estado: 'en_despacho', label: 'En despacho' },
  { estado: 'entregado', label: 'Entregado' },
]

// Una etapa esta cumplida si el pedido ya llego (o paso) ese estado.
function etapaCumplida(estadoActual: EstadoPedido, destino: EstadoPedido) {
  const indiceActual = ETAPAS_PEDIDO.findIndex((etapa) => etapa.estado === estadoActual)
  const indiceDestino = ETAPAS_PEDIDO.findIndex((etapa) => etapa.estado === destino)
  return indiceActual >= 0 && indiceDestino >= 0 && indiceActual >= indiceDestino
}

function ProcesoPedido({ estado }: { estado: EstadoPedido }) {
  const cancelado = estado === 'cancelado' || estado === 'rechazado'
  const indiceActual = ETAPAS_PEDIDO.findIndex((etapa) => etapa.estado === estado)

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Etapa del proceso
      </p>
      {cancelado ? (
        <span className="inline-flex items-center gap-2 rounded-lg border-2 border-[#c8102e] bg-[#fdecea] px-4 py-2 text-sm font-bold text-[#c8102e]">
          Pedido cancelado
        </span>
      ) : (
        <ol className="flex flex-wrap items-center gap-y-2">
          {ETAPAS_PEDIDO.map((etapa, indice) => {
            const completada = indiceActual >= 0 && indice <= indiceActual
            const actual = indice === indiceActual
            return (
              <li key={etapa.estado} className="flex items-center">
                <span
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    actual
                      ? 'border-[#c8102e] bg-[#c8102e] text-white'
                      : completada
                        ? 'border-green-300 bg-green-50 text-green-700'
                        : 'border-slate-200 bg-slate-50 text-slate-400'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                      actual
                        ? 'bg-white text-[#c8102e]'
                        : completada
                          ? 'bg-green-600 text-white'
                          : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    {indice + 1}
                  </span>
                  {etapa.label}
                </span>
                {indice < ETAPAS_PEDIDO.length - 1 && (
                  <span
                    className={`mx-1 h-0.5 w-5 ${indice < indiceActual ? 'bg-green-400' : 'bg-slate-200'}`}
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

const ETAPAS_NC: { estado: string; label: string }[] = [
  { estado: 'solicitada', label: 'Solicitada' },
  { estado: 'en_revision', label: 'En revisión' },
  { estado: 'aprobada', label: 'Aprobada' },
  { estado: 'efectiva', label: 'Reembolsada' },
]

function etiquetaEstadoNc(estado?: string | null) {
  if (estado === 'rechazada') return 'Rechazada'
  const etapa = ETAPAS_NC.find((item) => item.estado === estado)
  return etapa ? etapa.label : 'Solicitada'
}

function PanelNotaCredito({
  onAccion,
  pedido,
  puedeGestionar,
}: {
  onAccion: (estado: 'en_revision' | 'aprobada' | 'efectiva' | 'rechazada') => void
  pedido: Pedido
  puedeGestionar: boolean
}) {
  const estado = pedido.estado_nc || 'solicitada'
  const rechazada = estado === 'rechazada'
  const indiceActual = ETAPAS_NC.findIndex((etapa) => etapa.estado === estado)

  return (
    <section className="rounded-lg border-2 border-violet-300 bg-violet-50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-violet-900">Nota de crédito (reembolso)</h3>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            rechazada
              ? 'bg-red-100 text-red-700'
              : estado === 'efectiva'
                ? 'bg-green-100 text-green-700'
                : 'bg-violet-200 text-violet-900'
          }`}
        >
          {rechazada ? 'Rechazada' : ETAPAS_NC[indiceActual >= 0 ? indiceActual : 0].label}
        </span>
      </div>

      {pedido.motivo_nc && (
        <p className="mt-2 text-sm text-violet-800">
          <span className="font-semibold">Motivo del franquiciado:</span> {pedido.motivo_nc}
        </p>
      )}

      {!rechazada && (
        <div className="mt-4 flex items-center">
          {ETAPAS_NC.map((etapa, indice) => {
            const cumplido = indice <= indiceActual
            return (
              <div key={etapa.estado} className="flex flex-1 items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                      cumplido ? 'bg-violet-600 text-white' : 'bg-white text-violet-400 ring-1 ring-violet-300'
                    }`}
                  >
                    {indice + 1}
                  </div>
                  <span
                    className={`mt-1 text-center text-[11px] font-semibold ${
                      cumplido ? 'text-violet-800' : 'text-violet-400'
                    }`}
                  >
                    {etapa.label}
                  </span>
                </div>
                {indice < ETAPAS_NC.length - 1 && (
                  <div className={`mx-1 h-0.5 flex-1 ${indice < indiceActual ? 'bg-violet-500' : 'bg-violet-200'}`} />
                )}
              </div>
            )
          })}
        </div>
      )}

      {puedeGestionar && estado !== 'efectiva' && !rechazada && (
        <div className="mt-4 flex flex-wrap gap-2">
          {estado === 'solicitada' && (
            <button
              type="button"
              onClick={() => onAccion('en_revision')}
              className="inline-flex items-center gap-1 rounded border border-violet-400 bg-white px-3 py-1.5 text-xs font-semibold text-violet-800 transition hover:bg-violet-100"
            >
              Poner en revisión
            </button>
          )}
          {estado === 'en_revision' && (
            <button
              type="button"
              onClick={() => onAccion('aprobada')}
              className="inline-flex items-center gap-1 rounded border border-green-400 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-800 transition hover:bg-green-100"
            >
              Aprobar
            </button>
          )}
          {estado === 'aprobada' && (
            <button
              type="button"
              onClick={() => onAccion('efectiva')}
              className="inline-flex items-center gap-1 rounded border border-green-600 bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700"
            >
              Hacer efectiva (reembolsar)
            </button>
          )}
          <button
            type="button"
            onClick={() => onAccion('rechazada')}
            className="inline-flex items-center gap-1 rounded border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50"
          >
            Rechazar
          </button>
        </div>
      )}

      {estado === 'efectiva' && (
        <p className="mt-3 text-sm font-semibold text-green-700">
          Reembolso realizado. El material quedó fuera de pendientes.
        </p>
      )}
      {rechazada && (
        <p className="mt-3 text-sm font-semibold text-red-700">Solicitud de nota de crédito rechazada.</p>
      )}
    </section>
  )
}

function BarraReabastecimiento({
  cantidad,
  enCamino,
  stock,
  unidad,
}: {
  cantidad: number
  enCamino: number
  stock: number
  unidad: string
}) {
  const cobertura = Math.max(0, stock) + Math.max(0, enCamino)
  const porcentaje = Math.min(100, Math.round((cobertura / Math.max(1, cantidad)) * 100))
  const color = porcentaje >= 100 ? 'bg-green-500' : porcentaje >= 50 ? 'bg-yellow-500' : 'bg-[#c8102e]'

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-700">Reabastecimiento (cobertura)</span>
        <strong className="text-slate-900">{porcentaje}%</strong>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${porcentaje}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Stock {stock} + en camino {enCamino} de {cantidad} {unidad} requeridos.
      </p>
    </div>
  )
}

function DetallePedido({
  alertas,
  detalleOperativo,
  materiales,
  onClose,
  onGestionNc,
  puedeGestionarNc,
  pedido,
  reabiertoPorReporte,
}: {
  alertas: Alerta[]
  detalleOperativo?: PedidoDetalleOperativo
  materiales: Material[]
  onClose: () => void
  onGestionNc: (pedido: Pedido, estado: 'en_revision' | 'aprobada' | 'efectiva' | 'rechazada') => void
  puedeGestionarNc: boolean
  pedido: Pedido
  reabiertoPorReporte?: boolean
}) {
  const material = materiales.find(
    (item) =>
      item.id === pedido.material_id ||
      normalizarTexto(item.nombre) === normalizarTexto(pedido.material)
  )
  const alertasPedido = alertas.filter(
    (alerta) =>
      alerta.pedido_id === pedido.id ||
      alerta.pedido_codigo === pedido.codigo ||
      (pedido.material_id ? alerta.material_id === pedido.material_id : false)
  )
  const semaforoBase = resolverSemaforoPedido(pedido)
  const semaforo =
    reabiertoPorReporte && (semaforoBase === 'cerrado' || semaforoBase === 'a_tiempo')
      ? 'riesgo'
      : semaforoBase
  const stockActual = stockDisponiblePedido(pedido, material, detalleOperativo)
  const reabastecimiento = reabastecimientoPedido(detalleOperativo)
  const resolucion = resolucionPedido(pedido, detalleOperativo)
  const unidad = material?.unidad_medida || pedido.unidad_medida
  const esCompra = flujoOperativoPedido(pedido, detalleOperativo) === 'compra'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4">
      <section className="mt-10 w-full max-w-5xl rounded-lg bg-white shadow-xl">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-orange-700">Detalle de pedido</p>
            <h2 className="mt-1 text-2xl font-bold text-slate-900">{pedido.codigo}</h2>
            <p className="mt-1 text-sm text-slate-500">{pedido.solicitante}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Cerrar
          </button>
        </div>

        <div className="border-b border-slate-200 px-5 py-5">
          <ProcesoPedido estado={pedido.estado} />
          {esCompra && (
            <BarraReabastecimiento
              stock={stockActual}
              enCamino={reabastecimiento}
              cantidad={pedido.cantidad}
              unidad={unidad}
            />
          )}
        </div>

        {pedido.estado_nc && (
          <div className="border-b border-slate-200 px-5 py-5">
            <PanelNotaCredito
              pedido={pedido}
              puedeGestionar={puedeGestionarNc}
              onAccion={(estado) => onGestionNc(pedido, estado)}
            />
          </div>
        )}

        <div className="grid gap-6 p-5 xl:grid-cols-[1fr_0.9fr]">
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Dato label="Semaforo" valor={etiquetaSemaforo(semaforo)} destaque={claseSemaforoBadge(semaforo)} />
              <Dato label="Tiempo" valor={describirTiempoPedido(pedido, { reabiertoPorReporte })} />
              <Dato label="Resolucion" valor={resolucion} />
              <Dato label="Zonas" valor={detalleOperativo?.zonas || 'Sin zona registrada'} />
              <Dato
                label="Codigo cliente"
                valor={detalleOperativo?.codigo_cliente || pedido.cedula_solicitante || 'Sin registrar'}
              />
              <Dato label="Fecha solicitud" valor={formatearFechaHora(pedido.fecha_solicitud)} />
              <Dato label="Cantidad" valor={String(pedido.cantidad)} />
              <Dato
                label="Reabastecimiento"
                valor={`${reabastecimiento} ${unidad}`}
              />
              <Dato label="Stock disponible" valor={`${stockActual} ${unidad}`} />
              <Dato label="Accion operativa" valor={formatearEtiqueta(pedido.accion_solicitante || 'despachar')} />
              <Dato label="Condicion operativa" valor={formatearEtiqueta(pedido.condicion_material || 'normal')} />
            </div>

            <section className="rounded-lg border border-slate-200 p-4">
              <h3 className="font-semibold text-slate-800">Información del Material</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <Dato label="Material" valor={nombreMaterialPedido(pedido, material, detalleOperativo)} />
                <Dato label="Categoria" valor={material?.categoria || 'Pedido sin categoria'} />
                <Dato label="Stock actual" valor={`${stockActual} ${unidad}`} />
                <Dato
                  label="Minimo en venta"
                  valor={`${numeroOperativo(detalleOperativo?.minimo_venta, 1)} ${unidad}`}
                />
                <Dato
                  label="Multiplo de venta"
                  valor={`${numeroOperativo(detalleOperativo?.multiplo_venta, 1)} ${unidad}`}
                />
                <Dato
                  label="Suministrador"
                  valor={
                    detalleOperativo?.nombre_suministrador ||
                    obtenerSuministradorDesdePedido(pedido) ||
                    'Sin suministrador registrado'
                  }
                />
                <Dato
                  label="Estado planificable"
                  valor={formatearEtiqueta(detalleOperativo?.estado_planificable || 'planificable')}
                />
                <Dato
                  label="Vinculo"
                  valor={material ? 'Catalogo sincronizado' : 'Usando datos del pedido'}
                />
              </div>
            </section>

          </div>

          <div className="space-y-5">
            <section className="rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 p-4 font-semibold text-slate-800">
                Alertas relacionadas
              </div>
              <div className="divide-y divide-slate-100">
                {alertasPedido.map((alerta) => (
                  <div key={alerta.id} className="p-4">
                    <p className="font-semibold text-slate-800">{alerta.tipo_alerta}</p>
                    <p className="mt-1 text-sm text-slate-600">{alerta.mensaje}</p>
                  </div>
                ))}
                {alertasPedido.length === 0 && (
                  <p className="p-4 text-sm text-slate-500">Sin alertas relacionadas.</p>
                )}
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  )
}

function Dato({ destaque, label, valor }: { destaque?: string; label: string; valor: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      {destaque ? (
        <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${destaque}`}>
          {valor}
        </span>
      ) : (
        <p className="mt-1 text-sm font-semibold text-slate-900">{valor}</p>
      )}
    </div>
  )
}

function FiltroSelect({
  formatOption,
  label,
  onChange,
  opciones,
  placeholder,
  value,
}: {
  formatOption?: (value: string) => string
  label: string
  onChange: (value: string) => void
  opciones: string[]
  placeholder?: string
  value: string
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full border border-[#dfad9c] bg-white px-4 py-2 text-[#261812] outline-none focus:border-[#a33e00] focus:ring-1 focus:ring-[#a33e00]"
      >
        {opciones.map((opcion) => (
          <option key={opcion} value={opcion}>
            {opcion === 'todos'
              ? placeholder || `${label} (Todos)`
              : formatOption
                ? formatOption(opcion)
                : formatearEtiqueta(opcion)}
          </option>
        ))}
      </select>
    </label>
  )
}

function AccionEstado({
  completado,
  disabled,
  icono,
  label,
  onClick,
  peligro,
}: {
  completado?: boolean
  disabled?: boolean
  icono?: ReactNode
  label: string
  onClick: () => void
  peligro?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled || completado}
      onClick={onClick}
      className={`inline-flex w-full items-center justify-start gap-2 border px-3 py-2 text-xs font-semibold transition ${
        completado
          ? 'cursor-default border-green-400 bg-green-100 text-green-800'
          : peligro
            ? 'border-red-200 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50'
            : 'border-slate-300 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
      }`}
    >
      {completado ? <CheckCircle2 size={14} /> : icono}
      {label}
    </button>
  )
}

function Badge({ texto }: { texto: string }) {
  return (
    <span className="pedido-soft-badge inline-flex px-2.5 py-1 text-xs font-semibold">
      {texto}
    </span>
  )
}

function formatearEtiqueta(valor: string) {
  return valor.replace(/_/g, ' ')
}

function formatearFechaHora(fecha?: string | null) {
  if (!fecha) return 'Sin registrar'
  const date = new Date(fecha)
  if (Number.isNaN(date.getTime())) return 'Sin registrar'
  return date.toLocaleString()
}

function formatearFechaCorta(fecha?: string | null) {
  if (!fecha) return 'Sin fecha'
  const date = new Date(fecha)
  if (Number.isNaN(date.getTime())) return 'Sin fecha'
  return date.toLocaleDateString()
}

function periodoPedido(fecha?: string | null) {
  if (!fecha) return ''
  const date = new Date(fecha)
  if (Number.isNaN(date.getTime())) return ''
  const mes = String(date.getMonth() + 1).padStart(2, '0')
  return `${date.getFullYear()}-${mes}`
}

function formatearPeriodoFiltro(periodo: string) {
  const [anio, mes] = periodo.split('-').map(Number)
  if (!anio || !mes) return periodo

  return new Date(anio, mes - 1, 1).toLocaleDateString('es-EC', {
    month: 'short',
    year: 'numeric',
  })
}

function paginasVisibles(actual: number, total: number) {
  const inicio = Math.max(1, Math.min(actual - 1, total - 2))
  const fin = Math.min(total, inicio + 2)

  return Array.from({ length: fin - inicio + 1 }, (_, indice) => inicio + indice)
}

function puedeCambiarA(actual: EstadoPedido, siguiente: EstadoPedido) {
  if (['entregado', 'cancelado', 'rechazado'].includes(actual)) return false
  if (siguiente === 'en_revision') {
    return ['pendiente', 'sin_stock', 'retrasado'].includes(actual)
  }
  if (siguiente === 'aprobado') {
    return ['pendiente', 'en_revision', 'sin_stock', 'retrasado'].includes(actual)
  }
  if (siguiente === 'en_despacho') return actual === 'aprobado'
  if (siguiente === 'entregado') return actual === 'en_despacho'
  if (siguiente === 'cancelado') return actual !== 'entregado'
  return true
}

function cantidadParaDespacho(pedido: Pedido) {
  return pedido.cantidad_despacho && pedido.cantidad_despacho > 0
    ? pedido.cantidad_despacho
    : pedido.cantidad
}

function stockSuficientePedido(pedido: Pedido, stockDisponible = pedido.stock_disponible) {
  return stockDisponible - cantidadParaDespacho(pedido) >= 0
}

function stockDisponiblePedido(
  pedido: Pedido,
  material?: Material,
  detalle?: PedidoDetalleOperativo,
) {
  const stockPedido = numeroOperativo(pedido.stock_disponible, Number.NaN)
  const stockMaterial = numeroOperativo(material?.stock_actual, Number.NaN)
  const stockOperativo = numeroOperativo(detalle?.stock_disponible_real, Number.NaN)

  if (pedido.estado === 'en_despacho' || pedido.estado === 'entregado') {
    return stockEfectivo(stockPedido, stockMaterial)
  }

  if (Number.isFinite(stockOperativo)) {
    return Math.max(0, Math.floor(stockOperativo))
  }

  return stockEfectivo(stockPedido, stockMaterial)
}

function reabastecimientoPedido(detalle?: PedidoDetalleOperativo) {
  return numeroOperativo(detalle?.reabastecimiento_pendiente, 0)
}

function resolucionPedido(pedido: Pedido, detalle?: PedidoDetalleOperativo) {
  if (detalle?.resolucion) return detalle.resolucion
  if (pedido.accion_solicitante === 'nota_credito') return 'NC en proceso'
  if (pedido.accion_solicitante === 'esperar_pedido') return 'Reabastecimiento'
  if (pedido.estado === 'entregado') return 'Entregado'
  if (pedido.estado === 'aprobado') return 'Planificado'
  if (pedido.estado === 'en_despacho') return 'Listo para entregar'
  if (pedido.estado === 'en_revision') return 'Sin revisar'
  return 'En proceso'
}

function flujoOperativoPedido(
  pedido: Pedido,
  detalle?: PedidoDetalleOperativo,
): 'compra' | 'venta' {
  if (detalle?.flujo_operativo === 'compra_suministrador_bodega') return 'compra'
  if (detalle?.flujo_operativo === 'venta_bodega_franquiciado') return 'venta'
  if (pedido.origen === 'suministrador' || pedido.destino === 'bodega') return 'compra'
  return 'venta'
}

function etiquetaFlujo(flujo: 'compra' | 'venta') {
  return flujo === 'compra'
    ? 'Compra: suministrador a bodega'
    : 'Venta: bodega a franquiciado'
}

function puedeGestionarFlujo(flujo: 'compra' | 'venta', rol: RolUsuario) {
  if (rol === 'administrador') return true
  if (flujo === 'compra') return rol === 'suministrador'
  return rol === 'bodega'
}

function resolverSemaforoProducto(
  stockDisponible: number,
  cantidadRequerida: number,
  reabastecimientoPendiente: number,
): SemaforoOperativo {
  if (stockDisponible >= cantidadRequerida) return 'a_tiempo'
  if (reabastecimientoPendiente > 0) return 'riesgo'
  return 'critico'
}

function clasePuntoSemaforo(semaforo: ReturnType<typeof resolverSemaforoPedido>) {
  if (semaforo === 'critico') return 'bg-red-600 ring-2 ring-red-100'
  if (semaforo === 'alto') return 'bg-orange-500 ring-2 ring-orange-100'
  if (semaforo === 'riesgo') return 'bg-yellow-500 ring-2 ring-yellow-100'
  if (semaforo === 'a_tiempo') return 'bg-green-500 ring-2 ring-green-100'
  return 'bg-slate-400 ring-2 ring-slate-100'
}

function claseResolucion(resolucion: string) {
  const texto = normalizarTexto(resolucion)

  if (texto.includes('cerrado')) return 'bg-green-100 text-green-800 ring-1 ring-green-200'
  if (texto.includes('reabierto')) return 'bg-red-100 text-red-800 ring-1 ring-red-200'
  if (texto.includes('nc confirmada')) return 'bg-yellow-100 text-yellow-900 ring-1 ring-yellow-200'
  if (texto.includes('nc en proceso')) return 'bg-amber-800 text-white ring-1 ring-amber-900'
  if (texto.includes('proceso')) return 'bg-amber-100 text-amber-900 ring-1 ring-amber-200'
  if (texto.includes('listo')) return 'bg-sky-100 text-sky-800 ring-1 ring-sky-200'
  if (texto.includes('planificado')) return 'bg-blue-100 text-blue-800 ring-1 ring-blue-200'
  if (texto.includes('entregado')) return 'bg-green-100 text-green-800 ring-1 ring-green-200'
  if (texto.includes('compra')) return 'bg-orange-100 text-orange-800 ring-1 ring-orange-200'
  if (texto.includes('sin revisar')) return 'bg-red-100 text-red-800 ring-1 ring-red-200'
  if (texto.includes('evaluacion')) return 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'
  if (texto.includes('reabastecimiento')) return 'bg-yellow-100 text-yellow-900 ring-1 ring-yellow-200'
  if (texto.includes('retirado')) return 'bg-slate-200 text-slate-700 ring-1 ring-slate-300'

  return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
}

function pedidoCerrado(estado: EstadoPedido) {
  return ['entregado', 'cancelado', 'rechazado'].includes(estado)
}

function ordenarPedidosHistorial(a: Pedido, b: Pedido) {
  return fechaHistorialPedido(b) - fechaHistorialPedido(a)
}

function fechaHistorialPedido(pedido: Pedido) {
  const fecha =
    pedido.fecha_entrega ||
    pedido.despachado_at ||
    pedido.created_at ||
    pedido.fecha_compromiso ||
    pedido.fecha_solicitud

  const valor = new Date(fecha).getTime()
  return Number.isNaN(valor) ? 0 : valor
}

function tieneReporteActivo(pedido: Pedido, reportesActivos: Set<string>) {
  return (
    reportesActivos.has(`id:${pedido.id}`) ||
    reportesActivos.has(`codigo:${normalizarTexto(pedido.codigo)}`)
  )
}

function obtenerDetalleOperativo(
  pedido: Pedido,
  lookup: DetallesOperativosLookup,
) {
  return (
    lookup.porCodigoPedido.get(pedido.codigo) ||
    lookup.porConsulta.get(pedido.codigo_consulta || '') ||
    undefined
  )
}

function buscarMaterialPedido(
  pedido: Pedido,
  detalle: PedidoDetalleOperativo | undefined,
  lookup: MaterialesLookup,
) {
  return (
    (pedido.material_id ? lookup.porId.get(pedido.material_id) : undefined) ||
    (detalle?.codigo_material ? lookup.porCodigo.get(detalle.codigo_material) : undefined) ||
    lookup.porNombre.get(normalizarTexto(detalle?.nombre_material || pedido.material))
  )
}

function nombreMaterialPedido(
  pedido: Pedido,
  material?: Material,
  detalle?: PedidoDetalleOperativo | null,
) {
  const codigo = detalle?.codigo_material || material?.codigo_material || ''
  const nombre = detalle?.nombre_material || material?.nombre || pedido.material

  return codigo ? `${codigo} - ${nombre}` : nombre
}

function numeroOperativo(valor: number | string | null | undefined, fallback: number) {
  if (valor === null || valor === undefined || valor === '') return fallback
  const numero = Number(valor)
  if (Number.isFinite(numero)) return numero
  return fallback
}

function stockEfectivo(...valores: number[]) {
  const normalizados = valores
    .filter((valor) => Number.isFinite(valor))
    .map((valor) => Math.max(0, Math.floor(valor)))
  const positivos = normalizados.filter((valor) => valor > 0)

  if (positivos.length > 0) return Math.min(...positivos)
  return normalizados.length > 0 ? 0 : 0
}

function toDatetimeLocal(fecha: string) {
  const date = new Date(fecha)
  if (Number.isNaN(date.getTime())) return ''
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function generarCodigoPedido() {
  return `PED-${Date.now().toString().slice(-6)}`
}

function claseBarraSemaforo(semaforo: SemaforoOperativo) {
  if (semaforo === 'critico') return 'bg-red-600'
  if (semaforo === 'alto') return 'bg-orange-500'
  if (semaforo === 'riesgo') return 'bg-yellow-500'
  if (semaforo === 'a_tiempo') return 'bg-green-500'
  return 'bg-slate-400'
}

function exportarPedidosCsv(pedidos: Pedido[]) {
  const encabezados = [
    'Codigo',
    'Cliente',
    'Material',
    'Cantidad',
    'Unidad',
    'Origen',
    'Destino',
    'Resolucion',
    'Fecha compromiso',
  ]
  const filas = pedidos.map((pedido) => [
    pedido.codigo,
    pedido.solicitante,
    pedido.material,
    pedido.cantidad,
    pedido.unidad_medida,
    pedido.origen,
    pedido.destino,
    pedido.estado,
    pedido.fecha_compromiso,
  ])
  const csv = [encabezados, ...filas]
    .map((fila) => fila.map(valorCsv).join(';'))
    .join('\n')
  const blob = new Blob([`\uFEFFsep=;\n${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'pedidos-priorizados.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function valorCsv(valor: string | number | null | undefined) {
  const texto = String(valor ?? '')
  return `"${texto.replace(/"/g, '""')}"`
}

function normalizarTexto(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function normalizarCedula(valor: string) {
  return valor.replace(/\D/g, '').trim()
}

function obtenerSuministradorDesdePedido(pedido: Pedido): string | null {
  if (!pedido.descripcion) return null
  const partes = pedido.descripcion.split(' - ')
  if (partes.length >= 2) {
    return partes[1]
  }
  return null
}
