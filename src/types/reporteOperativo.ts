import type { RolUsuario } from './usuario'

export type TipoReporteOperativo =
  | 'operativo'
  | 'inventario'
  | 'pedido'
  | 'incidente'
  | 'suministro'

export type PrioridadReporteOperativo = 'baja' | 'media' | 'alta' | 'critica'

export type EstadoReporteOperativo = 'abierto' | 'en_revision' | 'resuelto'

export type ReporteOperativo = {
  id: string
  titulo: string
  tipo: TipoReporteOperativo
  descripcion: string
  prioridad: PrioridadReporteOperativo
  estado: EstadoReporteOperativo
  rol_origen: RolUsuario
  creado_por: string
  pedido_codigo?: string | null
  material_id?: string | null
  created_at?: string
  updated_at?: string
}
