import { registrarAuditoria } from './auditoriaService'
import {
  consultarConCache,
  crearNotificadorCambios,
  invalidarCache,
} from './cacheService'
import { obtenerMateriales } from './materialesService'
import {
  resolverNivelAlertaStock,
  sincronizarAlertaStockMaterial,
} from './stockAlertasService'
import { supabase } from './supabaseClient'
import type { InventarioOperativo, Material } from '../types/material'
import type {
  MovimientoInventario,
  TipoMovimientoInventario,
} from '../types/movimiento'

export type MovimientoInventarioInput = {
  material_id: string
  tipo: TipoMovimientoInventario
  cantidad: number
  motivo: string
  responsable: string
}

type PedidoMaterialDemanda = {
  material_id: string | null
  material: string | null
  cantidad: number | string | null
  cantidad_despacho?: number | string | null
  estado?: string | null
}

type MaterialOperativoRow = {
  codigo_material: string
  nombre_material: string
  unidad_medida: string
  marca_material: string | null
  catman_nombre: string | null
  catman_categoria: string | null
  numero_suministradores: number | string | null
  codigo_suministrador: string | null
  nombre_suministrador: string | null
  stock_libre: number | string | null
  stock_disponible: number | string | null
  bloqueado: number | string | null
  stock_en_curso_pedido: number | string | null
  stock_transito: number | string | null
  demanda_bodega_fq: number | string | null
  pedido_maximo_material?: number | string | null
  stock_objetivo_material?: number | string | null
  faltante_total: number | string | null
  estado_cobertura: string | null
  ocs_transito: number | string | null
  ocs_pendientes: number | string | null
  cantidad_oc_pendiente: number | string | null
  casos_bodega_fq: number | string | null
  estado_planificable: string | null
  min_compra: number | string | null
  mult_compra: number | string | null
  min_venta: number | string | null
  mult_venta: number | string | null
}

const TAMANO_BLOQUE_INVENTARIO_OPERATIVO = 1000
const CACHE_INVENTARIO_OPERATIVO_MS = 15_000

export async function obtenerInventarioOperativo() {
  return consultarConCache(
    'inventario:operativo',
    CACHE_INVENTARIO_OPERATIVO_MS,
    cargarInventarioOperativo
  )
}

