import { supabase } from './supabaseClient'
import type {
  AccionSolicitante,
  CondicionMaterial,
  EstadoPedido,
  Pedido,
  UrgenciaPedido,
} from '../types/pedido'

export type PedidoInput = {
  codigo: string
  codigo_consulta?: string
  material_id: string
  material: string
  cantidad: number
  unidad_medida: string
  stock_disponible: number
  origen: 'suministrador' | 'bodega'
  destino: 'bodega' | 'franquiciado'
  solicitante: string
  cedula_solicitante: string
  fecha_compromiso: string
  urgencia: UrgenciaPedido
  tipo_cliente: 'bodega' | 'franquiciado' | 'obra_critica'
  accion_solicitante: AccionSolicitante
  condicion_material: CondicionMaterial
  cantidad_despacho: number
}

export type PedidoUpdateInput = Omit<PedidoInput, 'codigo'>

type DespachoSeguroResult = {
  pedido_estado: EstadoPedido
  stock_anterior: number
  stock_nuevo: number
}

type EstadoPedidoOptions = {
  pedido?: Pedido
  responsable?: string
  codigo_material?: string | null
}

type DespachoPedidoOptions = {
  material_id?: string | null
  responsable?: string
  codigo_material?: string | null
  stock_disponible_operativo?: number | null
}

type InventarioBodegaRow = {
  centro_codigo: string
  stock_disponible: number | string | null
  stock_libre_utilizacion: number | string | null
}

export async function obtenerPedidos() {
  return supabase
    .from('pedidos')
    .select('*')
    .order('created_at', { ascending: false })
    .returns<Pedido[]>()
}

export async function crearPedido(pedido: PedidoInput) {
  const fechaCompromiso = new Date(pedido.fecha_compromiso)
  const fechaCompromisoDate = fechaCompromiso.toISOString().slice(0, 10)

  return supabase.from('pedidos').insert({
    codigo: pedido.codigo,
    codigo_consulta: pedido.codigo_consulta || pedido.codigo,
    tipo_pedido: `${pedido.origen}_${pedido.destino}`,
    descripcion: `Pedido de ${pedido.material} para ${pedido.solicitante}`,
    fecha_pedido: new Date().toISOString().slice(0, 10),
    fecha_requerida: fechaCompromisoDate,
    fecha_entrega: fechaCompromisoDate,
    prioridad: pedido.urgencia === 'critica' ? 'alta' : pedido.urgencia,
    observaciones: 'Registrado desde la plataforma web.',
    material_id: pedido.material_id,
    material: pedido.material,
    cantidad: pedido.cantidad,
    unidad_medida: pedido.unidad_medida,
    stock_disponible: pedido.stock_disponible,
    origen: pedido.origen,
    destino: pedido.destino,
    solicitante: pedido.solicitante,
    cedula_solicitante: normalizarCedula(pedido.cedula_solicitante),
    fecha_solicitud: new Date().toISOString(),
    fecha_compromiso: fechaCompromiso.toISOString(),
    urgencia: pedido.urgencia,
    estado: 'pendiente',
    tipo_cliente: pedido.tipo_cliente,
    accion_solicitante: pedido.accion_solicitante,
    condicion_material: pedido.condicion_material,
    cantidad_despacho: pedido.cantidad_despacho,
  })
}

export async function actualizarPedido(id: string, pedido: PedidoUpdateInput) {
  const fechaCompromiso = new Date(pedido.fecha_compromiso)
  const fechaCompromisoDate = fechaCompromiso.toISOString().slice(0, 10)

  return supabase
    .from('pedidos')
    .update({
      tipo_pedido: `${pedido.origen}_${pedido.destino}`,
      descripcion: `Pedido de ${pedido.material} para ${pedido.solicitante}`,
      fecha_requerida: fechaCompromisoDate,
      fecha_entrega: fechaCompromisoDate,
      prioridad: pedido.urgencia === 'critica' ? 'alta' : pedido.urgencia,
      material_id: pedido.material_id,
      material: pedido.material,
      cantidad: pedido.cantidad,
      unidad_medida: pedido.unidad_medida,
      stock_disponible: pedido.stock_disponible,
      origen: pedido.origen,
      destino: pedido.destino,
      solicitante: pedido.solicitante,
      cedula_solicitante: normalizarCedula(pedido.cedula_solicitante),
      codigo_consulta: pedido.codigo_consulta,
      fecha_compromiso: fechaCompromiso.toISOString(),
      urgencia: pedido.urgencia,
      tipo_cliente: pedido.tipo_cliente,
      accion_solicitante: pedido.accion_solicitante,
      condicion_material: pedido.condicion_material,
      cantidad_despacho: pedido.cantidad_despacho,
    })
    .eq('id', id)
}

