import { supabase } from './supabaseClient'
import { sincronizarAlertaStockMaterial } from './stockAlertasService'
import {
  consultarConCache,
  crearNotificadorCambios,
  invalidarCache,
} from './cacheService'
import type { Material } from '../types/material'

export type MaterialInput = {
  codigo_material?: string | null
  nombre: string
  categoria: string
  stock_actual: number
  stock_minimo: number
  unidad_medida: string
  es_critico: boolean
}

type PedidoMaterialSync = {
  id: string
  cantidad: number
  cantidad_despacho?: number | null
  estado: string
}

type InventarioBodegaMaterialRow = {
  centro_codigo: string
  stock_disponible: number | string | null
}

const CENTRO_BODEGA_MANUAL = {
  centro_codigo: 'YDUR',
  nombre_centro: 'Duran',
  sociedad: 'EC10',
  nombre_empresa: 'Disensa Ecuador',
}

// Supabase entrega resultados en bloques. Este valor NO limita el total:
// consultarMateriales() sigue pidiendo bloques hasta traer todos los materiales.
const TAMANO_BLOQUE_MATERIALES = 1000
const CACHE_MATERIALES_MS = 20_000

export async function obtenerMateriales() {
  return consultarConCache('materiales:todos', CACHE_MATERIALES_MS, consultarMateriales)
}

async function consultarMateriales() {
  const materiales: Material[] = []
  let desde = 0

  while (true) {
    const result = await supabase
      .from('materiales')
      .select('*')
      .order('created_at', { ascending: false })
      .order('nombre', { ascending: true })
      .range(desde, desde + TAMANO_BLOQUE_MATERIALES - 1)
      .returns<Material[]>()

    if (esErrorColumnaFaltante(result.error)) {
      return consultarMaterialesSinCreatedAt()
    }

    if (result.error) return result

    materiales.push(...(result.data || []))

    if (!result.data || result.data.length < TAMANO_BLOQUE_MATERIALES) {
      return { ...result, data: materiales }
    }

    desde += TAMANO_BLOQUE_MATERIALES
  }
}

async function consultarMaterialesSinCreatedAt() {
  const materiales: Material[] = []
  let desde = 0

  while (true) {
    const result = await supabase
      .from('materiales')
      .select('*')
      .order('nombre')
      .range(desde, desde + TAMANO_BLOQUE_MATERIALES - 1)
      .returns<Material[]>()

    if (result.error) return result

    materiales.push(...(result.data || []))

    if (!result.data || result.data.length < TAMANO_BLOQUE_MATERIALES) {
      return { ...result, data: materiales }
    }

    desde += TAMANO_BLOQUE_MATERIALES
  }
}

export async function crearMaterial(material: MaterialInput) {
  const duplicado = await buscarMaterialDuplicado(material)

  if (duplicado.error) return duplicado
  if (duplicado.data) {
    return fusionarMaterialConExistente(duplicado.data, material)
  }

  const result = await supabase.from('materiales').insert(material).select().single<Material>()

  if (result.error) return result

  const syncResult = await sincronizarMaterialEnModulos(result.data)

  if (syncResult.error) return { ...result, error: syncResult.error }

  invalidarDatosMateriales()
  return result
}

export async function actualizarMaterial(id: string, material: MaterialInput) {
  const anterior = await supabase
    .from('materiales')
    .select('*')
    .eq('id', id)
    .maybeSingle<Material>()

  if (anterior.error) return anterior
  if (!anterior.data) {
    return errorAplicacion('No se encontro el material que intentas editar. Recarga la pagina e intentalo nuevamente.')
  }

  const cambioIdentidad =
    llaveMaterial(anterior.data.nombre, anterior.data.unidad_medida) !==
    llaveMaterial(material.nombre, material.unidad_medida)
  const cambioCodigo =
    normalizarCodigoMaterial(anterior.data.codigo_material) !==
    normalizarCodigoMaterial(material.codigo_material)

  if (cambioIdentidad || cambioCodigo) {
    const duplicado = await buscarMaterialDuplicado(material, id)

    if (duplicado.error) return duplicado
    if (duplicado.data) {
      return errorAplicacion(
        `Ya existe "${duplicado.data.nombre}" con el mismo codigo o unidad. Edita ese registro para mantener materiales separados.`
      )
    }
  }

  const result = await supabase
    .from('materiales')
    .update(material)
    .eq('id', id)
    .select()
    .maybeSingle<Material>()

  if (result.error) return result
  if (!result.data) {
    return errorAplicacion('Supabase no devolvio el material actualizado. Verifica permisos de la tabla materiales.')
  }

  const syncResult = await sincronizarMaterialEnModulos(result.data, anterior.data.nombre)

  if (syncResult.error) return { ...result, error: syncResult.error }

  invalidarDatosMateriales()
  return result
}

