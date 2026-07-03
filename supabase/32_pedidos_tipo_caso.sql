-- Migracion 32: tipo de caso operativo del pedido
-- Reemplaza el campo "impacto del solicitante" del formulario de crear pedido por
-- "Tipo de caso" (falta de stock, diferencia de inventario, stock negativo,
-- error de carga, espacio camion, permiso ambiental).
alter table public.pedidos add column if not exists tipo_caso text;
comment on column public.pedidos.tipo_caso is
  'Tipo de caso operativo: falta_stock, diferencia_inventario, stock_negativo, error_carga, espacio_camion, permiso_ambiental.';
