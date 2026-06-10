export type Alerta = {
  id: string
  pedido_id: string | null
  material_id: string | null
  tipo_alerta: string
  nivel: 'informativa' | 'media' | 'alta' | 'critica'
  mensaje: string
  estado: 'activa' | 'revisada' | 'cerrada'
  responsable?: string | null
  pedido_codigo?: string | null
  dias_sin_gestion?: number | null
  pedido_estado?: string | null
  pedido_fecha_compromiso?: string | null
  pedido_fecha_solicitud?: string | null
  pedido_stock_disponible?: number | null
  pedido_cantidad?: number | null
  pedido_cantidad_despacho?: number | null
  pedido_cantidad_despachada?: number | null
  pedido_material?: string | null
  pedido_unidad_medida?: string | null
  pedido_origen?: string | null
  pedido_destino?: string | null
  pedido_solicitante?: string | null
  pedido_cedula_solicitante?: string | null
  pedido_urgencia?: string | null
  pedido_tipo_cliente?: string | null
  pedido_accion_solicitante?: string | null
  pedido_condicion_material?: string | null
  pedido_prioridad_calculada?: number | null
  pedido_despachado_at?: string | null
  pedido_despachado_por?: string | null
  created_at: string
}