export async function eliminarMaterial(id: string) {
  const alertasResult = await supabase
    .from('alertas')
    .update({ material_id: null, estado: 'cerrada' })
    .eq('material_id', id)

  if (alertasResult.error) {
    return alertasResult
  }

  const pedidosResult = await supabase
    .from('pedidos')
    .update({ material_id: null, stock_disponible: 0 })
    .eq('material_id', id)

  if (pedidosResult.error) {
    return pedidosResult
  }

  const reportesResult = await limpiarMaterialEnReportes(id)

  if (reportesResult.error) {
    return reportesResult
  }

  const result = await supabase.from('materiales').delete().eq('id', id)

  if (!result.error) invalidarDatosMateriales()
  return result
}

export function escucharMateriales(onChange: () => void) {
  const notificar = crearNotificadorCambios(onChange, [
    'materiales',
    'inventario',
    'pedidos',
    'alertas',
    'reportes',
  ])
  const channel = supabase
    .channel('materiales-tiempo-real')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'materiales',
      },
      notificar
    )
    .subscribe()

  return () => {
    notificar.cancelar()
    supabase.removeChannel(channel)
  }
}

async function buscarMaterialDuplicado(material: MaterialInput, excluirId?: string) {
  const result = await consultarMateriales()

  if (result.error) return { data: null, error: result.error }

  const llave = llaveMaterial(material.nombre, material.unidad_medida)
  const codigo = normalizarCodigoMaterial(material.codigo_material)
  const duplicado =
    result.data?.find((item) => {
      if (item.id === excluirId) return false
      if (codigo && normalizarCodigoMaterial(item.codigo_material) === codigo) return true
      return llaveMaterial(item.nombre, item.unidad_medida) === llave
    }) || null

  return { data: duplicado, error: null }
}

async function fusionarMaterialConExistente(
  existente: Material,
  material: MaterialInput,
  origenId?: string
) {
  const materialFusionado: MaterialInput = {
    codigo_material: existente.codigo_material || material.codigo_material || null,
    nombre: existente.nombre,
    categoria: existente.categoria || material.categoria,
    stock_actual: existente.stock_actual + material.stock_actual,
    stock_minimo: Math.max(existente.stock_minimo, material.stock_minimo),
    unidad_medida: existente.unidad_medida || material.unidad_medida,
    es_critico: false,
  }

  const updateResult = await supabase
    .from('materiales')
    .update(materialFusionado)
    .eq('id', existente.id)
    .select()
    .single<Material>()

  if (updateResult.error) return updateResult

  if (origenId) {
    const moverResult = await moverReferenciasMaterial(origenId, updateResult.data)
    if (moverResult.error) return moverResult

    const deleteResult = await supabase.from('materiales').delete().eq('id', origenId)
    if (deleteResult.error) return deleteResult
  }

  const syncResult = await sincronizarMaterialEnModulos(updateResult.data)

  if (syncResult.error) return { ...updateResult, error: syncResult.error }

  invalidarDatosMateriales()
  return updateResult
}

async function moverReferenciasMaterial(origenId: string, destino: Material) {
  const pedidosResult = await supabase
    .from('pedidos')
    .update({
      material_id: destino.id,
      material: destino.nombre,
      unidad_medida: destino.unidad_medida,
      stock_disponible: destino.stock_actual,
    })
    .eq('material_id', origenId)

  if (pedidosResult.error) return pedidosResult

  const alertasResult = await supabase
    .from('alertas')
    .update({ material_id: destino.id })
    .eq('material_id', origenId)

  if (alertasResult.error) return alertasResult

  const movimientosResult = await moverMaterialEnMovimientos(origenId, destino)

  if (movimientosResult.error) {
    return movimientosResult
  }

  const reportesResult = await moverMaterialEnReportes(origenId, destino.id)

  if (reportesResult.error) {
    return reportesResult
  }

  return { data: null, error: null }
}

