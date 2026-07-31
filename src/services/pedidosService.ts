import { supabase } from './supabaseClient'
import {
  consultarConCache,
  crearNotificadorCambios,
  invalidarCache,
} from './cacheService'
import { sincronizarAlertaSemaforoPedido } from './pedidoAlertasService'
import { sincronizarAlertaStockMaterial } from './stockAlertasService'
import type {
  AccionSolicitante,
  CondicionMaterial,
  EstadoPedido,
  Pedido,
  TipoCasoPedido,
  UrgenciaPedido,
} from '../types/pedido'
import { ETIQUETAS_TIPO_CASO } from '../types/pedido'

export type PedidoInput = {
  codigo: string
  codigo_consulta?: string
  codigo_material?: string | null
  material_id: string | null
  material: string
  suministrador?: string | null
  zona?: string | null
  grupo_id?: string | null
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
  tipo_caso?: TipoCasoPedido | null
  cantidad_despacho: number
}

export type PedidoUpdateInput = Omit<PedidoInput, 'codigo'> & {
  codigo?: string
}

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

const CENTRO_BODEGA_MANUAL = {
  centro_codigo: 'YDUR',
  nombre_centro: 'Duran',
  sociedad: 'EC10',
  nombre_empresa: 'Disensa Ecuador',
}
const CACHE_PEDIDOS_MS = 10_000

export async function obtenerPedidos() {
  return consultarConCache('pedidos:todos', CACHE_PEDIDOS_MS, () =>
    supabase
      .from('pedidos')
      .select('*')
      .order('created_at', { ascending: false })
      .returns<Pedido[]>()
  )
}

export async function obtenerClientesFranquiciado() {
  return supabase
    .from('clientes_franquiciado')
    .select('codigo_cliente, nombre_cliente, zona')
    .order('nombre_cliente', { ascending: true })
    .returns<{ codigo_cliente: string | null; nombre_cliente: string | null; zona: string | null }[]>()
}

export async function crearPedido(pedido: PedidoInput) {
  const fechaCompromiso = new Date(pedido.fecha_compromiso)
  const fechaCompromisoDate = fechaCompromiso.toISOString().slice(0, 10)
  const clienteResult = await sincronizarClienteFranquiciado(pedido)

  if (clienteResult.error) return clienteResult
  const fuenteResult = await sincronizarPedidoBodegaFq(pedido)

  if (fuenteResult.error) return fuenteResult

  const result = await supabase.from('pedidos').insert({
    codigo: pedido.codigo,
    codigo_consulta: pedido.codigo_consulta || pedido.codigo,
    grupo_id: pedido.grupo_id ?? null,
    codigo_material: pedido.codigo_material ?? null,
    descripcion: `Pedido de ${pedido.material} para ${pedido.solicitante}`,
    fecha_entrega: fechaCompromisoDate,
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
    tipo_caso: pedido.tipo_caso ?? null,
    cantidad_despacho: pedido.cantidad_despacho,
    suministrador: pedido.suministrador ?? null,
    zona: pedido.zona ?? null,
  }).select().single<Pedido>()

  if (!result.error) {
    await sincronizarAlertasPedidoSinBloquear(result.data)
    invalidarDatosPedidos()
  }
  return result
}

export async function actualizarPedido(id: string, pedido: PedidoUpdateInput) {
  const fechaCompromiso = new Date(pedido.fecha_compromiso)
  const fechaCompromisoDate = fechaCompromiso.toISOString().slice(0, 10)
  const clienteResult = await sincronizarClienteFranquiciado(pedido)

  if (clienteResult.error) return clienteResult
  const fuenteResult = await sincronizarPedidoBodegaFq({
    ...pedido,
    codigo: pedido.codigo || pedido.codigo_consulta || id,
  })

  if (fuenteResult.error) return fuenteResult

  const result = await supabase
    .from('pedidos')
    .update({
      descripcion: `Pedido de ${pedido.material} para ${pedido.solicitante}`,
      fecha_entrega: fechaCompromisoDate,
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
      tipo_caso: pedido.tipo_caso ?? null,
      cantidad_despacho: pedido.cantidad_despacho,
    })
    .eq('id', id)
    .select()
    .maybeSingle<Pedido>()

  if (!result.error && result.data) {
    await sincronizarAlertasPedidoSinBloquear(result.data)
    invalidarDatosPedidos()
  }
  return result
}

