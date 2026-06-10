import { supabase } from './supabaseClient'
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
  return supabase
    .from('reportes_operativos')
    .select('*')
    .order('created_at', { ascending: false })
    .returns<ReporteOperativo[]>()
}

export async function crearReporteOperativo(reporte: ReporteOperativoInput) {
  return supabase
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
}

export async function actualizarEstadoReporteOperativo(
  id: string,
  estado: EstadoReporteOperativo
) {
  return supabase
    .from('reportes_operativos')
    .update({
      estado,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
}

export function escucharReportesOperativos(onChange: () => void) {
  const channel = supabase
    .channel('reportes-operativos-tiempo-real')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'reportes_operativos',
      },
      onChange
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
