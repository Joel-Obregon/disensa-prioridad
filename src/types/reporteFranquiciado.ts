export type MotivoReporteFranquiciado = 'retraso' | 'material_defectuoso' | 'nota_credito' | 'otro'

export type EstadoReporteFranquiciado = 'recibido' | 'en_revision' | 'cerrado'

export type ReporteFranquiciado = {
  id: string
  pedido_id?: string | null
  codigo_consulta: string
  cedula_solicitante: string
  solicitante?: string | null
  motivo: MotivoReporteFranquiciado
  descripcion: string
  estado: EstadoReporteFranquiciado
  created_at?: string
}
