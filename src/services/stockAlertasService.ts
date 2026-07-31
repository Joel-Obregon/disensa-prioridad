import { emitirAlertaVisualLocal } from '../lib/alertRuntimeEvents'
import type { Alerta } from '../types/alerta'
import type { Material } from '../types/material'
import { invalidarCache } from './cacheService'
import { supabase } from './supabaseClient'

type MaterialConStock = Pick<
  Material,
  'id' | 'codigo_material' | 'nombre' | 'stock_actual' | 'stock_minimo'
> & {
  pedido_maximo_material?: number | null
  stock_objetivo_material?: number | null
  demanda_bodega_fq?: number | null
}

type AlertaStockExistente = Pick<Alerta, 'id' | 'nivel' | 'estado'>
type OpcionesSyncStock = {
  emitir?: boolean
  forzarNotificacion?: boolean
  responsable?: string
}

const TIPOS_ALERTA_STOCK = ['stock_bajo', 'faltante_bodega_fq']

const UMBRAL_MINIMO_STOCK = 30
const UMBRAL_NORMAL_STOCK = 60

export async function sincronizarAlertaStockMaterial(
  material: MaterialConStock,
  stockActual = material.stock_actual,
  opciones: OpcionesSyncStock = {}
) {
  const nivelNuevo = nivelAlertaStock(stockActual)
  const responsable = opciones.responsable || 'Departamento de inventario'

  if (!nivelNuevo) {
    const existentes = await supabase
      .from('alertas')
      .select('id,nivel,estado')
      .eq('material_id', material.id)
      .in('tipo_alerta', TIPOS_ALERTA_STOCK)
      .in('estado', ['activa', 'revisada'])
      .returns<AlertaStockExistente[]>()

    if (esErrorTablaOColumnaOpcional(existentes.error)) return { data: null, error: null }
    if (existentes.error) return existentes

    const result = await supabase
      .from('alertas')
      .update({ estado: 'cerrada' })
      .eq('material_id', material.id)
      .in('tipo_alerta', TIPOS_ALERTA_STOCK)
      .in('estado', ['activa', 'revisada'])

    const normalizado = esErrorTablaOColumnaOpcional(result.error)
      ? { data: null, error: null }
      : result

    if (!normalizado.error) {
      invalidarCache('alertas')

      if (opciones.forzarNotificacion && opciones.emitir !== false && (existentes.data || []).length > 0) {
        emitirAlertaVisualLocal(alertaStockNormalizado(material, stockActual, responsable), {
          forzarNotificacion: true,
        })
      }
    }

    return normalizado
  }

  const existentes = await supabase
    .from('alertas')
    .select('id,nivel,estado')
    .eq('material_id', material.id)
    .in('tipo_alerta', TIPOS_ALERTA_STOCK)
    .in('estado', ['activa', 'revisada'])
    .returns<AlertaStockExistente[]>()

  if (esErrorTablaOColumnaOpcional(existentes.error)) return { data: null, error: null }
  if (existentes.error) return existentes

  const mensaje = mensajeAlertaStock(material, stockActual, nivelNuevo)
  const alertaMismoNivel = (existentes.data || []).find((alerta) => alerta.nivel === nivelNuevo)

  if (alertaMismoNivel) {
    const debeEmitir = opciones.forzarNotificacion || alertaMismoNivel.estado !== 'activa'
    const updateResult = await supabase
      .from('alertas')
      .update({
        estado: 'activa',
        tipo_alerta: 'stock_bajo',
        nivel: nivelNuevo,
        mensaje,
        responsable,
      })
      .eq('id', alertaMismoNivel.id)
      .select('*')
      .single<Alerta>()

    if (updateResult.error) return updateResult
    if (debeEmitir && opciones.emitir !== false) {
      emitirAlertaVisualLocal(updateResult.data, {
        forzarNotificacion: opciones.forzarNotificacion,
      })
    }
    invalidarCache('alertas')

    const duplicadas = (existentes.data || []).filter((alerta) => alerta.id !== alertaMismoNivel.id)
    if (duplicadas.length > 0) {
      const cerrarDuplicadas = await cerrarAlertasStock(duplicadas.map((alerta) => alerta.id))
      if (cerrarDuplicadas.error) return cerrarDuplicadas
    }

    return updateResult
  }

  const idsAnteriores = (existentes.data || []).map((alerta) => alerta.id)
  if (idsAnteriores.length > 0) {
    const cerrarAnteriores = await cerrarAlertasStock(idsAnteriores)
    if (cerrarAnteriores.error) return cerrarAnteriores
  }

  const crearAlerta = await supabase
    .from('alertas')
    .insert({
      material_id: material.id,
      tipo_alerta: 'stock_bajo',
      nivel: nivelNuevo,
      mensaje,
      estado: 'activa',
      responsable,
    })
    .select('*')
    .single<Alerta>()

  if (!crearAlerta.error && opciones.emitir !== false) {
    emitirAlertaVisualLocal(crearAlerta.data, {
      forzarNotificacion: opciones.forzarNotificacion,
    })
  }

  const normalizado = esErrorTablaOColumnaOpcional(crearAlerta.error)
    ? { data: null, error: null }
    : crearAlerta

  if (!normalizado.error) invalidarCache('alertas')
  return normalizado
}

