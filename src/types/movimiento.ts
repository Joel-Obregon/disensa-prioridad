export type TipoMovimientoInventario = 'entrada' | 'salida' | 'ajuste'

export type MovimientoInventario = {
  id: string
  material_id: string
  material_nombre: string
  tipo: TipoMovimientoInventario
  cantidad: number
  stock_anterior: number
  stock_nuevo: number
  motivo: string
  responsable: string
  created_at: string
}
