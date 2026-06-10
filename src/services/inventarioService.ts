import { registrarAuditoria } from './auditoriaService'
import { obtenerMateriales } from './materialesService'
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

type PedidoStock = {
  id: string
  cantidad: number
  cantidad_despacho?: number | null
  estado: string
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

export async function obtenerInventarioOperativo() {
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

  const inventario = (operativosResult.data || []).map((row) => {
    const material =
      materialesPorCodigo.get(row.codigo_material) ||
      materialesPorNombre.get(normalizarLlave(row.nombre_material))
    const stockLibreFuente = numeroNoNegativo(row.stock_libre)
    const stockDisponibleFuente = numeroNoNegativo(row.stock_disponible)
    const stockMaterial = material ? numeroNoNegativo(material.stock_actual) : null
    const stockDisponibleSistema = stockSistema(stockDisponibleFuente, stockMaterial)
    const stockLibre = stockLibreFuente
    const demanda = numeroNoNegativo(row.demanda_bodega_fq)

    return {
      id: material?.id || row.codigo_material,
      codigo_material: row.codigo_material,
      nombre: material?.nombre || row.nombre_material || `Material ${row.codigo_material}`,
      categoria: material?.categoria || categoriaPorCobertura(row.estado_cobertura),
      stock_actual: stockDisponibleSistema,
      stock_minimo: demanda,
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

  return { ...materialesResult, data: inventario }
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
    const result = await supabase
      .from('materiales_operativos_v')
      .select(
        [
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
      )
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

export function escucharMovimientosInventario(onChange: () => void) {
  const channel = supabase
    .channel('movimientos-inventario-tiempo-real')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'movimientos_inventario',
      },
      onChange
    )
    .subscribe()

  return () => {
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

  const syncResult = await sincronizarMaterialEnOperacion(material, stockNuevo)

  if (syncResult.error) return syncResult

  await registrarAuditoria({
    entidad: 'materiales',
    entidad_id: material.id,
    accion: `movimiento_${input.tipo}`,
    detalle: `${material.nombre}: stock ${stockAnterior} -> ${stockNuevo}. Motivo: ${input.motivo}`,
    responsable: input.responsable,
  })

  return movimientoResult
}

async function sincronizarMaterialEnOperacion(material: Material, stockNuevo: number) {
  const pedidosResult = await obtenerPedidosMaterial(material)

  if (pedidosResult.error) return pedidosResult

  for (const pedido of pedidosResult.data || []) {
    const cantidadOperativa =
      pedido.cantidad_despacho && pedido.cantidad_despacho > 0
        ? pedido.cantidad_despacho
        : pedido.cantidad
    const estado = resolverEstadoPedidoPorStock(pedido.estado, stockNuevo, cantidadOperativa)
    const updateResult = await supabase
      .from('pedidos')
      .update({ stock_disponible: stockNuevo, estado })
      .eq('id', pedido.id)

    if (updateResult.error) return updateResult
  }

  if (!requiereAlertaStock(stockNuevo, material.stock_minimo)) {
    const cerrarAlertas = await supabase
      .from('alertas')
      .update({ estado: 'cerrada' })
      .eq('material_id', material.id)
      .eq('tipo_alerta', 'stock_bajo')
      .in('estado', ['activa', 'revisada'])

    if (esErrorTablaOColumnaOpcional(cerrarAlertas.error)) return { data: null, error: null }
    if (cerrarAlertas.error) return cerrarAlertas
  } else {
    const alertaExistente = await supabase
      .from('alertas')
      .select('id')
      .eq('material_id', material.id)
      .eq('tipo_alerta', 'stock_bajo')
      .in('estado', ['activa', 'revisada'])
      .limit(1)

    if (esErrorTablaOColumnaOpcional(alertaExistente.error)) return { data: null, error: null }
    if (alertaExistente.error) return alertaExistente

    const mensaje = `Material ${material.nombre} bajo el minimo: stock ${stockNuevo} / minimo ${material.stock_minimo}.`

    if (alertaExistente.data && alertaExistente.data.length > 0) {
      const actualizarAlerta = await supabase
        .from('alertas')
        .update({
          estado: 'activa',
          nivel: nivelAlertaStock(stockNuevo),
          mensaje,
        })
        .eq('id', alertaExistente.data[0].id)

      if (actualizarAlerta.error) return actualizarAlerta
    } else {
      const crearAlerta = await supabase.from('alertas').insert({
        material_id: material.id,
        tipo_alerta: 'stock_bajo',
        nivel: nivelAlertaStock(stockNuevo),
        mensaje,
        estado: 'activa',
      })

      if (esErrorTablaOColumnaOpcional(crearAlerta.error)) return { data: null, error: null }
      if (crearAlerta.error) return crearAlerta
    }
  }

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

async function obtenerPedidosMaterial(material: Material) {
  const porId = await supabase
    .from('pedidos')
    .select('id,cantidad,cantidad_despacho,estado')
    .eq('material_id', material.id)
    .returns<PedidoStock[]>()

  const porNombre = await supabase
    .from('pedidos')
    .select('id,cantidad,cantidad_despacho,estado')
    .eq('material', material.nombre)
    .returns<PedidoStock[]>()

  if (porId.error || porNombre.error) {
    const porIdFallback = await supabase
      .from('pedidos')
      .select('id,cantidad,estado')
      .eq('material_id', material.id)
      .returns<PedidoStock[]>()

    const porNombreFallback = await supabase
      .from('pedidos')
      .select('id,cantidad,estado')
      .eq('material', material.nombre)
      .returns<PedidoStock[]>()

    if (porIdFallback.error) return porIdFallback
    if (porNombreFallback.error) return porNombreFallback

    return unirPedidos(porIdFallback.data || [], porNombreFallback.data || [])
  }

  return unirPedidos(porId.data || [], porNombre.data || [])
}

function unirPedidos(porId: PedidoStock[], porNombre: PedidoStock[]) {
  const mapa = new Map<string, PedidoStock>()

  ;[...porId, ...porNombre].forEach((pedido) => {
    mapa.set(pedido.id, pedido)
  })

  return { data: [...mapa.values()], error: null }
}

function resolverEstadoPedidoPorStock(
  estadoActual: string,
  stockNuevo: number,
  cantidadOperativa: number
) {
  if (['entregado', 'cancelado', 'rechazado'].includes(estadoActual)) {
    return estadoActual
  }

  if (estadoActual === 'en_despacho') return estadoActual

  if (stockNuevo < cantidadOperativa) return 'sin_stock'
  if (estadoActual === 'sin_stock') return 'pendiente'
  return estadoActual
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

function nivelAlertaStock(stockActual: number) {
  return stockActual <= 0 ? 'critica' : 'alta'
}

function requiereAlertaStock(stockActual: number, stockMinimo: number) {
  return stockActual <= 0 || stockActual < stockMinimo
}

function esErrorTablaOColumnaOpcional(error: { code?: string } | null | undefined) {
  return error?.code === '42P01' || error?.code === '42703'
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