async function sincronizarMaterialEnModulos(material: Material, nombreAnterior?: string) {
  const catalogoResult = await sincronizarMaterialCatalogo(material)

  if (catalogoResult.error) return catalogoResult

  const inventarioResult = await sincronizarInventarioBodega(material)

  if (inventarioResult.error) return inventarioResult

  const alertasInventarioResult = await resolverAlertasMaterialConInventario(material)

  if (alertasInventarioResult.error) return alertasInventarioResult

  const pedidosResult = await obtenerPedidosRelacionados(material, nombreAnterior)

  if (pedidosResult.error) return pedidosResult

  for (const pedido of pedidosResult.data || []) {
    const cantidadOperativa =
      pedido.cantidad_despacho && pedido.cantidad_despacho > 0
        ? pedido.cantidad_despacho
        : pedido.cantidad
    const estado = resolverEstadoPedidoPorStock(
      pedido.estado,
      material.stock_actual,
      cantidadOperativa
    )
    const updateResult = await supabase
      .from('pedidos')
      .update({
        material_id: material.id,
        material: material.nombre,
        unidad_medida: material.unidad_medida,
        stock_disponible: material.stock_actual,
        estado,
      })
      .eq('id', pedido.id)

    if (updateResult.error) return updateResult
  }

  return sincronizarAlertaStock(material)
}

async function sincronizarMaterialCatalogo(material: Material) {
  if (!material.codigo_material) return { data: null, error: null }

  const catalogoResult = await supabase
    .from('material_catalogo')
    .upsert(
      {
        codigo_material: material.codigo_material,
        nombre_material: material.nombre,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'codigo_material' }
    )

  if (esErrorTablaOColumnaOpcional(catalogoResult.error)) {
    return { data: null, error: null }
  }

  if (catalogoResult.error) return catalogoResult

  const lineasResult = await supabase
    .from('pedido_lineas')
    .update({ nombre_material_snapshot: material.nombre })
    .eq('codigo_material', material.codigo_material)

  return esErrorTablaOColumnaOpcional(lineasResult.error)
    ? { data: null, error: null }
    : lineasResult
}

async function sincronizarInventarioBodega(material: Material) {
  const codigoMaterial = material.codigo_material?.trim()

  if (!codigoMaterial) return { data: null, error: null }

  const filasResult = await supabase
    .from('inventario_bodega')
    .select('centro_codigo,stock_disponible')
    .eq('codigo_material', codigoMaterial)
    .returns<InventarioBodegaMaterialRow[]>()

  if (filasResult.error) return filasResult

  const filas = filasResult.data || []
  if (filas.length === 0) {
    return crearInventarioBodegaManual(material, codigoMaterial)
  }

  const stockDisponible = Math.max(0, material.stock_actual)
  const filaPrincipal =
    filas.find((fila) => Number(fila.stock_disponible) > 0) || filas[0]

  for (const fila of filas) {
    const updateResult = await supabase
      .from('inventario_bodega')
      .update({
        stock_disponible: fila.centro_codigo === filaPrincipal.centro_codigo ? stockDisponible : 0,
        stock_libre_utilizacion: fila.centro_codigo === filaPrincipal.centro_codigo ? stockDisponible : 0,
        unidad_medida: material.unidad_medida || 'UN',
        updated_at: new Date().toISOString(),
      })
      .eq('codigo_material', codigoMaterial)
      .eq('centro_codigo', fila.centro_codigo)

    if (esErrorTablaOColumnaOpcional(updateResult.error)) {
      return { data: null, error: null }
    }

    if (updateResult.error) return updateResult
  }

  return { data: null, error: null }
}

