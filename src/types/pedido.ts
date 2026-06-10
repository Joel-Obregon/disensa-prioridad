export type UrgenciaPedido = 'baja' | 'media' | 'alta' | 'critica'
export type AccionSolicitante = 'despachar' | 'nota_credito' | 'esperar_pedido'
export type CondicionMaterial =
  | 'normal'
  | 'no_planificable'
  | 'restrictivo'
  | 'urgente_despacho'
  | 'caducidad'

export type EstadoPedido =
  | 'pendiente'
  | 'en_revision'
  | 'aprobado'
  | 'en_despacho'
  | 'retrasado'
  | 'sin_stock'
  | 'entregado'
  | 'cancelado'
  | 'rechazado'

export type Pedido = {
  id: string
  codigo: string
  codigo_consulta?: string | null
  descripcion?: string | null
  material_id?: string | null
  origen: 'suministrador' | 'bodega'
  destino: 'bodega' | 'franquiciado'
  solicitante: string
  cedula_solicitante?: string | null
  material: string
  cantidad: number
  unidad_medida: string
  stock_disponible: number
  fecha_solicitud: string
  fecha_compromiso: string
  urgencia: UrgenciaPedido
  estado: EstadoPedido
  tipo_cliente: 'bodega' | 'franquiciado' | 'obra_critica'
  accion_solicitante?: AccionSolicitante | null
  condicion_material?: CondicionMaterial | null
  cantidad_despacho?: number | null
  cantidad_despachada?: number | null
  despachado_at?: string | null
  despachado_por?: string | null
  fecha_entrega?: string | null
  valor_pendiente?: number | null
  status_erp?: string | null
  nc_pendientes?: number | null
  tiene_gestion_stock?: boolean | null
  prioridad_calculada?: number
  created_at?: string
}
