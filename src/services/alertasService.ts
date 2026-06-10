import { supabase } from './supabaseClient'
import type { Alerta } from '../types/alerta'

type PedidoParaAlerta = {
  id: string
  codigo: string | null
  codigo_consulta?: string | null
  estado: string | null
  fecha_compromiso: string | null
  fecha_solicitud?: string | null
  stock_disponible: number | null
  cantidad: number | null
  cantidad_despacho?: number | null
  cantidad_despachada?: number | null
  material: string | null
  unidad_medida?: string | null
  origen?: string | null
  destino?: string | null
  solicitante?: string | null
  cedula_solicitante?: string | null
  urgencia?: string | null
  tipo_cliente?: string | null
  accion_solicitante?: string | null
  condicion_material?: string | null
  prioridad_calculada?: number | null
  despachado_at?: string | null
  despachado_por?: string | null
}

export async function obtenerAlertas() {
  const result = await supabase
    .from('alertas')
    .select('*')
    .order('created_at', { ascending: false })
    .returns<Alerta[]>()

  if (result.error || !result.data?.length) return result

  const enriquecidas = await enriquecerAlertasConPedidos(result.data)

  return { ...result, data: enriquecidas }
}

export async function obtenerUltimaAlertaVisualActiva() {
  const result = await supabase
    .from('alertas')
    .select('*')
    .eq('estado', 'activa')
    .in('nivel', ['critica', 'alta', 'media'])
    .order('created_at', { ascending: false })
    .limit(1)
    .returns<Alerta[]>()

  if (result.error) return result

  return {
    ...result,
    data: result.data?.[0] ? [normalizarAlerta(result.data[0])] : [],
  }
}

export async function actualizarEstadoAlerta(id: string, estado: Alerta['estado']) {
  return supabase.from('alertas').update({ estado }).eq('id', id)
}

export function escucharCambiosAlertas(onChange: () => void) {
  const channel = supabase
    .channel('alertas-cambios-tiempo-real')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'alertas',
      },
      onChange
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

export function escucharAlertas(onChange: (alerta: Alerta) => void) {
  const channel = supabase.channel('alertas-tiempo-real')

  channel.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'alertas',
    },
    (payload) => {
      const alerta = normalizarAlerta(payload.new as Partial<Alerta>)
      const anterior = payload.old as Partial<Alerta> | undefined
      const evento = 'eventType' in payload ? payload.eventType : null

      if (
        evento === 'UPDATE' &&
        anterior?.estado === alerta.estado &&
        anterior?.nivel === alerta.nivel &&
        anterior?.mensaje === alerta.mensaje
      ) {
        return
      }

      if (alerta.estado === 'activa' && alerta.nivel !== 'informativa') {
        onChange(alerta)
      }
    }
  )

  channel.subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

function normalizarAlerta(alerta: Partial<Alerta>): Alerta {
  return {
    id: alerta.id || crypto.randomUUID(),
    pedido_id: alerta.pedido_id || null,
    material_id: alerta.material_id || null,
    tipo_alerta: alerta.tipo_alerta || 'alerta_visual',
    nivel: alerta.nivel || 'informativa',
    mensaje: alerta.mensaje || 'Se recibio una nueva alerta del sistema.',
    estado: alerta.estado || 'activa',
    responsable: alerta.responsable || null,
    pedido_codigo: alerta.pedido_codigo || null,
    dias_sin_gestion: alerta.dias_sin_gestion || null,
    created_at: alerta.created_at || new Date().toISOString(),
  }
}

async function enriquecerAlertasConPedidos(alertas: Alerta[]) {
  const pedidoIds = [
    ...new Set(
      alertas
        .map((alerta) => alerta.pedido_id)
        .filter((pedidoId): pedidoId is string => Boolean(pedidoId))
    ),
  ]

  if (pedidoIds.length === 0) return alertas

  const pedidos = await obtenerPedidosParaAlertas(pedidoIds)

  if (!pedidos) return alertas

  const pedidosPorId = new Map(pedidos.map((pedido) => [pedido.id, pedido]))

  return alertas.map((alerta) => {
    if (!alerta.pedido_id) return alerta

    const pedido = pedidosPorId.get(alerta.pedido_id)

    if (!pedido) return alerta

    return {
      ...alerta,
      pedido_codigo: alerta.pedido_codigo || pedido.codigo,
      pedido_estado: pedido.estado,
      pedido_fecha_compromiso: pedido.fecha_compromiso,
      pedido_fecha_solicitud: pedido.fecha_solicitud || null,
      pedido_stock_disponible: pedido.stock_disponible,
      pedido_cantidad: pedido.cantidad,
      pedido_cantidad_despacho: pedido.cantidad_despacho || null,
      pedido_cantidad_despachada: pedido.cantidad_despachada || null,
      pedido_material: pedido.material,
      pedido_unidad_medida: pedido.unidad_medida || null,
      pedido_origen: pedido.origen || null,
      pedido_destino: pedido.destino || null,
      pedido_solicitante: pedido.solicitante || null,
      pedido_cedula_solicitante: pedido.cedula_solicitante || null,
      pedido_urgencia: pedido.urgencia || null,
      pedido_tipo_cliente: pedido.tipo_cliente || null,
      pedido_accion_solicitante: pedido.accion_solicitante || null,
      pedido_condicion_material: pedido.condicion_material || null,
      pedido_prioridad_calculada: pedido.prioridad_calculada || null,
      pedido_despachado_at: pedido.despachado_at || null,
      pedido_despachado_por: pedido.despachado_por || null,
    }
  })
}

async function obtenerPedidosParaAlertas(pedidoIds: string[]) {
  const result = await supabase
    .from('pedidos')
    .select(
      'id,codigo,codigo_consulta,estado,fecha_solicitud,fecha_compromiso,stock_disponible,cantidad,cantidad_despacho,cantidad_despachada,material,unidad_medida,origen,destino,solicitante,cedula_solicitante,urgencia,tipo_cliente,accion_solicitante,condicion_material,prioridad_calculada,despachado_at,despachado_por'
    )
    .in('id', pedidoIds)
    .returns<PedidoParaAlerta[]>()

  if (!result.error) return result.data || []

  if (result.error.code !== '42703') return null

  const fallback = await supabase
    .from('pedidos')
    .select('id,codigo,estado,fecha_compromiso,stock_disponible,cantidad,material')
    .in('id', pedidoIds)
    .returns<PedidoParaAlerta[]>()

  if (fallback.error) return null

  return fallback.data || []
}
