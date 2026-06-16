import { supabase } from './supabaseClient'
import { consultarConCache } from './cacheService'

export type PedidoDetalleOperativo = {
  codigo_pedido: string
  pedido_key: string | null
  codigo_consulta: string | null
  flujo_operativo: string | null
  tipo_caso: string | null
  responsable_operativo: string | null
  resolucion: string | null
  estado_fuente: string | null
  codigo_cliente: string | null
  cliente: string | null
  zonas: string | null
  codigo_material: string | null
  nombre_material: string | null
  nombre_suministrador: string | null
  stock_disponible_real: number | string | null
  stock_transito_real: number | string | null
  cantidad_oc_pendiente: number | string | null
  reabastecimiento_pendiente: number | string | null
  fecha_reabastecimiento: string | null
  orden_compra_reabastecimiento: string | null
  minimo_venta: number | string | null
  multiplo_venta: number | string | null
  estado_planificable: 'planificable' | 'no planificable' | 'agotar stock' | string | null
  prioridad_calculada?: number | null
}

export async function obtenerDetallesPedidosOperativos() {
  return consultarConCache('detalles-pedidos:operativos', 12_000, cargarDetallesPedidosOperativos)
}

async function cargarDetallesPedidosOperativos() {
  const result = await supabase
    .from('pedido_detalle_operativo_v')
    .select('*')
    .returns<PedidoDetalleOperativo[]>()

  if (result.error && esVistaOpcionalNoDisponible(result.error)) {
    return { data: [], error: null }
  }

  return result
}

function esVistaOpcionalNoDisponible(error: { code?: string; message?: string }) {
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.message?.toLowerCase().includes('pedido_detalle_operativo_v')
  )
}