export async function actualizarCantidadDespachoPedido(id: string, cantidadDespacho: number | null) {
  return supabase
    .from('pedidos')
    .update({ cantidad_despacho: cantidadDespacho })
    .eq('id', id)
}

function normalizarCedula(valor: string) {
  return valor.replace(/\D/g, '').trim()
}

export async function actualizarEstadoPedido(
  id: string,
  estado: EstadoPedido,
  opciones: EstadoPedidoOptions = {}
) {
  const result = await supabase
    .from('pedidos')
    .update(payloadEstadoPedido(estado, opciones.responsable))
    .eq('id', id)
    .select()
    .maybeSingle<Pedido>()

  if (result.error) return result

  const pedido = opciones.pedido || result.data
  if (pedido) {
    const syncResult = await sincronizarFuenteOperativaPedido(pedido, estado, opciones)
    if (syncResult.error) return { ...result, error: syncResult.error }
  }

  return result
}

export async function despacharPedido(
  pedido: Pedido,
  opciones: DespachoPedidoOptions = {}
) {
  const materialId = opciones.material_id || pedido.material_id || null
  const cantidad = cantidadParaDespacho(pedido)
  const codigoMaterial = normalizarCodigoMaterial(opciones.codigo_material || null)
  const stockOperativo = esNumeroOperativo(opciones.stock_disponible_operativo)
    ? Math.max(0, Math.floor(opciones.stock_disponible_operativo))
    : null

  if (stockOperativo !== null && stockOperativo < cantidad) {
    return errorAplicacion(
      `Stock insuficiente para despachar ${pedido.codigo}. Disponible ${stockOperativo}, requerido ${cantidad}.`
    )
  }

  const operativoResult = await supabase
    .rpc('despachar_pedido_operativo_seguro', {
      p_material_id: materialId,
      p_pedido_id: pedido.id,
      p_responsable: opciones.responsable || 'Bodega',
      p_codigo_material: codigoMaterial,
      p_stock_operativo: stockOperativo,
    })
    .returns<DespachoSeguroResult[]>()

  if (!operativoResult.error) return operativoResult

  if (
    !esFuncionNoDisponible(operativoResult.error) &&
    !esInventarioOperativoAusente(operativoResult.error)
  ) {
    return {
      data: null,
      error: new Error(mensajeErrorDespacho(operativoResult.error)),
    }
  }

  return despacharPedidoConFuncionBase(pedido, {
    ...opciones,
    codigo_material: codigoMaterial,
    stock_disponible_operativo: stockOperativo,
  })
}

async function despacharPedidoConFuncionBase(
  pedido: Pedido,
  opciones: DespachoPedidoOptions = {}
) {
  const materialId = opciones.material_id || pedido.material_id || null
  const codigoMaterial = normalizarCodigoMaterial(opciones.codigo_material || null)
  const cantidad = cantidadParaDespacho(pedido)
  const stockOperativo = esNumeroOperativo(opciones.stock_disponible_operativo)
    ? Math.max(0, Math.floor(opciones.stock_disponible_operativo))
    : null

  if (codigoMaterial) {
    const inventarioAntes = await validarInventarioBodega(codigoMaterial, cantidad, {
      requerido: false,
    })
    if (inventarioAntes.error) return inventarioAntes
  }

  if (materialId && stockOperativo !== null) {
    const syncMaterial = await supabase
      .from('materiales')
      .update({ stock_actual: stockOperativo })
      .eq('id', materialId)

    if (syncMaterial.error) return syncMaterial
  }

  const result = await supabase
    .rpc('despachar_pedido_seguro', {
      p_material_id: materialId,
      p_pedido_id: pedido.id,
      p_responsable: opciones.responsable || 'Bodega',
    })
    .returns<DespachoSeguroResult[]>()

  if (result.error) {
    return {
      data: null,
      error: new Error(mensajeErrorDespacho(result.error)),
    }
  }

  const dataDespacho = Array.isArray(result.data) ? result.data : []
  const despacho = dataDespacho[0]
  let stockNuevoOperativo =
    stockOperativo !== null ? Math.max(0, stockOperativo - cantidad) : despacho?.stock_nuevo ?? 0

  if (codigoMaterial) {
    const inventarioResult = await descontarInventarioBodega(
      codigoMaterial,
      cantidad,
      { requerido: false }
    )

    if (inventarioResult.error) return { ...result, error: inventarioResult.error }
    stockNuevoOperativo = inventarioResult.data?.stock_nuevo ?? stockNuevoOperativo
  }

  const syncPedido = await supabase
    .from('pedidos')
    .update({ stock_disponible: stockNuevoOperativo })
    .eq('id', pedido.id)

  if (syncPedido.error) return { ...result, error: syncPedido.error }

  if (materialId) {
    const syncMaterialFinal = await supabase
      .from('materiales')
      .update({ stock_actual: stockNuevoOperativo })
      .eq('id', materialId)

    if (syncMaterialFinal.error) return { ...result, error: syncMaterialFinal.error }
  }

  const syncFuente = await sincronizarFuenteOperativaPedido(pedido, 'en_despacho', {
    ...opciones,
    codigo_material: codigoMaterial,
  })

  if (syncFuente.error) return { ...result, error: syncFuente.error }

  return result
}

