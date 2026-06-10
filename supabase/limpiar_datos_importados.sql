-- Limpieza de datos importados y operativos del prototipo Disensa 2.0.
-- Objetivo: dejar la estructura de Supabase lista para cargar una nueva base de datos.
--
-- Este script conserva:
--   - public.usuarios_app
--   - public.reglas_negocio
--   - tablas, vistas, funciones, triggers, grants y RLS
--
-- Este script elimina:
--   - datos importados desde Excel
--   - datos normalizados ERP
--   - datos sincronizados al prototipo anterior
--   - materiales, pedidos, alertas, movimientos, reportes, auditoria y errores
--
-- Ejecutar en Supabase SQL Editor.

begin;

truncate table
  public.nota_credito_lineas,
  public.notas_credito,
  public.solicitudes_gestion,
  public.gestiones_pedido,
  public.pedido_lineas,
  public.pedidos_erp,
  public.material_catalogo,
  public.solicitantes,
  public.proveedores,
  public.sync_runs,
  public.seguimiento_proveedor_fuente,
  public.consolidado_nc_fuente,
  public.import_errores_2_0,
  public.alertas,
  public.movimientos_inventario,
  public.reportes_operativos,
  public.reportes_franquiciado,
  public.auditoria,
  public.pedidos,
  public.materiales
restart identity cascade;

notify pgrst, 'reload schema';

commit;

-- Verificacion rapida: todos estos contadores deben quedar en 0.
select 'proveedores' as tabla, count(*) as registros from public.proveedores
union all select 'solicitantes', count(*) from public.solicitantes
union all select 'material_catalogo', count(*) from public.material_catalogo
union all select 'pedidos_erp', count(*) from public.pedidos_erp
union all select 'pedido_lineas', count(*) from public.pedido_lineas
union all select 'gestiones_pedido', count(*) from public.gestiones_pedido
union all select 'solicitudes_gestion', count(*) from public.solicitudes_gestion
union all select 'notas_credito', count(*) from public.notas_credito
union all select 'nota_credito_lineas', count(*) from public.nota_credito_lineas
union all select 'materiales', count(*) from public.materiales
union all select 'pedidos', count(*) from public.pedidos
union all select 'alertas', count(*) from public.alertas
union all select 'movimientos_inventario', count(*) from public.movimientos_inventario
union all select 'reportes_operativos', count(*) from public.reportes_operativos
union all select 'reportes_franquiciado', count(*) from public.reportes_franquiciado
union all select 'auditoria', count(*) from public.auditoria
union all select 'sync_runs', count(*) from public.sync_runs
union all select 'import_errores_2_0', count(*) from public.import_errores_2_0
order by tabla;

-- Verificacion de estructura conservada.
select 'usuarios_app' as tabla, count(*) as registros from public.usuarios_app
union all select 'reglas_negocio', count(*) from public.reglas_negocio
order by tabla;
