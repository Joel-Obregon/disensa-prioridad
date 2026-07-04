export type UrgenciaPedido = 'baja' | 'media' | 'alta' | 'critica'
export type AccionSolicitante = 'despachar' | 'nota_credito' | 'esperar_pedido'
export type CondicionMaterial =
  | 'normal'
  | 'no_planificable'
  | 'restrictivo'
  | 'urgente_despacho'
  | 'caducidad'

export type TipoCasoPedido =
  | 'falta_stock'
  | 'diferencia_inventario'
  | 'stock_negativo'
  | 'error_carga'
  | 'espacio_camion'
  | 'permiso_ambiental'

export const ETIQUETAS_TIPO_CASO: Record<TipoCasoPedido, string> = {
  falta_stock: 'Falta de stock',
  diferencia_inventario: 'Diferencia de inventario',
  stock_negativo: 'Stock negativo',
  error_carga: 'Error de carga',
  espacio_camion: 'Espacio camion',
  permiso_ambiental: 'Permiso ambiental',
}

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
  grupo_id?: string | null
  codigo_material?: string | null
  estado_nc?: string | null
  motivo_nc?: string | null
  fecha_nc?: string | null
  mensaje_suministrador?: string | null
  suministrador?: string | null
  zona?: string | null
  origen: 'suministrador' | 'bodega'
  destino: 'bodega' | 'franquiciado'
  solicitante: string
  cedula_solicitante?: string | null
  material: string
  catman?: string | null
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
  tipo_caso?: TipoCasoPedido | null
  cantidad_despacho?: number | null
  cantidad_despachada?: number | null
  despachado_at?: string | null
  despachado_por?: string | null
  fecha_entrega?: string | null
  fecha_reprogramada?: string | null
  valor_pendiente?: number | null
  status_erp?: string | null
  nc_pendientes?: number | null
  tiene_gestion_stock?: boolean | null
  prioridad_calculada?: number
  created_at?: string
  updated_at?: string | null
}
