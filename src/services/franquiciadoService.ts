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
  RemedioDefectuoso,
  ReporteFranquiciado,
} from '../types/reporteFranquiciado'

export type ReporteFranquiciadoInput = {
  pedido_id?: string | null
  codigo_consulta: string
  cedula_solicitante: string
  solicitante?: string | null
  motivo: MotivoReporteFranquiciado
  descripcion: string
  material_reportado?: string | null
  cantidad_pedida?: number | null
  cantidad_defectuosa?: number | null
  remedio?: RemedioDefectuoso | null
}

// El franquiciado pidio reposicion por los materiales defectuosos: se deja el
// pedido esperando reabastecimiento para que bodega lo reponga. No cierra nada.
export async function solicitarReposicionDefectuoso(pedidoId: string) {
  const result = await supabase
    .from('pedidos')
    .update({ accion_solicitante: 'esperar_pedido', updated_at: new Date().toISOString() })
    .eq('id', pedidoId)
  if (!result.error) invalidarDatosReportesFranquiciado()
  return result
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

// Devuelve TODOS los materiales (filas) de un mismo pedido para ese codigo y
// cedula. Multi-material: el franquiciado elige por cual material reclama.
export async function consultarPedidosInvitado(codigo: string, cedula: string) {
  const codigoLimpio = codigo.trim()
  const cedulaLimpia = normalizarCedula(cedula)
  const codigosConsulta = generarCodigosConsulta(codigoLimpio)

  // 1) Los materiales de un pedido comparten codigo_consulta.
  let base = await supabase
    .from('pedidos')
    .select('*')
    .in('codigo_consulta', codigosConsulta)
    .eq('cedula_solicitante', cedulaLimpia)
    .order('created_at', { ascending: true })
    .returns<Pedido[]>()

  // 2) Respaldo: por codigo exacto de alguna fila del grupo.
  if (!base.error && (base.data?.length ?? 0) === 0) {
    base = await supabase
      .from('pedidos')
      .select('*')
      .in('codigo', codigosConsulta)
      .eq('cedula_solicitante', cedulaLimpia)
      .order('created_at', { ascending: true })
      .returns<Pedido[]>()
  }

  if (base.error || (base.data?.length ?? 0) === 0) return base

  // 3) Si la fila pertenece a un grupo, trae TODOS los materiales del grupo.
  const grupoId = base.data?.find((pedido) => pedido.grupo_id)?.grupo_id
  if (grupoId) {
    const grupo = await supabase
      .from('pedidos')
      .select('*')
      .eq('grupo_id', grupoId)
      .eq('cedula_solicitante', cedulaLimpia)
      .order('created_at', { ascending: true })
      .returns<Pedido[]>()
    if (!grupo.error && (grupo.data?.length ?? 0) > 0) return grupo
  }

  return base
}

type OpcionesReporteActivo = {
  // Los reportes por retraso son informativos: alertan que el material sigue
  // pendiente, pero no reabren el pedido ni cambian su accion de despacho.
  incluirRetrasos?: boolean
}

// Indica si un pedido todavia tiene un reporte del franquiciado sin cerrar.
// Permite distinguir los reportes que requieren una gestion especial de los
// reportes por retraso, que solo generan una alerta operativa.
export async function tieneReporteActivoPedido(
  pedido: Pick<Pedido, 'id' | 'codigo' | 'codigo_consulta'>,
  { incluirRetrasos = true }: OpcionesReporteActivo = {},
): Promise<boolean> {
  const consulta = supabase
    .from('reportes_franquiciado')
    .select('id')
    .or(filtroReportesPedido(pedido))
    .neq('estado', 'cerrado')

  const consultaFiltrada = incluirRetrasos ? consulta : consulta.neq('motivo', 'retraso')
  const { data, error } = await consultaFiltrada.limit(1)

  if (error) return false
  return (data?.length ?? 0) > 0
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

  if (pedido.estado !== 'en_despacho') {
    return {
      data: null,
      error: new Error('El pedido aun no fue despachado por bodega; no puedes confirmar la recepcion todavia.'),
    }
  }

  // El franquiciado valida que recibio el material: se cierra el reporte para que
  // el pedido salga de la cola operativa y pase a historial. Se cierra primero el
  // reporte para que, al marcar el pedido como entregado, las alertas se resuelvan.
  await cerrarReportesDePedido(pedido)

  return actualizarEstadoPedido(pedido.id, 'entregado', {
    pedido,
    responsable: 'Franquiciado',
  })
}

// Marca el reporte como "en_revision": la reposicion ya se envio y el sistema
// espera la validacion del franquiciado. Evita volver a descontar stock.
export async function marcarReposicionEnviada(
  pedido: Pick<Pedido, 'id' | 'codigo' | 'codigo_consulta'>,
) {
  const result = await supabase
    .from('reportes_franquiciado')
    .update({ estado: 'en_revision' })
    .or(filtroReportesPedido(pedido))
    .eq('estado', 'recibido')
    // Un reporte por retraso no es una reposicion: debe seguir siendo solo una
    // alerta mientras bodega mantiene el flujo normal de despacho.
    .neq('motivo', 'retraso')
    .select()

  if (!result.error) invalidarDatosReportesFranquiciado()
  return result
}

// Cierra los reportes activos de un pedido (al validar la entrega el franquiciado).
export async function cerrarReportesDePedido(
  pedido: Pick<Pedido, 'id' | 'codigo' | 'codigo_consulta'>,
) {
  const result = await supabase
    .from('reportes_franquiciado')
    .update({ estado: 'cerrado' })
    .or(filtroReportesPedido(pedido))
    .neq('estado', 'cerrado')

  if (!result.error) invalidarDatosReportesFranquiciado()
  return result
}

// Filtro PostgREST que ubica los reportes de un pedido por id o por codigo.
function filtroReportesPedido(
  pedido: Pick<Pedido, 'id' | 'codigo' | 'codigo_consulta'>,
) {
  const condiciones: string[] = []
  if (pedido.id) condiciones.push(`pedido_id.eq.${pedido.id}`)
  ;[pedido.codigo, pedido.codigo_consulta]
    .map((codigo) => (codigo || '').trim())
    .filter((codigo) => codigo.length > 0)
    .forEach((codigo) => condiciones.push(`codigo_consulta.eq.${codigo}`))
  return condiciones.join(',')
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