async function cargarInventarioOperativo() {
  const materialesResult = await obtenerMateriales()

  if (materialesResult.error) {
    return materialesResult
  }

  const materiales = materialesResult.data || []
  const operativosResult = await consultarMaterialesOperativos()

  if (operativosResult.error) {
    return {
      ...materialesResult,
      data: materiales.map(materialAInventarioFallback),
    }
  }

  const materialesPorCodigo = new Map(
    materiales
      .filter((material) => material.codigo_material)
      .map((material) => [material.codigo_material as string, material])
  )

  const materialesPorNombre = new Map(
    materiales.map((material) => [normalizarLlave(material.nombre), material])
  )

  const demandaMaxima = await obtenerPedidoMaximoPorMaterial()

  const materialesIncluidos = new Set<string>()

  const inventario: InventarioOperativo[] = (operativosResult.data || []).map((row) => {
    const material =
      materialesPorCodigo.get(row.codigo_material) ||
      materialesPorNombre.get(normalizarLlave(row.nombre_material))

    if (material) {
      materialesIncluidos.add(material.id)
    }

    const stockLibreFuente = numeroNoNegativo(row.stock_libre)
    const stockDisponibleFuente = numeroNoNegativo(row.stock_disponible)
    const stockMaterial = material ? numeroNoNegativo(material.stock_actual) : null
    const stockDisponibleSistema = stockSistema(stockDisponibleFuente, stockMaterial)
    const stockLibre = stockLibreFuente
    const demanda = numeroNoNegativo(row.demanda_bodega_fq)
    const pedidoMaximoReal = Math.max(
      demandaMaxima.porCodigo.get(row.codigo_material) || 0,
      material?.id ? demandaMaxima.porMaterialId.get(material.id) || 0 : 0,
      demandaMaxima.porNombre.get(normalizarLlave(material?.nombre || row.nombre_material)) || 0
    )
    const pedidoMaximo = pedidoMaximoReal || numeroNoNegativo(row.pedido_maximo_material) || demanda || 1
    const stockObjetivo = numeroNoNegativo(row.stock_objetivo_material) || pedidoMaximo * 3

    return {
      id: material?.id || row.codigo_material,
      codigo_material: row.codigo_material,
      nombre: material?.nombre || row.nombre_material || `Material ${row.codigo_material}`,
      categoria: material?.categoria || categoriaPorCobertura(row.estado_cobertura),
      stock_actual: stockDisponibleSistema,
      stock_minimo: pedidoMaximo,
      unidad_medida: material?.unidad_medida || row.unidad_medida || 'UN',
      es_critico: material?.es_critico || numeroNoNegativo(row.faltante_total) > 0,
      estado: material?.estado || 'activo',
      created_at: material?.created_at || new Date().toISOString(),
      catman_nombre: row.catman_nombre || 'Sin catman registrado',
      catman_categoria: row.catman_categoria || material?.categoria || 'Sin categoria catman',
      marca_material: row.marca_material || 'Sin marca registrada',
      numero_suministradores: numeroNoNegativo(row.numero_suministradores),
      codigo_suministrador: row.codigo_suministrador,
      nombre_suministrador: row.nombre_suministrador,
      stock_libre: stockLibre,
      stock_disponible_operativo: stockDisponibleSistema,
      stock_bloqueado: numeroNoNegativo(row.bloqueado),
      stock_en_curso_pedido: numeroNoNegativo(row.stock_en_curso_pedido),
      stock_transito: numeroNoNegativo(row.stock_transito),
      demanda_bodega_fq: demanda,
      pedido_maximo_material: pedidoMaximo,
      stock_objetivo_material: stockObjetivo,
      faltante_total: numeroNoNegativo(row.faltante_total),
      estado_cobertura: row.estado_cobertura || 'sin_demanda',
      ocs_transito: numeroNoNegativo(row.ocs_transito),
      ocs_pendientes: numeroNoNegativo(row.ocs_pendientes),
      cantidad_oc_pendiente: numeroNoNegativo(row.cantidad_oc_pendiente),
      casos_bodega_fq: numeroNoNegativo(row.casos_bodega_fq),
      estado_planificable: row.estado_planificable || 'planificable',
      min_compra: numeroNoNegativo(row.min_compra) || 1,
      mult_compra: numeroNoNegativo(row.mult_compra) || 1,
      min_venta: numeroNoNegativo(row.min_venta) || 1,
      mult_venta: numeroNoNegativo(row.mult_venta) || 1,
    } satisfies InventarioOperativo
  })

  materiales.forEach((material) => {
    if (!materialesIncluidos.has(material.id)) {
      inventario.push(materialAInventarioFallback(material))
    }
  })

  inventario.sort((a, b) => a.nombre.localeCompare(b.nombre))

  return { ...materialesResult, data: inventario }
}

async function obtenerPedidoMaximoPorMaterial() {
  const porMaterialId = new Map<string, number>()
  const porNombre = new Map<string, number>()
  const porCodigo = new Map<string, number>()

  const result = await supabase
    .from('pedidos')
    .select('material_id,material,cantidad,cantidad_despacho,estado,codigo')
    .not('estado', 'in', '(entregado,cancelado,rechazado)')
    .returns<Array<PedidoMaterialDemanda & { codigo?: string | null }>>()

  if (result.error) return { porMaterialId, porNombre, porCodigo }

  ;(result.data || []).forEach((pedido) => {
    const cantidad = Math.max(numeroNoNegativo(pedido.cantidad), numeroNoNegativo(pedido.cantidad_despacho))
    if (cantidad <= 0) return

    if (pedido.material_id) {
      porMaterialId.set(pedido.material_id, Math.max(porMaterialId.get(pedido.material_id) || 0, cantidad))
    }

    if (pedido.material) {
      const nombre = normalizarLlave(pedido.material)
      porNombre.set(nombre, Math.max(porNombre.get(nombre) || 0, cantidad))
    }

    const codigoMaterial = extraerCodigoMaterialPedido(pedido.codigo)
    if (codigoMaterial) {
      porCodigo.set(codigoMaterial, Math.max(porCodigo.get(codigoMaterial) || 0, cantidad))
    }
  })

  return { porMaterialId, porNombre, porCodigo }
}

export async function obtenerMovimientosInventario() {
  return supabase
    .from('movimientos_inventario')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(80)
    .returns<MovimientoInventario[]>()
}

