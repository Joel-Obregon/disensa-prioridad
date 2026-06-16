import { supabase } from './supabaseClient'
import {
  consultarConCache,
  crearNotificadorCambios,
  invalidarCache,
} from './cacheService'
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
  const codigosConsulta = generarCodigosConsulta(codigoLimpio)

  const consultaPorCodigoInvitado = await supabase
    .from('pedidos')
    .select('*')
    .in('codigo_consulta', codigosConsulta)
    .eq('cedula_solicitante', cedulaLimpia)
    .limit(1)
    .maybeSingle<Pedido>()

  if (consultaPorCodigoInvitado.error || consultaPorCodigoInvitado.data) {
    return consultaPorCodigoInvitado
  }

  return supabase
    .from('pedidos')
    .select('*')
    .in('codigo', codigosConsulta)
    .eq('cedula_solicitante', cedulaLimpia)
    .limit(1)
    .maybeSingle<Pedido>()
}

export async function crearReporteFranquiciado(reporte: ReporteFranquiciadoInput) {
  const result = await supabase
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

  if (!result.error) invalidarDatosReportesFranquiciado()
  return result
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

  if (['entregado', 'cancelado', 'rechazado'].includes(pedido.estado)) {
    return {
      data: null,
      error: new Error('Este pedido ya tiene gestion cerrada y no permite una nueva confirmacion.'),
    }
  }

  return actualizarEstadoPedido(pedido.id, 'entregado', {
    pedido,
    responsable: 'Franquiciado',
  })
}

export async function obtenerReportesFranquiciado() {
  return consultarConCache('reportes:franquiciado', 10_000, () =>
    supabase
      .from('reportes_franquiciado')
      .select('*')
      .order('created_at', { ascending: false })
      .returns<ReporteFranquiciado[]>()
  )
}

export function escucharReportesFranquiciado(onChange: () => void) {
  const notificar = crearNotificadorCambios(onChange, ['reportes', 'pedidos', 'alertas'])
  const channel = supabase
    .channel('reportes-franquiciado-tiempo-real')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'reportes_franquiciado',
      },
      notificar
    )
    .subscribe()

  return () => {
    notificar.cancelar()
    supabase.removeChannel(channel)
  }
}

export function normalizarCedula(valor: string) {
  return valor.replace(/\D/g, '').trim()
}

function generarCodigosConsulta(codigo: string) {
  const candidatos = new Set<string>()
  const compacto = codigo.trim().replace(/\s+/g, '')
  const mayusculas = compacto.toUpperCase()

  ;[compacto, mayusculas].forEach((valor) => {
    if (valor) candidatos.add(valor)
  })

  if (mayusculas.startsWith('BFQ-')) {
    candidatos.add(mayusculas.replace(/^BFQ-/, ''))
  } else if (mayusculas) {
    candidatos.add(`BFQ-${mayusculas}`)
  }

  return [...candidatos]
}

function invalidarDatosReportesFranquiciado() {
  invalidarCache('reportes', 'pedidos', 'alertas')
}
