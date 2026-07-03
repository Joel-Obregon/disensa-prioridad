-- ============================================================================
-- 28_limpieza_datos_y_comentarios.sql
-- Elimina datos/columnas que el prototipo no usa y documenta todas las tablas
-- para que el schema visualizer sea entendible.
-- ----------------------------------------------------------------------------
-- 1) pedidos: quita 5 columnas LEGACY (write-only) que la app no lee y que
--    duplican campos vigentes:
--      tipo_pedido     (fijo)         -> redundante
--      fecha_pedido    -> usar fecha_solicitud
--      fecha_requerida -> usar fecha_compromiso
--      prioridad(text) -> usar prioridad_calculada / urgencia
--      observaciones   -> no se muestra
--    Para poder borrarlas se reescribe refrescar_prototipo_bodega_fq SIN ellas.
-- 2) reglas_negocio: quita columnas muertas sin dependencias (tipo_parametro,
--    valor_minimo, valor_maximo).
-- 3) COMMENT en las 18 tablas y en columnas legacy/clave.
-- ============================================================================

-- 1) Reescritura de la funcion de refresco SIN las columnas legacy de pedidos
create or replace function public.refrescar_prototipo_bodega_fq()
returns jsonb
language plpgsql
security definer
set statement_timeout to '180s'
set search_path to 'public'
as $function$
declare
  v_materiales integer := 0;
  v_pedidos integer := 0;
  v_alertas integer := 0;
  v_insertadas integer := 0;