async function consultarMaterialesOperativos() {
  const rows: MaterialOperativoRow[] = []
  let desde = 0

  while (true) {
    const selectConUmbrales = camposMaterialesOperativos(true)
    const result = await supabase
      .from('materiales_operativos_v')
      .select(selectConUmbrales)
      .order('nombre_material', { ascending: true })
      .range(desde, desde + TAMANO_BLOQUE_INVENTARIO_OPERATIVO - 1)
      .returns<MaterialOperativoRow[]>()

    if (result.error?.code === '42703') {
      return consultarMaterialesOperativosCompatibles()
    }

    if (result.error) return result

    rows.push(...(result.data || []))

    if (!result.data || result.data.length < TAMANO_BLOQUE_INVENTARIO_OPERATIVO) {
      return { ...result, data: rows }
    }

    desde += TAMANO_BLOQUE_INVENTARIO_OPERATIVO
  }
}

async function consultarMaterialesOperativosCompatibles() {
  const rows: MaterialOperativoRow[] = []
  let desde = 0

  while (true) {
    const result = await supabase
      .from('materiales_operativos_v')
      .select(camposMaterialesOperativos(false))
      .order('nombre_material', { ascending: true })
      .range(desde, desde + TAMANO_BLOQUE_INVENTARIO_OPERATIVO - 1)
      .returns<MaterialOperativoRow[]>()

    if (result.error) return result

    rows.push(...(result.data || []))

    if (!result.data || result.data.length < TAMANO_BLOQUE_INVENTARIO_OPERATIVO) {
      return { ...result, data: rows }
    }

    desde += TAMANO_BLOQUE_INVENTARIO_OPERATIVO
  }
}

function camposMaterialesOperativos(incluirUmbrales: boolean) {
  return [
    'codigo_material',
    'nombre_material',
    'unidad_medida',
    'marca_material',
    'catman_nombre',
    'catman_categoria',
    'numero_suministradores',
    'codigo_suministrador',
    'nombre_suministrador',
    'stock_libre',
    'stock_disponible',
    'bloqueado',
    'stock_en_curso_pedido',
    'stock_transito',
    'demanda_bodega_fq',
    ...(incluirUmbrales ? ['pedido_maximo_material', 'stock_objetivo_material'] : []),
    'faltante_total',
    'estado_cobertura',
    'ocs_transito',
    'ocs_pendientes',
    'cantidad_oc_pendiente',
    'casos_bodega_fq',
    'estado_planificable',
    'min_compra',
    'mult_compra',
    'min_venta',
    'mult_venta',
  ].join(',')
}

export function escucharMovimientosInventario(onChange: () => void) {
  const notificar = crearNotificadorCambios(onChange, ['inventario', 'materiales', 'alertas'])
  const channel = supabase
    .channel('movimientos-inventario-tiempo-real')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'movimientos_inventario',
      },
      notificar
    )
    .subscribe()

  return () => {
    notificar.cancelar()
    supabase.removeChannel(channel)
  }
}

export function escucharInventarioOperativo(onChange: () => void) {
  const notificar = crearNotificadorCambios(onChange, [
    'inventario',
    'materiales',
    'pedidos',
    'alertas',
    'reportes',
    'otif',
  ])
  const channel = supabase
    .channel('inventario-operativo-tiempo-real')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'inventario_bodega',
      },
      notificar
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'oc_pendientes_bodega',
      },
      notificar
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'transito_bodega',
      },
      notificar
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'pedidos_bodega_fq',
      },
      notificar
    )
    .subscribe()

  return () => {
    notificar.cancelar()
    supabase.removeChannel(channel)
  }
}

export async function registrarMovimientoInventario(input: MovimientoInventarioInput) {
  const movimientoDisponible = await verificarMovimientosDisponibles()

  if (movimientoDisponible.error) return movimientoDisponible

  const materialResult = await supabase
    .from('materiales')
    .select('*')
    .eq('id', input.material_id)
    .limit(1)
    .returns<Material[]>()

  if (materialResult.error) return materialResult

  const material = materialResult.data?.[0]

  if (!material) {
    return { data: null, error: new Error('No se encontro el material seleccionado.') }
  }

  const stockAnterior = material.stock_actual
  const stockNuevo = calcularStockNuevo(stockAnterior, input.tipo, input.cantidad)

  if (stockNuevo < 0) {
    return { data: null, error: new Error('La salida supera el stock disponible.') }
  }

  const updateResult = await supabase
    .from('materiales')
    .update({ stock_actual: stockNuevo })
    .eq('id', material.id)

  if (updateResult.error) return updateResult

  const movimientoResult = await supabase.from('movimientos_inventario').insert({
    material_id: material.id,
    material_nombre: material.nombre,
    tipo: input.tipo,
    cantidad: input.cantidad,
    stock_anterior: stockAnterior,
    stock_nuevo: stockNuevo,
    motivo: input.motivo,
    responsable: input.responsable,
  })

  if (movimientoResult.error) return movimientoResult

  const nivelAnterior = resolverNivelAlertaStock(material, stockAnterior)
  const nivelNuevo = resolverNivelAlertaStock(material, stockNuevo)
  const syncResult = await sincronizarMaterialEnOperacion(
    material,
    stockNuevo,
    Boolean(nivelAnterior && nivelAnterior !== nivelNuevo)
  )

  if (syncResult.error) return syncResult

  await registrarAuditoria({
    entidad: 'materiales',
    entidad_id: material.id,
    accion: `movimiento_${input.tipo}`,
    detalle: `${material.nombre}: stock ${stockAnterior} -> ${stockNuevo}. Motivo: ${input.motivo}`,
    responsable: input.responsable,
  })

  invalidarDatosInventario()
  return movimientoResult
}

