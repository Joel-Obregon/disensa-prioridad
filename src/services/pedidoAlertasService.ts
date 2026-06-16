import { emitirAlertaVisualLocal } from '../lib/alertRuntimeEvents'
import { describirTiempoPedido, resolverSemaforoPedido } from '../lib/semaforoOperativo'
import type { Alerta } from '../types/alerta'
import type { Pedido } from '../types/pedido'
import { invalidarCache } from './cacheService'
import { supabase } from './supabaseClient'

const TIPOS_ALERTA_PRIORIZACION = [
  'priorizacion_bodega_fq',
  'pedido_retrasado',
  'priorizacion_pedido',
]

type OpcionesSyncPedido = {
  emitir?: boolean
  responsable?: string
}

export async function sincronizarAlertaSemaforoPedido(
  pedido: Pedido,
  opciones: OpcionesSyncPedido = {}
) {
  const nivel = nivelAlertaPedido(pedido)

  if (!nivel) {
    const cierre = await cerrarAlertasPedido(pedido.id)
    if (!cierre.error) invalidarCache('alertas')
    return cierre
  }

  const existentes = await supabase
    .from('alertas')
    .select('*')
    .eq('pedido_id', pedido.id)
    .in('tipo_alerta', TIPOS_ALERTA_PRIORIZACION)
    .in('estado', ['activa', 'revisada'])
    .order('created_at', { ascending: false })
    .returns<Alerta[]>()

  if (esErrorTablaOColumnaOpcional(existentes.error)) return { data: null, error: null }
  if (existentes.error) return existentes

  const mensaje = mensajeAlertaPedido(pedido, nivel)
  const responsable = opciones.responsable || responsablePedido(pedido)
  const alertaActual = existentes.data?.[0]
  const cambioVisual =
    !alertaActual ||
    alertaActual.nivel !== nivel ||
    alertaActual.mensaje !== mensaje ||
    alertaActual.estado !== 'activa'

  const payload = {
    pedido_id: pedido.id,
    material_id: pedido.material_id || null,
    tipo_alerta: 'priorizacion_bodega_fq',
    nivel,
    mensaje,
    estado: 'activa',
    responsable,
  }

  const result = alertaActual
    ? await supabase
        .from('alertas')
        .update(payload)
        .eq('id', alertaActual.id)
        .select('*')
        .single<Alerta>()
    : await supabase.from('alertas').insert(payload).select('*').single<Alerta>()

  if (esErrorTablaOColumnaOpcional(result.error)) return { data: null, error: null }
  if (result.error) return result

  const duplicadas = (existentes.data || []).filter((alerta) => alerta.id !== result.data.id)
  if (duplicadas.length > 0) {
    await cerrarAlertasPorIds(duplicadas.map((alerta) => alerta.id))
  }

  invalidarCache('alertas')

  if (cambioVisual && opciones.emitir !== false) {
    emitirAlertaVisualLocal(enriquecerAlertaPedido(result.data, pedido))
  }

  return { ...result, data: enriquecerAlertaPedido(result.data, pedido) }
}

function nivelAlertaPedido(pedido: Pedido): Alerta['nivel'] | null {
  const semaforo = resolverSemaforoPedido(pedido)

  if (semaforo === 'critico') return 'critica'
  if (semaforo === 'riesgo') return 'alta'
  return null
}

function mensajeAlertaPedido(pedido: Pedido, nivel: Alerta['nivel']) {
  const codigo = pedido.codigo_consulta || pedido.codigo
  const tiempo = describirTiempoPedido(pedido)
  const prefijo =
    nivel === 'critica'
      ? 'Pedido en retraso critico'
      : 'Pedido con retraso operativo'

  return `${prefijo}: ${codigo} requiere seguimiento. ${tiempo} para ${pedido.material}.`
}

function responsablePedido(pedido: Pedido) {
  if (pedido.origen === 'suministrador' && pedido.destino === 'bodega') return 'Suministrador'
  return 'Bodega'
}

async function cerrarAlertasPedido(pedidoId: string) {
  const result = await supabase
    .from('alertas')
    .update({ estado: 'cerrada' })
    .eq('pedido_id', pedidoId)
    .in('tipo_alerta', TIPOS_ALERTA_PRIORIZACION)
    .in('estado', ['activa', 'revisada'])

  return esErrorTablaOColumnaOpcional(result.error) ? { data: null, error: null } : result
}

async function cerrarAlertasPorIds(ids: string[]) {
  if (ids.length === 0) return { data: null, error: null }

  const result = await supabase.from('alertas').update({ estado: 'cerrada' }).in('id', ids)
  return esErrorTablaOColumnaOpcional(result.error) ? { data: null, error: null } : result
}

function enriquecerAlertaPedido(alerta: Alerta, pedido: Pedido): Alerta {
  return {
    ...alerta,
    pedido_codigo: pedido.codigo_consulta || pedido.codigo,
    pedido_estado: pedido.estado,
    pedido_fecha_compromiso: pedido.fecha_compromiso,
    pedido_fecha_solicitud: pedido.fecha_solicitud,
    pedido_stock_disponible: pedido.stock_disponible,
    pedido_cantidad: pedido.cantidad,
    pedido_cantidad_despacho: pedido.cantidad_despacho || null,
    pedido_cantidad_despachada: pedido.cantidad_despachada || null,
    pedido_material: pedido.material,
    pedido_unidad_medida: pedido.unidad_medida,
    pedido_origen: pedido.origen,
    pedido_destino: pedido.destino,
    pedido_solicitante: pedido.solicitante,
    pedido_cedula_solicitante: pedido.cedula_solicitante || null,
    pedido_urgencia: pedido.urgencia,
    pedido_tipo_cliente: pedido.tipo_cliente,
    pedido_accion_solicitante: pedido.accion_solicitante || null,
    pedido_condicion_material: pedido.condicion_material || null,
    pedido_prioridad_calculada: pedido.prioridad_calculada || null,
    pedido_despachado_at: pedido.despachado_at || null,
    pedido_despachado_por: pedido.despachado_por || null,
  }
}

function esErrorTablaOColumnaOpcional(error: { code?: string } | null | undefined) {
  return error?.code === '42P01' || error?.code === '42703' || error?.code === 'PGRST205'
}