async function crearInventarioBodegaManual(material: Material, codigoMaterial: string) {
  const stockDisponible = Math.max(0, material.stock_actual)
  const ahora = new Date().toISOString()

  const centroResult = await asegurarCentroBodegaManual(ahora)

  if (centroResult.error) return centroResult

  const inventarioResult = await supabase
    .from('inventario_bodega')
    .upsert(
      {
        centro_codigo: CENTRO_BODEGA_MANUAL.centro_codigo,
        codigo_material: codigoMaterial,
        sociedad: CENTRO_BODEGA_MANUAL.sociedad,
        nombre_empresa: CENTRO_BODEGA_MANUAL.nombre_empresa,
        nombre_centro: CENTRO_BODEGA_MANUAL.nombre_centro,
        unidad_medida: material.unidad_medida || 'UN',
        stock_libre_utilizacion: stockDisponible,
        stock_disponible: stockDisponible,
        bloqueado: 0,
        comprometido_ped_vta: 0,
        comprometido_entregas: 0,
        consignacion_libre: 0,
        stock_en_curso_pedido: 0,
        devoluciones: 0,
        fuente: 'registro_manual_web',
        updated_at: ahora,
      },
      { onConflict: 'centro_codigo,codigo_material' }
    )

  return inventarioResult
}

async function asegurarCentroBodegaManual(ahora: string) {
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

  if (!centroResult.error) return centroResult
  if (centroResult.error.code === '42P01') return { data: null, error: null }
  if (centroResult.error.code !== '42703') return centroResult

  const centroCompatible = await supabase
    .from('centros_bodega')
    .upsert(
      {
        centro_codigo: CENTRO_BODEGA_MANUAL.centro_codigo,
        sociedad: CENTRO_BODEGA_MANUAL.sociedad,
        fuente: 'registro_manual_web',
        updated_at: ahora,
      },
      { onConflict: 'centro_codigo' }
    )

  if (centroCompatible.error?.code === '42703') {
    return { data: null, error: null }
  }

  return centroCompatible
}

async function resolverAlertasMaterialConInventario(material: Material) {
  const codigoMaterial = normalizarCodigoMaterial(material.codigo_material)

  if (!codigoMaterial) return { data: null, error: null }

  const inventarioResult = await supabase
    .from('inventario_bodega')
    .select('codigo_material')
    .eq('codigo_material', codigoMaterial)
    .limit(1)

  if (inventarioResult.error) return inventarioResult
  if (!inventarioResult.data?.length) {
    return errorAplicacion(
      `El material ${codigoMaterial} se guardo, pero no se pudo crear su fila en inventario_bodega.`
    )
  }

  const cierrePorMaterial = await supabase
    .from('alertas')
    .update({ estado: 'cerrada' })
    .eq('tipo_alerta', 'material_sin_inventario')
    .in('estado', ['activa', 'revisada'])
    .eq('material_id', material.id)

  if (esErrorTablaOColumnaOpcional(cierrePorMaterial.error)) return { data: null, error: null }
  if (cierrePorMaterial.error) return cierrePorMaterial

  const cierrePorCodigo = await supabase
    .from('alertas')
    .update({ estado: 'cerrada' })
    .eq('tipo_alerta', 'material_sin_inventario')
    .in('estado', ['activa', 'revisada'])
    .ilike('mensaje', `%${codigoMaterial}%`)

  if (esErrorTablaOColumnaOpcional(cierrePorCodigo.error)) return { data: null, error: null }
  if (cierrePorCodigo.error) return cierrePorCodigo

  await ejecutarRpcOpcional('sincronizar_alertas_material_sin_inventario')
  await ejecutarRpcOpcional('sincronizar_alertas_resueltas_por_stock')

  return { data: null, error: null }
}

async function ejecutarRpcOpcional(functionName: string) {
  const result = await supabase.rpc(functionName)

  if (esErrorFuncionOpcional(result.error)) return { data: null, error: null }
  return result
}

async function obtenerPedidosRelacionados(material: Material, nombreAnterior?: string) {
  const consultas = [
    supabase
      .from('pedidos')
      .select('id,cantidad,cantidad_despacho,estado')
      .eq('material_id', material.id)
      .returns<PedidoMaterialSync[]>(),
    supabase
      .from('pedidos')
      .select('id,cantidad,cantidad_despacho,estado')
      .eq('material', material.nombre)
      .returns<PedidoMaterialSync[]>(),
  ]

  if (nombreAnterior && normalizarTexto(nombreAnterior) !== normalizarTexto(material.nombre)) {
    consultas.push(
      supabase
        .from('pedidos')
        .select('id,cantidad,cantidad_despacho,estado')
        .eq('material', nombreAnterior)
        .returns<PedidoMaterialSync[]>()
    )
  }

  const resultados = await Promise.all(consultas)
  const error = resultados.find((resultado) => resultado.error)?.error

  if (esErrorColumnaFaltante(error)) {
    return obtenerPedidosRelacionadosSinCantidadDespacho(material, nombreAnterior)
  }

  if (error) return { data: null, error }

  const mapa = new Map<string, PedidoMaterialSync>()
  resultados.forEach((resultado) => {
    ;(resultado.data || []).forEach((pedido) => {
      mapa.set(pedido.id, pedido)
    })
  })

  return { data: [...mapa.values()], error: null }
}