async function sincronizarMaterialEnOperacion(
  material: Material,
  stockNuevo: number,
  forzarNotificacionStock = false
) {
  const alertaResult = await sincronizarAlertaStockMaterial(material, stockNuevo, {
    forzarNotificacion: forzarNotificacionStock,
  })
  if (alertaResult.error) return alertaResult

  return { data: null, error: null }
}

async function verificarMovimientosDisponibles() {
  const result = await supabase.from('movimientos_inventario').select('id').limit(1)

  if (result.error) {
    return {
      data: null,
      error: new Error(
        'Falta activar movimientos de inventario en Supabase. Ejecuta supabase/schema_2_0_base_nueva.sql antes de registrar entradas o salidas.'
      ),
    }
  }

  return { data: null, error: null }
}

function calcularStockNuevo(
  stockActual: number,
  tipo: TipoMovimientoInventario,
  cantidad: number
) {
  if (tipo === 'entrada') return stockActual + cantidad
  if (tipo === 'salida') return stockActual - cantidad
  return cantidad
}

function materialAInventarioFallback(material: Material): InventarioOperativo {
  return {
    ...material,
    stock_libre: material.stock_actual,
    stock_disponible_operativo: material.stock_actual,
    stock_bloqueado: 0,
    stock_en_curso_pedido: 0,
    stock_transito: 0,
    demanda_bodega_fq: material.stock_minimo,
    pedido_maximo_material: material.stock_minimo,
    stock_objetivo_material: Math.max(1, material.stock_minimo * 3),
    faltante_total: Math.max(0, material.stock_minimo - material.stock_actual),
    estado_cobertura:
      material.stock_minimo <= 0
        ? 'sin_demanda'
        : material.stock_actual >= material.stock_minimo
          ? 'cubierto'
          : 'faltante',
    ocs_transito: 0,
    ocs_pendientes: 0,
    cantidad_oc_pendiente: 0,
    casos_bodega_fq: 0,
    catman_nombre: 'Sin catman registrado',
    catman_categoria: material.categoria || 'Sin categoria catman',
    marca_material: 'Sin marca registrada',
    numero_suministradores: 0,
    codigo_suministrador: null,
    nombre_suministrador: null,
    estado_planificable: 'planificable',
    min_compra: 1,
    mult_compra: 1,
    min_venta: 1,
    mult_venta: 1,
  }
}

function numero(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function numeroNoNegativo(value: number | string | null | undefined) {
  return Math.max(0, numero(value))
}

function stockSistema(stockFuente: number, stockMaterial: number | null) {
  if (stockMaterial === null) return stockFuente
  if (stockFuente > 0 && stockMaterial > 0) return Math.min(stockFuente, stockMaterial)
  if (stockFuente > 0) return stockFuente
  return stockMaterial
}

function extraerCodigoMaterialPedido(codigo: string | null | undefined) {
  const match = /-(9\d{7,})$/.exec(codigo || '')
  return match?.[1] || null
}

function normalizarLlave(value: string | null | undefined) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function categoriaPorCobertura(estadoCobertura: string | null) {
  if (estadoCobertura === 'faltante') return 'Faltante bodega-franquiciado'
  if (estadoCobertura === 'cubierto_con_transito') return 'Cubierto con transito'
  if (estadoCobertura === 'cubierto') return 'Demanda bodega-franquiciado'
  return 'Catalogo operativo'
}

function invalidarDatosInventario() {
  invalidarCache('inventario', 'materiales', 'pedidos', 'alertas', 'reportes', 'otif')
}
