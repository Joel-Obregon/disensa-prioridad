export type Material = {
  id: string
  codigo_material?: string | null
  nombre: string
  categoria: string
  stock_actual: number
  stock_minimo: number
  unidad_medida: string
  es_critico: boolean
  estado: string
  created_at: string
}

export type InventarioOperativo = Material & {
  catman_nombre: string
  catman_categoria: string
  marca_material: string
  numero_suministradores: number
  codigo_suministrador?: string | null
  nombre_suministrador?: string | null
  stock_libre: number
  stock_solicitado_pedidos: number
  stock_disponible_operativo: number
  stock_bloqueado: number
  stock_en_curso_pedido: number
  stock_transito: number
  demanda_bodega_fq: number
  pedido_maximo_material: number
  stock_objetivo_material: number
  faltante_total: number
  estado_cobertura: string
  ocs_transito: number
  ocs_pendientes: number
  cantidad_oc_pendiente: number
  casos_bodega_fq: number
  estado_planificable: string
  min_compra: number
  mult_compra: number
  min_venta: number
  mult_venta: number
}