export function escucharPedidos(onChange: () => void) {
  const channel = supabase
    .channel('pedidos-tiempo-real')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'pedidos',
      },
      onChange
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

function mensajeErrorDespacho(error: { code?: string; message?: string }) {
  if (error.code === 'PGRST202' || error.message?.includes('despachar_pedido_seguro')) {
    return 'La funcion de despacho seguro no esta activa en Supabase. Ejecuta supabase/schema_2_0_base_nueva.sql completo y recarga la aplicacion.'
  }

  return error.message || 'No se pudo despachar el pedido.'
}

function payloadEstadoPedido(estado: EstadoPedido, responsable?: string) {
  const hoy = new Date().toISOString().slice(0, 10)
  const ahora = new Date().toISOString()
  const payload: Record<string, unknown> = { estado }

  if (estado === 'entregado') {
    payload.fecha_entrega = hoy
  }

  if (estado === 'en_despacho') {
    payload.despachado_at = ahora
    payload.despachado_por = responsable || 'Bodega'
  }

  return payload
}

async function sincronizarFuenteOperativaPedido(
  pedido: Pedido,
  estado: EstadoPedido,
  opciones: EstadoPedidoOptions = {}
) {
  const pedidoKey = obtenerPedidoKeyBfq(pedido)
  if (!pedidoKey) return { data: null, error: null }

  const hoy = new Date().toISOString().slice(0, 10)
  const payload: Record<string, unknown> = {
    estado: estadoFuenteBodegaFq(estado),
    resolucion: resolucionFuenteBodegaFq(estado),
    updated_at: new Date().toISOString(),
  }

  if (['en_revision', 'aprobado', 'en_despacho', 'entregado'].includes(estado)) {
    payload.fecha_revision = hoy
  }

  if (estado === 'entregado') {
    payload.fecha_entrega = hoy
    payload.fecha_cierre_bodega = hoy
  }

  if (estado === 'cancelado' || estado === 'rechazado') {
    payload.fecha_cierre_bodega = hoy
  }

  const result = await supabase.from('pedidos_bodega_fq').update(payload).eq('pedido_key', pedidoKey)

  if (esErrorTablaOColumnaOpcional(result.error)) {
    return { data: null, error: null }
  }

  if (result.error) return result

  if (opciones.codigo_material && estado === 'entregado') {
    await supabase
      .from('pedidos_bodega_fq')
      .update({ fecha_entrega: hoy, fecha_cierre_bodega: hoy })
      .eq('pedido_key', pedidoKey)
  }

  return result
}

async function descontarInventarioBodega(
  codigoMaterial: string,
  cantidad: number,
  opciones: { requerido?: boolean } = {}
) {
  if (cantidad <= 0) return errorAplicacion('La cantidad a despachar debe ser mayor a cero.')

  const rowsResult = await obtenerFilasInventarioBodega(codigoMaterial, opciones)
  if (rowsResult.error) return rowsResult
  if (!rowsResult.data || rowsResult.data.length === 0) return { data: null, error: null }

  let restante = cantidad
  const stockAnterior = sumarStockInventario(rowsResult.data || [])

  for (const row of rowsResult.data || []) {
    if (restante <= 0) break

    const disponible = numero(row.stock_disponible)
    const libre = numero(row.stock_libre_utilizacion)
    const descuento = Math.min(disponible, restante)
    const libreDescuento = Math.min(libre, descuento)

    const updateResult = await supabase
      .from('inventario_bodega')
      .update({
        stock_disponible: Math.max(0, disponible - descuento),
        stock_libre_utilizacion: Math.max(0, libre - libreDescuento),
        updated_at: new Date().toISOString(),
      })
      .eq('codigo_material', codigoMaterial)
      .eq('centro_codigo', row.centro_codigo)

    if (esErrorTablaOColumnaOpcional(updateResult.error)) return { data: null, error: null }
    if (updateResult.error) return updateResult

    restante -= descuento
  }

  if (restante > 0) {
    return errorAplicacion(
      `No se completo el descuento de inventario para el material ${codigoMaterial}. Restante: ${restante}.`
    )
  }

  return {
    data: {
      stock_anterior: stockAnterior,
      stock_nuevo: Math.max(0, stockAnterior - cantidad),
    },
    error: null,
  }
}