export async function actualizarCantidadDespachoPedido(id: string, cantidadDespacho: number | null) {
  const result = await supabase
    .from('pedidos')
    .update({ cantidad_despacho: cantidadDespacho })
    .eq('id', id)

  if (!result.error) invalidarDatosPedidos()
  return result
}

export async function recibirReposicionBodega(pedidoId: string) {
  const { data, error } = await supabase.rpc('recibir_reposicion_bodega', { p_pedido_id: pedidoId })
  if (!error) invalidarDatosPedidos()
  const errorFinal = error || (data && data.ok === false ? new Error(data.error) : null)
  return { data, error: errorFinal }
}

export async function marcarReposicionSinStock(id: string, mensaje: string) {
  const result = await supabase
    .from('pedidos')
    .update({ estado: 'rechazado', mensaje_suministrador: mensaje, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (!result.error) invalidarDatosPedidos()
  return result
}

// Nota de credito: solicitud (franquiciado) y avance del proceso (bodega).
export async function solicitarNotaCredito(id: string, motivo: string) {
  return supabase
    .from('pedidos')
    .update({
      estado_nc: 'solicitada',
      motivo_nc: motivo,
      fecha_nc: new Date().toISOString(),
      accion_solicitante: 'nota_credito',
    })
    .eq('id', id)
}

export async function actualizarNotaCredito(
  id: string,
  estadoNc: 'en_revision' | 'aprobada' | 'efectiva' | 'rechazada',
  opciones?: { motivo?: string },
) {
  const payload: Record<string, unknown> = {
    estado_nc: estadoNc,
    fecha_nc: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (opciones?.motivo !== undefined) payload.motivo_nc = opciones.motivo
  // Efectiva = reembolsado: se saca de pendientes marcando el pedido como cerrado.
  if (estadoNc === 'efectiva') payload.estado = 'cancelado'

  const result = await supabase.from('pedidos').update(payload).eq('id', id)
  if (!result.error) invalidarDatosPedidos()
  return result
}

function normalizarCedula(valor: string) {
  return valor.replace(/\D/g, '').trim()
}

async function sincronizarClienteFranquiciado(pedido: PedidoInput | PedidoUpdateInput) {
  if (pedido.tipo_cliente !== 'franquiciado' && pedido.destino !== 'franquiciado') {
    return { data: null, error: null }
  }

  const codigoCliente = normalizarCedula(pedido.cedula_solicitante)
  const nombreCliente = pedido.solicitante.trim()

  if (!codigoCliente || !nombreCliente) return { data: null, error: null }

  const result = await supabase
    .from('clientes_franquiciado')
    .upsert(
      {
        codigo_cliente: codigoCliente,
        nombre_cliente: nombreCliente,
        zona_cliente: 'Sin zona registrada',
        zona: 'Sin zona registrada',
        fuente: 'registro_manual_web',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'codigo_cliente' }
    )

  return esErrorTablaOColumnaOpcional(result.error) ? { data: null, error: null } : result
}

async function sincronizarPedidoBodegaFq(pedido: PedidoInput) {
  // Las reposiciones (suministrador a bodega) no son pedidos de franquiciado:
  // no se sincronizan a la tabla operativa bodega a franquiciado (evita violar
  // la FK codigo_cliente, que apunta a clientes_franquiciado).
  if (
    pedido.tipo_cliente === 'bodega' ||
    pedido.destino === 'bodega' ||
    pedido.origen === 'suministrador'
  ) {
    return { data: null, error: null }
  }

  const codigoMaterial = normalizarCodigoMaterial(pedido.codigo_material)
  if (!codigoMaterial) return { data: null, error: null }

  const ahora = new Date().toISOString()
  const fechaCompromiso = new Date(pedido.fecha_compromiso)
  const fechaLimite = Number.isNaN(fechaCompromiso.getTime())
    ? new Date().toISOString().slice(0, 10)
    : fechaCompromiso.toISOString().slice(0, 10)
  const codigoCliente = normalizarCedula(pedido.cedula_solicitante)
  const codigoConsulta = pedido.codigo_consulta || pedido.codigo
  const pedidoKey = pedidoKeyOperativo(codigoConsulta, codigoMaterial)

  const catalogoResult = await supabase
    .from('material_catalogo')
    .upsert(
      {
        codigo_material: codigoMaterial,
        nombre_material: pedido.material,
        updated_at: ahora,
      },
      { onConflict: 'codigo_material' }
    )

  if (esErrorTablaOColumnaOpcional(catalogoResult.error)) return { data: null, error: null }
  if (catalogoResult.error) return catalogoResult

  const centroResult = await supabase
    .from('centros_bodega')
    .upsert(
      {
        ...CENTRO_BODEGA_MANUAL,
        fuente: 'registro_manual_web',
        updated_at: ahora,
      },
      { onConflict: 'centro_codigo' }
    )

  if (esErrorTablaOColumnaOpcional(centroResult.error)) return { data: null, error: null }
  if (centroResult.error) return centroResult

  const pedidoFuente = await supabase
    .from('pedidos_bodega_fq')
    .upsert(
      {
        pedido_key: pedidoKey,
        tipo_caso: pedido.tipo_caso ? ETIQUETAS_TIPO_CASO[pedido.tipo_caso] : 'REGISTRO MANUAL',
        responsable: 'BODEGA',
        resolucion: resolucionFuenteInicial(pedido),
        estado: 'Pendiente',
        base: CENTRO_BODEGA_MANUAL.nombre_centro,
        centro_codigo: CENTRO_BODEGA_MANUAL.centro_codigo,
        cod_pedido: codigoConsulta,
        zona_cliente: 'Sin zona registrada',
        codigo_cliente: codigoCliente || null,
        cliente: pedido.solicitante.trim(),
        zona: 'Sin zona registrada',
        codigo_material: codigoMaterial,
        descripcion_material: pedido.material,
        cantidad: Math.max(0, pedido.cantidad),
        unidad: pedido.unidad_medida || 'UN',
        fecha_solicitud: new Date().toISOString().slice(0, 10),
        fecha_limite: fechaLimite,
        stock_disponible_fuente: Math.max(0, pedido.stock_disponible),
        excluidos: estadoPlanificableFuente(pedido.condicion_material),
        prioridad_calculada: prioridadFuentePedido(pedido.urgencia),
        fuente: 'registro_manual_web',
        updated_at: ahora,
      },
      { onConflict: 'pedido_key' }
    )

  return esErrorTablaOColumnaOpcional(pedidoFuente.error)
    ? { data: null, error: null }
    : pedidoFuente
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

  if (result.data) {
    await sincronizarAlertasPedidoSinBloquear({
      ...result.data,
      material_id: opciones.pedido?.material_id || result.data.material_id,
      stock_disponible: opciones.pedido?.stock_disponible ?? result.data.stock_disponible,
    })
  }

  invalidarDatosPedidos()
  return result
}

export async function despacharPedido(
  pedido: Pedido,
  opciones: DespachoPedidoOptions = {}
) {
  const materialCrudo = opciones.material_id || pedido.material_id || null
  const materialId = materialIdUuidONull(materialCrudo)
  const cantidad = cantidadParaDespacho(pedido)
  const codigoMaterial = normalizarCodigoMaterial(
    opciones.codigo_material || codigoDesdeMaterialId(materialCrudo),
  )
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

  if (!operativoResult.error) {
    const despacho = Array.isArray(operativoResult.data) ? operativoResult.data[0] : null
    await sincronizarAlertasPedidoSinBloquear({
      ...pedido,
      estado: despacho?.pedido_estado || 'en_despacho',
    })
    await sincronizarAlertaStockPorDespacho({
      materialId,
      codigoMaterial,
      nombre: pedido.material,
      stockNuevo:
        despacho?.stock_nuevo ?? (stockOperativo !== null ? Math.max(0, stockOperativo - cantidad) : 0),
    })
    invalidarDatosPedidos()
    return operativoResult
  }

  if (
    !esFuncionNoDisponible(operativoResult.error) &&
    !esInventarioOperativoAusente(operativoResult.error)
  ) {
    return {
      data: null,
      error: new Error(mensajeErrorDespacho(operativoResult.error)),
    }
  }

  const result = await despacharPedidoConFuncionBase(pedido, {
    ...opciones,
    codigo_material: codigoMaterial,
    stock_disponible_operativo: stockOperativo,
  })

  if (!result.error) {
    await sincronizarAlertasPedidoSinBloquear({
      ...pedido,
      estado: 'en_despacho',
      stock_disponible:
        stockOperativo !== null ? Math.max(0, stockOperativo - cantidad) : pedido.stock_disponible,
    })
    invalidarDatosPedidos()
  }
  return result
}

async function despacharPedidoConFuncionBase(
  pedido: Pedido,
  opciones: DespachoPedidoOptions = {}
) {
  const materialCrudo = opciones.material_id || pedido.material_id || null
  const materialId = materialIdUuidONull(materialCrudo)
  const codigoMaterial = normalizarCodigoMaterial(
    opciones.codigo_material || codigoDesdeMaterialId(materialCrudo),
  )
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

  await sincronizarAlertaStockPorDespacho({
    materialId,
    codigoMaterial,
    nombre: pedido.material,
    stockNuevo: stockNuevoOperativo,
  })

  const syncFuente = await sincronizarFuenteOperativaPedido(pedido, 'en_despacho', {
    ...opciones,
    codigo_material: codigoMaterial,
  })

  if (syncFuente.error) return { ...result, error: syncFuente.error }

  return result
}

export function escucharPedidos(onChange: () => void) {
  const notificar = crearNotificadorCambios(onChange, [
    'pedidos',
    'inventario',
    'alertas',
    'reportes',
    'otif',
    'detalles-pedidos',
  ])
  const channel = supabase
    .channel('pedidos-tiempo-real')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'pedidos',
      },
      notificar
    )
    .subscribe()

  return () => {
    notificar.cancelar()
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
  const codigoMaterial = normalizarCodigoMaterial(opciones.codigo_material || null)
  const pedidoKey =
    obtenerPedidoKeyBfq(pedido) ||
    (codigoMaterial ? pedidoKeyOperativo(pedido.codigo_consulta || pedido.codigo, codigoMaterial) : null)
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

function pedidoKeyOperativo(codigoPedido: string, codigoMaterial: string) {
  return `${codigoPedido}-${codigoMaterial}`
}

function resolucionFuenteInicial(pedido: Pick<PedidoInput, 'accion_solicitante'>) {
  if (pedido.accion_solicitante === 'nota_credito') return 'NC en proceso'
  if (pedido.accion_solicitante === 'esperar_pedido') return 'Reabastecimiento'
  return 'En proceso'
}

function estadoPlanificableFuente(condicion: CondicionMaterial) {
  if (condicion === 'no_planificable') return 'No planificable'
  if (condicion === 'restrictivo') return 'Hasta agotar stock'
  return 'Planificable'
}

function prioridadFuentePedido(urgencia: UrgenciaPedido) {
  if (urgencia === 'critica') return 80
  if (urgencia === 'alta') return 60
  if (urgencia === 'media') return 30
  return 10
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
    en_revision: 'Revisado',
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

const UUID_MATERIAL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// El material_id de un pedido puede venir como UUID real o como codigo (MAT-####).
// Para las RPC que esperan uuid, se pasa null si no es uuid y el codigo va aparte.
function materialIdUuidONull(valor: string | null | undefined) {
  return valor && UUID_MATERIAL_RE.test(valor) ? valor : null
}

function codigoDesdeMaterialId(valor: string | null | undefined) {
  return valor && !UUID_MATERIAL_RE.test(valor) ? valor : null
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

async function sincronizarAlertasPedidoSinBloquear(pedido: Pedido) {
  await sincronizarAlertaSemaforoPedido(pedido).catch(() => undefined)
}

// Al despachar un pedido el stock baja: se sincroniza la alerta de stock del
// material (crea "stock_bajo" en rojo/amarillo o cierra la que ya no aplica).
// Si el material solo existe en el inventario operativo (sin fila en la tabla
// materiales), se crea la fila primero para poder persistir y mostrar la alerta.
async function sincronizarAlertaStockPorDespacho(opciones: {
  materialId: string | null
  codigoMaterial: string | null
  nombre: string
  stockNuevo: number
}) {
  try {
    const { materialId, codigoMaterial, nombre, stockNuevo } = opciones
    const stock = Math.max(0, Math.floor(stockNuevo) || 0)
    const campos = 'id,codigo_material,nombre,stock_actual,stock_minimo'

    type MaterialStockRow = {
      id: string
      codigo_material: string | null
      nombre: string
      stock_actual: number
      stock_minimo: number
    }

    let material: MaterialStockRow | null = null

    if (materialId && UUID_MATERIAL_RE.test(materialId)) {
      const porId = await supabase
        .from('materiales')
        .select(campos)
        .eq('id', materialId)
        .maybeSingle<MaterialStockRow>()

      if (!porId.error && porId.data) material = porId.data
    }

    if (!material && codigoMaterial) {
      const porCodigo = await supabase
        .from('materiales')
        .select(campos)
        .eq('codigo_material', codigoMaterial)
        .maybeSingle<MaterialStockRow>()

      if (!porCodigo.error && porCodigo.data) material = porCodigo.data
    }

    if (!material) {
      if (!codigoMaterial) return

      const catalogo = await supabase
        .from('material_catalogo')
        .upsert(
          {
            codigo_material: codigoMaterial,
            nombre_material: nombre,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'codigo_material' }
        )

      if (
        catalogo.error &&
        catalogo.error.code !== '42P01' &&
        catalogo.error.code !== '42703'
      ) {
        return
      }

      const crear = await supabase
        .from('materiales')
        .insert({
          codigo_material: codigoMaterial,
          nombre,
          categoria: 'Sin categoria',
          stock_actual: stock,
          stock_minimo: 30,
          unidad_medida: 'UN',
          es_critico: false,
        })
        .select(campos)
        .maybeSingle<MaterialStockRow>()

      if (crear.error || !crear.data) return
      material = crear.data
    }

    await sincronizarAlertaStockMaterial(
      {
        id: material.id,
        codigo_material: material.codigo_material,
        nombre: material.nombre,
        stock_actual: material.stock_actual,
        stock_minimo: material.stock_minimo,
        pedido_maximo_material: material.stock_minimo,
        stock_objetivo_material: Math.max(1, material.stock_minimo || 1) * 3,
        demanda_bodega_fq: material.stock_minimo,
      },
      stock,
      { responsable: 'Departamento de inventario' }
    )
  } catch {
    // La alerta de stock no bloquea el despacho.
  }
}

function invalidarDatosPedidos() {
  invalidarCache('pedidos', 'inventario', 'alertas', 'reportes', 'otif', 'detalles-pedidos')
}