async function cerrarAlertasStock(ids: string[]) {
  const result = await supabase.from('alertas').update({ estado: 'cerrada' }).in('id', ids)

  if (!result.error) invalidarCache('alertas')
  return result
}

function nivelAlertaStock(stockActual: number): Alerta['nivel'] | null {
  if (stockActual > umbralNormalStock()) return null
  if (stockActual <= umbralMinimoStock()) return 'critica'
  return 'alta'
}

export function resolverNivelAlertaStock(
  material: MaterialConStock,
  stockActual = material.stock_actual
) {
  return nivelAlertaStock(stockActual)
}

function mensajeAlertaStock(
  material: MaterialConStock,
  stockActual: number,
  nivel: Alerta['nivel']
) {
  const minimo = umbralMinimoStock()
  const normal = umbralNormalStock()
  const estado = nivel === 'critica' ? 'critico' : 'en riesgo'
  const codigo = material.codigo_material ? `${material.codigo_material} - ` : ''

  return `Material ${codigo}${material.nombre} en estado ${estado}: stock ${Math.max(
    0,
    stockActual
  )} / minimo ${minimo} / normal ${normal}. Departamento debe verificar reposicion.`
}

function alertaStockNormalizado(
  material: MaterialConStock,
  stockActual: number,
  responsable: string
): Alerta {
  const codigo = material.codigo_material ? `${material.codigo_material} - ` : ''
  const normal = umbralNormalStock()

  return {
    id: `stock-normalizado-${material.id}-${Date.now()}`,
    pedido_id: null,
    material_id: material.id,
    tipo_alerta: 'stock_normalizado',
    nivel: 'informativa',
    mensaje: `Material ${codigo}${material.nombre} normalizado: stock ${Math.max(
      0,
      stockActual
    )} / normal ${normal}. La alerta anterior fue cerrada.`,
    estado: 'activa',
    responsable,
    pedido_codigo: null,
    pedido_estado: null,
    pedido_fecha_compromiso: null,
    pedido_fecha_solicitud: null,
    pedido_stock_disponible: stockActual,
    pedido_cantidad: normal,
    pedido_cantidad_despacho: normal,
    pedido_cantidad_despachada: null,
    pedido_material: material.nombre,
    pedido_unidad_medida: null,
    pedido_origen: null,
    pedido_destino: null,
    pedido_solicitante: null,
    pedido_cedula_solicitante: null,
    pedido_urgencia: null,
    pedido_tipo_cliente: null,
    pedido_accion_solicitante: null,
    pedido_condicion_material: null,
    pedido_prioridad_calculada: null,
    pedido_despachado_at: null,
    pedido_despachado_por: null,
    created_at: new Date().toISOString(),
  }
}

function umbralMinimoStock() {
  return UMBRAL_MINIMO_STOCK
}

function umbralNormalStock() {
  return UMBRAL_NORMAL_STOCK
}

function esErrorTablaOColumnaOpcional(error: { code?: string } | null | undefined) {
  return error?.code === '42P01' || error?.code === '42703'
}