async function validarInventarioBodega(
  codigoMaterial: string,
  cantidad: number,
  opciones: { requerido?: boolean } = {}
) {
  const rowsResult = await obtenerFilasInventarioBodega(codigoMaterial, opciones)
  if (rowsResult.error) return rowsResult
  if (!rowsResult.data || rowsResult.data.length === 0) return { data: null, error: null }

  const stockTotal = sumarStockInventario(rowsResult.data || [])
  if (stockTotal < cantidad) {
    return errorAplicacion(
      `Stock insuficiente en inventario operativo para ${codigoMaterial}. Disponible ${stockTotal}, requerido ${cantidad}.`
    )
  }

  return {
    data: {
      stock_anterior: stockTotal,
      stock_nuevo: Math.max(0, stockTotal - cantidad),
    },
    error: null,
  }
}

async function obtenerFilasInventarioBodega(
  codigoMaterial: string,
  opciones: { requerido?: boolean } = {}
) {
  const codigo = normalizarCodigoMaterial(codigoMaterial)
  if (!codigo) return errorAplicacion('El pedido no tiene codigo de material para descontar inventario operativo.')
  const requerido = opciones.requerido !== false

  const rowsResult = await supabase
    .from('inventario_bodega')
    .select('centro_codigo,stock_disponible,stock_libre_utilizacion')
    .eq('codigo_material', codigo)
    .order('stock_disponible', { ascending: false })
    .returns<InventarioBodegaRow[]>()

  if (esErrorTablaOColumnaOpcional(rowsResult.error)) {
    return errorAplicacion(
      'No se pudo leer inventario_bodega. Ejecuta el parche SQL de despacho operativo en Supabase.'
    )
  }

  if (rowsResult.error) return rowsResult
  if (!rowsResult.data || rowsResult.data.length === 0) {
    if (!requerido) return { data: [], error: null }
    return errorAplicacion(`No existe inventario operativo para el material ${codigo}.`)
  }

  return rowsResult
}

function obtenerPedidoKeyBfq(pedido: Pedido) {
  const match = /^BFQ-(.+)$/.exec(pedido.codigo || '')
  return match?.[1] || null
}

function estadoFuenteBodegaFq(estado: EstadoPedido) {
  const estados: Record<EstadoPedido, string> = {
    pendiente: 'Pendiente',
    en_revision: 'En revision',
    aprobado: 'Aprobado',
    en_despacho: 'En despacho',
    retrasado: 'Retrasado',
    sin_stock: 'Sin stock',
    entregado: 'Cerrado',
    cancelado: 'Cancelado',
    rechazado: 'Rechazado',
  }

  return estados[estado]
}

function resolucionFuenteBodegaFq(estado: EstadoPedido) {
  const resoluciones: Record<EstadoPedido, string> = {
    pendiente: 'En proceso',
    en_revision: 'Sin revisar',
    aprobado: 'Planificado',
    en_despacho: 'Listo para entregar',
    retrasado: 'En proceso',
    sin_stock: 'Reabastecimiento',
    entregado: 'Entregado',
    cancelado: 'Retirado',
    rechazado: 'Retirado',
  }

  return resoluciones[estado]
}

function cantidadParaDespacho(pedido: Pedido) {
  return pedido.cantidad_despacho && pedido.cantidad_despacho > 0
    ? pedido.cantidad_despacho
    : pedido.cantidad
}

function numero(valor: number | string | null | undefined) {
  const convertido = Number(valor)
  return Number.isFinite(convertido) ? convertido : 0
}

function sumarStockInventario(rows: InventarioBodegaRow[]) {
  return Math.max(
    0,
    Math.floor(rows.reduce((total, row) => total + Math.max(0, numero(row.stock_disponible)), 0))
  )
}

function normalizarCodigoMaterial(codigo: string | null | undefined) {
  return codigo?.trim() || null
}

function esNumeroOperativo(valor: number | null | undefined): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor)
}

function esFuncionNoDisponible(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === 'PGRST202' ||
    error?.code === '42883' ||
    Boolean(error?.message?.includes('despachar_pedido_operativo_seguro'))
  )
}

function esInventarioOperativoAusente(error: { message?: string } | null | undefined) {
  return Boolean(error?.message?.includes('No existe inventario operativo para el material'))
}

function esErrorTablaOColumnaOpcional(error: { code?: string } | null | undefined) {
  return error?.code === '42P01' || error?.code === '42703' || error?.code === 'PGRST205'
}

function errorAplicacion(message: string) {
  return {
    data: null,
    error: new Error(message),
  }
}
