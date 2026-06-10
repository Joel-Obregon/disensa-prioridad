import { supabase } from './supabaseClient'
import { actualizarEstadoPedido } from './pedidosService'
import type { Pedido } from '../types/pedido'
import type {
  MotivoReporteFranquiciado,
  ReporteFranquiciado,
} from '../types/reporteFranquiciado'

export type ReporteFranquiciadoInput = {
  pedido_id?: string | null
  codigo_consulta: string
  cedula_solicitante: string
  solicitante?: string | null
  motivo: MotivoReporteFranquiciado
  descripcion: string
}

export async function consultarPedidoInvitado(codigo: string, cedula: string) {
  const codigoLimpio = codigo.trim()
  const cedulaLimpia = normalizarCedula(cedula)

  const consultaPorCodigoInvitado = await supabase
    .from('pedidos')
    .select('*')
    .eq('codigo_consulta', codigoLimpio)
    .eq('cedula_solicitante', cedulaLimpia)
    .maybeSingle<Pedido>()

  if (consultaPorCodigoInvitado.error || consultaPorCodigoInvitado.data) {
    return consultaPorCodigoInvitado
  }

  return supabase
    .from('pedidos')
    .select('*')
    .eq('codigo', codigoLimpio)
    .eq('cedula_solicitante', cedulaLimpia)
    .maybeSingle<Pedido>()
}

export async function crearReporteFranquiciado(reporte: ReporteFranquiciadoInput) {
  return supabase
    .from('reportes_franquiciado')
    .insert({
      ...reporte,
      codigo_consulta: reporte.codigo_consulta.trim(),
      cedula_solicitante: normalizarCedula(reporte.cedula_solicitante),
      descripcion: reporte.descripcion.trim(),
      estado: 'recibido',
    })
    .select()
    .single<ReporteFranquiciado>()
}

export async function confirmarEntregaFranquiciado(pedido: Pedido, cedula: string) {
  const cedulaPedido = normalizarCedula(pedido.cedula_solicitante || '')
  const cedulaConsulta = normalizarCedula(cedula)

  if (!cedulaPedido || cedulaPedido !== cedulaConsulta) {
    return {
      data: null,
      error: new Error('La cedula o RUC no coincide con el pedido consultado.'),
    }
  }

  if (pedido.estado !== 'en_despacho') {
    return {
      data: null,
      error: new Error('Solo se puede confirmar la entrega cuando el pedido esta en despacho.'),
    }
  }

  return actualizarEstadoPedido(pedido.id, 'entregado', {
    pedido,
    responsable: 'Franquiciado',
  })
}

export async function obtenerReportesFranquiciado() {
  return supabase
    .from('reportes_franquiciado')
    .select('*')
    .order('created_at', { ascending: false })
    .returns<ReporteFranquiciado[]>()
}

export function escucharReportesFranquiciado(onChange: () => void) {
  const channel = supabase
    .channel('reportes-franquiciado-tiempo-real')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'reportes_franquiciado',
      },
      onChange
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

export function normalizarCedula(valor: string) {
  return valor.replace(/\D/g, '').trim()
}