begin
  insert into public.materiales (
    codigo_material, nombre, categoria, stock_actual, stock_minimo,
    unidad_medida, es_critico, estado
  )
  select
    codigo_material,
    coalesce(nombre_material, 'Material sin descripcion'),
    case
      when estado_cobertura = 'faltante' then 'Faltante bodega-franquiciado'
      when estado_cobertura = 'cubierto_con_transito' then 'Cubierto con transito'
      when demanda_bodega_fq > 0 then 'Demanda bodega-franquiciado'
      else 'Catalogo operativo'
    end,
    least(2147483647, greatest(0, ceil(stock_disponible)))::integer,
    least(2147483647, greatest(0, ceil(demanda_bodega_fq)))::integer,
    coalesce(unidad_medida, 'UN'),
    estado_cobertura = 'faltante',
    'activo'
  from public.materiales_operativos_v
  on conflict (codigo_material) do update
  set
    nombre = excluded.nombre,
    categoria = excluded.categoria,
    stock_actual = excluded.stock_actual,
    stock_minimo = excluded.stock_minimo,
    unidad_medida = excluded.unidad_medida,
    es_critico = excluded.es_critico,
    estado = excluded.estado;

  get diagnostics v_materiales = row_count;

  insert into public.pedidos (
    codigo, codigo_consulta, descripcion, fecha_entrega, material_id,
    origen, destino, solicitante, cedula_solicitante, material, cantidad,
    unidad_medida, stock_disponible, fecha_solicitud, fecha_compromiso,
    urgencia, estado, tipo_cliente, accion_solicitante, condicion_material,
    cantidad_despacho, cantidad_despachada, valor_pendiente, status_erp,
    nc_pendientes, tiene_gestion_stock, prioridad_calculada
  )
  select
    'BFQ-' || p.pedido_key,
    p.cod_pedido,
    'Pedido bodega-franquiciado ' || p.cod_pedido || ' - ' || coalesce(p.cliente, p.nombre_cliente, 'Cliente sin registrar'),
    coalesce(p.fecha_entrega, p.fecha_limite, p.fecha_reportado, p.fecha_solicitud, current_date),
    mat.id,
    'bodega',
    'franquiciado',
    coalesce(p.cliente, p.nombre_cliente, 'Cliente sin registrar'),
    p.codigo_cliente,
    coalesce(p.nombre_material, p.descripcion_material, 'Material sin descripcion'),
    least(2147483647, greatest(1, ceil(coalesce(p.cantidad, 1))))::integer,
    coalesce(p.unidad, 'UN'),
    least(2147483647, greatest(0, ceil(coalesce(p.stock_disponible_real, 0))))::integer,
    coalesce(p.fecha_solicitud::timestamptz, p.fecha_reportado::timestamptz, now()),
    coalesce(p.fecha_limite::timestamptz, p.fecha_reportado::timestamptz, p.fecha_solicitud::timestamptz, now()),
    case
      when p.prioridad_operativa >= 80 then 'critica'
      when p.prioridad_operativa >= 50 then 'alta'
      when p.prioridad_operativa >= 20 then 'media'
      else 'baja'
    end,
    p.estado_prototipo,
    'franquiciado',
    case
      when coalesce(p.resolucion, '') ilike '%nc%' then 'nota_credito'
      when p.faltante_total > 0
        and (coalesce(p.stock_transito_real, 0) > 0 or coalesce(p.cantidad_oc_pendiente, 0) > 0)
        then 'esperar_pedido'
      else 'despachar'
    end,
    case
      when p.estado_planificable_operativo = 'no planificable' then 'no_planificable'
      when p.estado_planificable_operativo = 'agotar stock' then 'restrictivo'
      else 'normal'
    end,
    least(2147483647, greatest(0, ceil(coalesce(p.cantidad, 0))))::integer,
    0,
    0,
    coalesce(p.estado, p.resolucion, 'Bodega-FQ'),
    case when coalesce(p.resolucion, '') ilike '%nc%' then 1 else 0 end,
    p.faltante_total > 0,
    p.prioridad_operativa
  from public.pedidos_bodega_fq_priorizados_v p
  left join public.materiales mat on mat.codigo_material = p.codigo_material
  on conflict (codigo) do update
  set
    codigo_consulta = excluded.codigo_consulta,
    descripcion = excluded.descripcion,
    fecha_entrega = excluded.fecha_entrega,
    material_id = excluded.material_id,
    origen = excluded.origen,
    destino = excluded.destino,
    solicitante = excluded.solicitante,
    cedula_solicitante = excluded.cedula_solicitante,
    material = excluded.material,
    cantidad = excluded.cantidad,
    unidad_medida = excluded.unidad_medida,
    stock_disponible = excluded.stock_disponible,
    fecha_solicitud = excluded.fecha_solicitud,
    fecha_compromiso = excluded.fecha_compromiso,
    urgencia = excluded.urgencia,
    estado = excluded.estado,
    tipo_cliente = excluded.tipo_cliente,
    accion_solicitante = excluded.accion_solicitante,
    condicion_material = excluded.condicion_material,
    cantidad_despacho = excluded.cantidad_despacho,
    valor_pendiente = excluded.valor_pendiente,
    status_erp = excluded.status_erp,
    nc_pendientes = excluded.nc_pendientes,
    tiene_gestion_stock = excluded.tiene_gestion_stock,
    prioridad_calculada = excluded.prioridad_calculada;

  get diagnostics v_pedidos = row_count;

  delete from public.alertas
  where tipo_alerta in ('priorizacion_bodega_fq','faltante_bodega_fq','transito_cubre_pedido','nota_credito_bodega_fq');

  insert into public.alertas (pedido_id, material_id, tipo_alerta, nivel, mensaje, estado, responsable)
  select p.id, p.material_id, 'priorizacion_bodega_fq',
    case when p.prioridad_calculada >= 80 then 'critica' else 'alta' end,
    'Pedido ' || p.codigo_consulta || ' requiere atencion: ' || p.material || '. Prioridad ' || p.prioridad_calculada::text || '.',
    'activa', 'Bodega'
  from public.pedidos p
  where p.codigo like 'BFQ-%' and p.estado not in ('entregado','cancelado','rechazado')
    and (p.fecha_compromiso < now() or (p.stock_disponible <= 0 and p.condicion_material = 'normal'));
  get diagnostics v_insertadas = row_count; v_alertas := v_alertas + v_insertadas;

  insert into public.alertas (material_id, tipo_alerta, nivel, mensaje, estado, responsable)
  select mat.id, 'faltante_bodega_fq', 'critica',
    'Material ' || mat.nombre || ' con faltante operativo bodega-franquiciado.', 'activa', 'Bodega'
  from public.materiales_operativos_v mov
  join public.materiales mat on mat.codigo_material = mov.codigo_material
  where mov.estado_cobertura = 'faltante';
  get diagnostics v_insertadas = row_count; v_alertas := v_alertas + v_insertadas;

  insert into public.alertas (pedido_id, material_id, tipo_alerta, nivel, mensaje, estado, responsable)
  select p.id, p.material_id, 'transito_cubre_pedido', 'media',
    'Pedido ' || p.codigo_consulta || ' no se cubre con stock actual, pero tiene transito suficiente para el material ' || p.material || '.',
    'activa', 'Compras'
  from public.pedidos p
  join public.pedidos_bodega_fq_priorizados_v pv on p.codigo = 'BFQ-' || pv.pedido_key
  where p.estado not in ('entregado','cancelado','rechazado')
    and coalesce(pv.stock_disponible_real, 0) < coalesce(pv.cantidad, 0)
    and coalesce(pv.stock_transito_real, 0) > 0
    and coalesce(pv.faltante_total, 0) = 0;
  get diagnostics v_insertadas = row_count; v_alertas := v_alertas + v_insertadas;

  insert into public.alertas (pedido_id, material_id, tipo_alerta, nivel, mensaje, estado, responsable)
  select p.id, p.material_id, 'nota_credito_bodega_fq', 'alta',
    'Pedido ' || p.codigo_consulta || ' tiene resolucion de nota de credito o revision asociada.', 'activa', 'Operacion'
  from public.pedidos p
  where p.codigo like 'BFQ-%' and p.accion_solicitante = 'nota_credito';
  get diagnostics v_insertadas = row_count; v_alertas := v_alertas + v_insertadas;

  insert into public.sync_runs (fecha_hora, estado, pedidos_actualizados, detalle_actualizado, usuario, error)
  values (now(), 'sincronizacion_bases_operativas_3_0', v_pedidos, v_materiales, 'Sistema', null)
  on conflict (fecha_hora, estado) do nothing;

  return jsonb_build_object('ok', true, 'materiales_afectados', v_materiales, 'pedidos_afectados', v_pedidos, 'alertas_generadas', v_alertas);
