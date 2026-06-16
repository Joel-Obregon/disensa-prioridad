import { emitirAlertaVisualLocal } from '../lib/alertRuntimeEvents'
import type { Alerta } from '../types/alerta'
import type { Material } from '../types/material'
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

const TIPOS_ALERTA_STOCK = ['stock_bajo', 'faltante_bodega_fq']

export async function sincronizarAlertaStockMaterial(
  material: MaterialConStock,
  stockActual = material.stock_actual
) {
  const nivelNuevo = nivelAlertaStock(stockActual, material)

  if (!nivelNuevo) {
    const result = await supabase
      .from('alertas')
      .update({ estado: 'cerrada' })
      .eq('material_id', material.id)
      .in('tipo_alerta', TIPOS_ALERTA_STOCK)
      .in('estado', ['activa', 'revisada'])

    return esErrorTablaOColumnaOpcional(result.error) ? { data: null, error: null } : result
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
    const updateResult = await supabase
      .from('alertas')
      .update({
        estado: 'activa',
        tipo_alerta: 'stock_bajo',
        nivel: nivelNuevo,
        mensaje,
        responsable: 'Departamento de inventario',
      })
      .eq('id', alertaMismoNivel.id)
      .select('*')
      .single<Alerta>()

    if (updateResult.error) return updateResult

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
      responsable: 'Departamento de inventario',
    })
    .select('*')
    .single<Alerta>()

  if (!crearAlerta.error) emitirAlertaVisualLocal(crearAlerta.data)

  return esErrorTablaOColumnaOpcional(crearAlerta.error)
    ? { data: null, error: null }
    : crearAlerta
}

function cerrarAlertasStock(ids: string[]) {
  return supabase.from('alertas').update({ estado: 'cerrada' }).in('id', ids)
}

function nivelAlertaStock(
  stockActual: number,
  material: Pick<MaterialConStock, 'stock_minimo' | 'pedido_maximo_material' | 'stock_objetivo_material' | 'demanda_bodega_fq'>
): Alerta['nivel'] | null {
  const minimo = umbralMinimoStock(material)
  const normal = umbralNormalStock(material)

  if (stockActual >= normal) return null
  if (stockActual <= 0 || stockActual < minimo) return 'critica'
  return 'alta'
}

function mensajeAlertaStock(
  material: MaterialConStock,
  stockActual: number,
  nivel: Alerta['nivel']
) {
  const minimo = umbralMinimoStock(material)
  const normal = umbralNormalStock(material)
  const estado = nivel === 'critica' ? 'critico' : 'en riesgo'
  const codigo = material.codigo_material ? `${material.codigo_material} - ` : ''

  return `Material ${codigo}${material.nombre} en estado ${estado}: stock ${Math.max(
    0,
    stockActual
  )} / minimo ${minimo} / normal ${normal}. Departamento debe verificar reposicion.`
}

function umbralMinimoStock(
  material: Pick<MaterialConStock, 'stock_minimo' | 'pedido_maximo_material' | 'demanda_bodega_fq'>
) {
  return Math.max(1, material.pedido_maximo_material || material.stock_minimo || material.demanda_bodega_fq || 1)
}

function umbralNormalStock(material: Pick<MaterialConStock, 'stock_minimo' | 'pedido_maximo_material' | 'stock_objetivo_material' | 'demanda_bodega_fq'>) {
  return Math.max(umbralMinimoStock(material) * 3, material.stock_objetivo_material || 0)
}

function esErrorTablaOColumnaOpcional(error: { code?: string } | null | undefined) {
  return error?.code === '42P01' || error?.code === '42703'
}
