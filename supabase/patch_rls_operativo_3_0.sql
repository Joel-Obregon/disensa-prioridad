-- Parche corto para que la app pueda leer las tablas operativas 3.0.
-- Ejecutar en Supabase SQL Editor si Inventario aparece en cero o las tablas
-- inventario_bodega/pedidos_bodega_fq parecen vacias desde la app.

begin;

alter table public.centros_bodega disable row level security;
alter table public.clientes_franquiciado disable row level security;
alter table public.proveedores_operativos disable row level security;
alter table public.inventario_bodega disable row level security;
alter table public.pedidos_bodega_fq disable row level security;
alter table public.oc_pendientes_bodega disable row level security;
alter table public.transito_bodega disable row level security;
alter table public.notificaciones_correo disable row level security;

grant select, insert, update, delete on
  public.centros_bodega,
  public.clientes_franquiciado,
  public.proveedores_operativos,
  public.inventario_bodega,
  public.pedidos_bodega_fq,
  public.oc_pendientes_bodega,
  public.transito_bodega
to anon, authenticated;

grant select on
  public.materiales_operativos_v,
  public.pedidos_bodega_fq_priorizados_v,
  public.pedido_detalle_operativo_v,
  public.operacion_bodega_fq_kpis_v,
  public.otif_operativo_v
to anon, authenticated;

grant execute on function public.refrescar_prototipo_bodega_fq() to anon, authenticated;
grant execute on function public.limpiar_bases_operativas_3_0() to anon, authenticated;
grant execute on function public.despachar_pedido_seguro(uuid, uuid, text) to anon, authenticated;
grant execute on function public.despachar_pedido_operativo_seguro(uuid, uuid, text, text, numeric) to anon, authenticated;
grant execute on function public.registrar_alerta_stock_material(uuid, uuid, integer, text) to anon, authenticated;

select public.refrescar_prototipo_bodega_fq();

notify pgrst, 'reload schema';

commit;

select 'centros_bodega' as tabla, count(*) as filas from public.centros_bodega
union all
select 'inventario_bodega', count(*) from public.inventario_bodega
union all
select 'pedidos_bodega_fq', count(*) from public.pedidos_bodega_fq
union all
select 'transito_bodega', count(*) from public.transito_bodega
union all
select 'oc_pendientes_bodega', count(*) from public.oc_pendientes_bodega
union all
select 'materiales_operativos_v', count(*) from public.materiales_operativos_v;