async function obtenerPedidosRelacionadosSinCantidadDespacho(
  material: Material,
  nombreAnterior?: string
) {
  const consultas = [
    supabase
      .from('pedidos')
      .select('id,cantidad,estado')
      .eq('material_id', material.id)
      .returns<PedidoMaterialSync[]>(),
    supabase
      .from('pedidos')
      .select('id,cantidad,estado')
      .eq('material', material.nombre)
      .returns<PedidoMaterialSync[]>(),
  ]

  if (nombreAnterior && normalizarTexto(nombreAnterior) !== normalizarTexto(material.nombre)) {
    consultas.push(
      supabase
        .from('pedidos')
        .select('id,cantidad,estado')
        .eq('material', nombreAnterior)
        .returns<PedidoMaterialSync[]>()
    )
  }

  const resultados = await Promise.all(consultas)
  const error = resultados.find((resultado) => resultado.error)?.error

  if (error) return { data: null, error }

  const mapa = new Map<string, PedidoMaterialSync>()
  resultados.forEach((resultado) => {
    ;(resultado.data || []).forEach((pedido) => {
      mapa.set(pedido.id, pedido)
    })
  })

  return { data: [...mapa.values()], error: null }
}

async function sincronizarAlertaStock(material: Material) {
  return sincronizarAlertaStockMaterial(material)
}

async function moverMaterialEnMovimientos(origenId: string, destino: Material) {
  const result = await supabase
    .from('movimientos_inventario')
    .update({ material_id: destino.id, material_nombre: destino.nombre })
    .eq('material_id', origenId)

  return esErrorTablaOColumnaOpcional(result.error) ? { data: null, error: null } : result
}

async function moverMaterialEnReportes(origenId: string, destinoId: string) {
  const result = await supabase
    .from('reportes_operativos')
    .update({ material_id: destinoId })
    .eq('material_id', origenId)

  return esErrorTablaOColumnaOpcional(result.error) ? { data: null, error: null } : result
}

async function limpiarMaterialEnReportes(id: string) {
  const result = await supabase
    .from('reportes_operativos')
    .update({ material_id: null })
    .eq('material_id', id)

  return esErrorTablaOColumnaOpcional(result.error) ? { data: null, error: null } : result
}

function esErrorColumnaFaltante(error: { code?: string } | null | undefined) {
  return error?.code === '42703'
}

function esErrorTablaOColumnaOpcional(error: { code?: string } | null | undefined) {
  return error?.code === '42P01' || error?.code === '42703'
}

function esErrorFuncionOpcional(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return (
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    error.message?.toLowerCase().includes('could not find the function') ||
    false
  )
}

function errorAplicacion(message: string) {
  return {
    data: null,
    error: {
      code: 'APP_MATERIALES',
      message,
    },
  }
}

function resolverEstadoPedidoPorStock(
  estadoActual: string,
  stockActual: number,
  cantidadOperativa: number
) {
  if (['entregado', 'cancelado', 'rechazado'].includes(estadoActual)) {
    return estadoActual
  }

  if (estadoActual === 'en_despacho') return estadoActual

  if (stockActual < cantidadOperativa) return 'sin_stock'
  if (estadoActual === 'sin_stock') return 'pendiente'
  return estadoActual
}

function normalizarTexto(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function normalizarCodigoMaterial(codigo?: string | null) {
  return (codigo || '').trim()
}

function llaveMaterial(nombre: string, unidad: string) {
  return `${normalizarTexto(nombre)}__${normalizarTexto(unidad)}`
}

function invalidarDatosMateriales() {
  invalidarCache('materiales', 'inventario', 'pedidos', 'alertas', 'reportes')
}