end;
$function$;

-- 2) Quitar columnas legacy de pedidos (ya no las escribe ninguna funcion)
alter table public.pedidos
  drop column if exists tipo_pedido,
  drop column if exists fecha_pedido,
  drop column if exists fecha_requerida,
  drop column if exists prioridad,
  drop column if exists observaciones;

-- 3) Quitar columnas muertas de reglas_negocio (sin dependencias)
alter table public.reglas_negocio
  drop column if exists tipo_parametro,
  drop column if exists valor_minimo,
  drop column if exists valor_maximo;

-- 4) Documentacion de tablas para el schema visualizer
comment on table public.usuarios_app is 'Usuarios internos del sistema y su rol/estado (autenticacion).';
comment on table public.pedidos is 'Pedidos operativos del prototipo: datos, fechas, estado, stock y prioridad calculada por el motor de reglas.';
comment on table public.materiales is 'Catalogo operativo de materiales (subconjunto en uso) con stock actual y minimo. Se enlaza a material_catalogo.';
comment on table public.material_catalogo is 'Catalogo maestro de materiales (catman, suministrador, planificacion, multiplos de compra/venta).';
comment on table public.alertas is 'Alertas visuales generadas por el motor (stock, pedido, reporte, reglas). Cada alerta se liga a la regla que la origino.';
comment on table public.reglas_negocio is 'Catalogo PARAMETRIZABLE de reglas de negocio (peso, condicion en JSON, nivel, estado). El motor lee de aqui.';
comment on table public.reportes_franquiciado is 'Reportes/novedades que registra el franquiciado sobre un pedido (consulta invitada).';
comment on table public.reportes_operativos is 'Reportes internos de la operacion.';
comment on table public.movimientos_inventario is 'Historial de movimientos de stock por material.';
comment on table public.auditoria is 'Bitacora de acciones clave (entidad, accion, usuario responsable).';
comment on table public.notificaciones_correo is 'Cola de notificaciones por departamento derivadas de alertas.';
comment on table public.inventario_bodega is 'Stock por centro y material (fuente operativa de inventario).';
comment on table public.pedidos_bodega_fq is 'Fuente operativa bodega-franquiciado (zona, SLA, OC). Origen de los pedidos del prototipo.';
comment on table public.oc_pendientes_bodega is 'Ordenes de compra pendientes por entregar (fuente).';
comment on table public.transito_bodega is 'Material en transito hacia bodega (fuente).';
comment on table public.centros_bodega is 'Centros / bodegas.';
comment on table public.clientes_franquiciado is 'Franquiciados y su zona.';
comment on table public.proveedores_operativos is 'Proveedores.';
comment on table public.sync_runs is 'Bitacora de sincronizaciones de datos desde las fuentes.';

comment on column public.pedidos.prioridad_calculada is 'Puntaje 0-100 calculado por el motor de reglas (campo vigente de prioridad).';
comment on column public.alertas.regla_id is 'Regla de negocio que origino la alerta (se resuelve por trigger desde el tipo de alerta).';
comment on column public.materiales.codigo_material is 'Codigo del material; FK a material_catalogo.';

notify pgrst, 'reload schema';
