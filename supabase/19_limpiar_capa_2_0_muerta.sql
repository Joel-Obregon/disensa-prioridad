-- ============================================================================
-- 19_limpiar_capa_2_0_muerta.sql
-- Elimina la "capa 2.0 ERP": tablas vacias, vistas y funciones sin uso.
-- ----------------------------------------------------------------------------
-- POR QUE ES SEGURO (verificado en vivo el 2026-06-19 contra el proyecto):
--   * Las 11 tablas estan VACIAS (0 filas) y el frontend NO las consulta.
--   * Solo 5 vistas dependen de ellas (pedidos_erp_resumen_v, proveedor_kpis_v,
--     seguimiento_kpis_v, materiales_demanda_v, import_errores_resumen_v) y
--     NINGUNA de esas vistas la usa el frontend (el front usa
--     materiales_operativos_v, otif_operativo_v, pedido_detalle_operativo_v y
--     pedidos_bodega_fq_priorizados_v, que se apoyan en la capa 3.0).
--   * Las funciones vivas limpiar_bases_operativas_3_0 y reaplicar_motor_reglas
--     NO dependen de estas tablas (la 2da protege pedidos_erp con to_regclass),
--     por eso NO se tocan.
--
-- REVERSIBLE: para recrear esta capa, vuelve a ejecutar schema_2_0_base_nueva.sql.
--
-- RECOMENDACION: respalda antes (Supabase > Database > Backups) y corre el
-- bloque de verificacion de abajo; si todo da 0 filas, ejecuta el resto.
-- ============================================================================

-- 0) VERIFICACION PREVIA (opcional): debe devolver 0 en todas las filas.
-- select 'pedidos_erp' t, count(*) from public.pedidos_erp
-- union all select 'pedido_lineas', count(*) from public.pedido_lineas
-- union all select 'gestiones_pedido', count(*) from public.gestiones_pedido
-- union all select 'solicitudes_gestion', count(*) from public.solicitudes_gestion
-- union all select 'notas_credito', count(*) from public.notas_credito
-- union all select 'nota_credito_lineas', count(*) from public.nota_credito_lineas
-- union all select 'proveedores', count(*) from public.proveedores
-- union all select 'solicitantes', count(*) from public.solicitantes
-- union all select 'seguimiento_proveedor_fuente', count(*) from public.seguimiento_proveedor_fuente
-- union all select 'consolidado_nc_fuente', count(*) from public.consolidado_nc_fuente
-- union all select 'import_errores_2_0', count(*) from public.import_errores_2_0;

begin;

-- 1) Vistas muertas (dependen de las tablas 2.0; el front no las usa)
drop view if exists public.pedidos_erp_resumen_v   cascade;
drop view if exists public.proveedor_kpis_v        cascade;
drop view if exists public.seguimiento_kpis_v      cascade;
drop view if exists public.materiales_demanda_v    cascade;
drop view if exists public.import_errores_resumen_v cascade;

-- 2) Funciones exclusivas de la capa 2.0 (no las llama el frontend)
drop function if exists public.refrescar_prototipo_desde_erp_2_0() cascade;
drop function if exists public.preparar_pedido_erp_2_0()           cascade;

-- 3) Tablas vacias de la capa 2.0 (CASCADE limpia FKs internas y triggers touch)
drop table if exists public.nota_credito_lineas          cascade;
drop table if exists public.notas_credito                cascade;
drop table if exists public.gestiones_pedido             cascade;
drop table if exists public.solicitudes_gestion          cascade;
drop table if exists public.pedido_lineas                cascade;
drop table if exists public.pedidos_erp                  cascade;
drop table if exists public.seguimiento_proveedor_fuente cascade;
drop table if exists public.consolidado_nc_fuente        cascade;
drop table if exists public.import_errores_2_0           cascade;
drop table if exists public.solicitantes                 cascade;
drop table if exists public.proveedores                  cascade;

commit;

notify pgrst, 'reload schema';
