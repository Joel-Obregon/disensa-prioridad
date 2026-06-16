import { supabase } from './supabaseClient'
import {
  consultarConCache,
  crearNotificadorCambios,
  invalidarCache,
} from './cacheService'
import type {
  EstadoReporteOperativo,
  PrioridadReporteOperativo,
  ReporteOperativo,
  TipoReporteOperativo,
} from '../types/reporteOperativo'
import type { RolUsuario } from '../types/usuario'

export type ReporteOperativoInput = {
  titulo: string
  tipo: TipoReporteOperativo
  descripcion: string
  prioridad: PrioridadReporteOperativo
  rol_origen: RolUsuario
  creado_por: string
  pedido_codigo?: string | null
  material_id?: string | null
}

export async function obtenerReportesOperativos() {
  return consultarConCache('reportes:operativos', 10_000, () =>
    supabase
      .from('reportes_operativos')
      .select('*')
      .order('created_at', { ascending: false })
      .returns<ReporteOperativo[]>()
  )
}

export async function crearReporteOperativo(reporte: ReporteOperativoInput) {
  const result = await supabase
    .from('reportes_operativos')
    .insert({
      ...reporte,
      titulo: reporte.titulo.trim(),
      descripcion: reporte.descripcion.trim(),
      pedido_codigo: reporte.pedido_codigo?.trim() || null,
      material_id: reporte.material_id || null,
      estado: 'abierto',
    })
    .select()
    .single<ReporteOperativo>()

  if (!result.error) invalidarDatosReportes()
  return result
}

export async function actualizarEstadoReporteOperativo(
  id: string,
  estado: EstadoReporteOperativo
) {
  const result = await supabase
    .from('reportes_operativos')
    .update({
      estado,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (!result.error) invalidarDatosReportes()
  return result
}

export function escucharReportesOperativos(onChange: () => void) {
  const notificar = crearNotificadorCambios(onChange, ['reportes', 'pedidos', 'alertas'])
  const channel = supabase
    .channel('reportes-operativos-tiempo-real')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'reportes_operativos',
      },
      notificar
    )
    .subscribe()

  return () => {
    notificar.cancelar()
    supabase.removeChannel(channel)
  }
}

function invalidarDatosReportes() {
  invalidarCache('reportes', 'pedidos', 'alertas')
}
