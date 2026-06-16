-- Integra BASE.xlsx como catalogo maestro de materiales.
-- Ejecutar antes de importar con:
-- scripts/importar_bases_operativas_3_0.py --catalogo-materiales ".../BASE.xlsx"

alter table public.material_catalogo
  add column if not exists codigo_nuestro_material text,
  add column if not exists codigo_fabricante_nuestro text,
  add column if not exists codigo_suministrador text,
  add column if not exists nombre_suministrador text,
  add column if not exists marca_material text,
  add column if not exists catman_nombre text,
  add column if not exists catman_nuestro text,
  add column if not exists catman_categoria text,
  add column if not exists unidad_medida_base text,
  add column if not exists estado_planificacion text,
  add column if not exists min_venta numeric(14, 3) default 1,
  add column if not exists mult_venta numeric(14, 3) default 1,
  add column if not exists min_compra numeric(14, 3) default 1,
  add column if not exists mult_compra numeric(14, 3) default 1,
  add column if not exists fuente_catalogo text;

update public.material_catalogo
set
  min_venta = greatest(0, coalesce(min_venta, 1)),
  mult_venta = greatest(0, coalesce(mult_venta, 1)),
  min_compra = greatest(0, coalesce(min_compra, 1)),
  mult_compra = greatest(0, coalesce(mult_compra, 1)),
  unidad_medida_base = coalesce(nullif(unidad_medida_base, ''), 'UN'),
  estado_planificacion = coalesce(nullif(estado_planificacion, ''), 'no planificable');

alter table public.material_catalogo
  alter column min_venta set default 1,
  alter column mult_venta set default 1,
  alter column min_compra set default 1,
  alter column mult_compra set default 1,
  alter column min_venta set not null,
  alter column mult_venta set not null,
  alter column min_compra set not null,
  alter column mult_compra set not null;

create index if not exists material_catalogo_suministrador_idx
on public.material_catalogo (codigo_suministrador);

create index if not exists material_catalogo_catman_idx
on public.material_catalogo (catman_categoria, catman_nombre);

create index if not exists material_catalogo_estado_planificacion_idx
on public.material_catalogo (estado_planificacion);

drop view if exists public.operacion_bodega_fq_kpis_v cascade;
drop view if exists public.pedido_detalle_operativo_v cascade;
drop view if exists public.materiales_operativos_v cascade;

create or replace view public.materiales_operativos_v as
with base_materiales as (
  select codigo_material from public.material_catalogo
  union
  select codigo_material from public.inventario_bodega
  union
  select codigo_material from public.pedidos_bodega_fq
  union
  select codigo_material from public.transito_bodega
  union
  select codigo_material from public.oc_pendientes_bodega
),
inv as (
  select
    codigo_material,
    max(unidad_medida) as unidad_medida,
    (array_agg(fabricante order by updated_at desc)
      filter (where nullif(fabricante, '') is not null))[1] as marca_material,
    (array_agg(tipo_material order by updated_at desc)
      filter (where nullif(tipo_material, '') is not null))[1] as catman_nombre,
    sum(greatest(0, stock_libre_utilizacion)) as stock_libre,
    sum(greatest(0, stock_disponible)) as stock_disponible,
    sum(greatest(0, bloqueado)) as bloqueado,
    sum(greatest(0, comprometido_ped_vta)) as comprometido_ped_vta,
    sum(greatest(0, stock_en_curso_pedido)) as stock_en_curso_pedido
  from public.inventario_bodega
  group by codigo_material
),
catman_pedidos as (
  select
    codigo_material,
    (array_agg(linea_producto order by updated_at desc)
      filter (where nullif(linea_producto, '') is not null))[1] as catman_categoria
  from public.pedidos_bodega_fq
  group by codigo_material
),
proveedores_material as (
  select
    codigo_material,
    count(distinct codigo_proveedor) filter (where nullif(codigo_proveedor, '') is not null)::integer as numero_suministradores,
    (array_agg(codigo_proveedor order by prioridad, fecha_documento desc nulls last)
      filter (where nullif(codigo_proveedor, '') is not null))[1] as codigo_suministrador,
    (array_agg(nombre_proveedor order by prioridad, fecha_documento desc nulls last)
      filter (where nullif(nombre_proveedor, '') is not null))[1] as nombre_suministrador
  from (
    select codigo_material, codigo_proveedor, nombre_proveedor, fecha_documento, 1 as prioridad
    from public.oc_pendientes_bodega
    union all
    select codigo_material, codigo_proveedor, nombre_proveedor, fecha_documento, 2 as prioridad
    from public.transito_bodega
  ) fuente
  group by codigo_material
),
tran as (
  select
    codigo_material,
    sum(cantidad_por_entregar) as stock_transito,
    count(distinct documento_compras)::integer as ocs_transito,
    sum(valor_neto) as valor_transito
  from public.transito_bodega
  where coalesce(cantidad_por_entregar, 0) > 0
  group by codigo_material
),
oc as (
  select
    codigo_material,
    sum(cantidad_por_entregar) as cantidad_oc_pendiente,
    count(distinct documento_compras)::integer as ocs_pendientes,
    sum(valor_neto) as valor_oc_pendiente
  from public.oc_pendientes_bodega
  where coalesce(cantidad_por_entregar, 0) > 0
  group by codigo_material
),
demanda as (
  select
    codigo_material,
    sum(cantidad) as demanda_bodega_fq,
    max(cantidad) as pedido_maximo_material,
    count(*)::integer as casos_bodega_fq,
    count(distinct cod_pedido)::integer as pedidos_bodega_fq
  from public.pedidos_bodega_fq
  group by codigo_material
)
select
  m.codigo_material,
  m.nombre_material,
  coalesce(nullif(m.unidad_medida_base, ''), inv.unidad_medida, 'UN') as unidad_medida,
  coalesce(nullif(m.marca_material, ''), inv.marca_material, 'Sin marca registrada') as marca_material,
  coalesce(nullif(m.catman_nombre, ''), nullif(m.catman_nuestro, ''), inv.catman_nombre, 'Sin catman registrado') as catman_nombre,
  coalesce(nullif(m.catman_categoria, ''), catman.catman_categoria, 'Sin categoria catman') as catman_categoria,
  greatest(
    coalesce(prov.numero_suministradores, 0),
    case when nullif(m.codigo_suministrador, '') is null then 0 else 1 end
  ) as numero_suministradores,
  coalesce(prov.codigo_suministrador, nullif(m.codigo_suministrador, '')) as codigo_suministrador,
  coalesce(prov.nombre_suministrador, nullif(m.nombre_suministrador, '')) as nombre_suministrador,
  coalesce(inv.stock_libre, 0) as stock_libre,
  coalesce(inv.stock_disponible, 0) as stock_disponible,
  coalesce(inv.bloqueado, 0) as bloqueado,
  coalesce(inv.comprometido_ped_vta, 0) as comprometido_ped_vta,
  coalesce(inv.stock_en_curso_pedido, 0) as stock_en_curso_pedido,
  coalesce(tran.stock_transito, 0) as stock_transito,
  coalesce(tran.ocs_transito, 0) as ocs_transito,
  coalesce(tran.valor_transito, 0) as valor_transito,
  coalesce(oc.cantidad_oc_pendiente, 0) as cantidad_oc_pendiente,
  coalesce(oc.ocs_pendientes, 0) as ocs_pendientes,
  coalesce(oc.valor_oc_pendiente, 0) as valor_oc_pendiente,
  coalesce(demanda.demanda_bodega_fq, 0) as demanda_bodega_fq,
  coalesce(demanda.pedido_maximo_material, 0) as pedido_maximo_material,
  coalesce(demanda.pedido_maximo_material, 0) * 2 as stock_alerta_material,
  coalesce(demanda.pedido_maximo_material, 0) * 3 as stock_objetivo_material,
  coalesce(demanda.casos_bodega_fq, 0) as casos_bodega_fq,
  coalesce(demanda.pedidos_bodega_fq, 0) as pedidos_bodega_fq,
  greatest(0, coalesce(m.min_compra, 1)) as min_compra,
  greatest(0, coalesce(m.mult_compra, 1)) as mult_compra,
  greatest(0, coalesce(m.min_venta, 1)) as min_venta,
  greatest(0, coalesce(m.mult_venta, 1)) as mult_venta,
  case
    when nullif(m.estado_planificacion, '') is not null
      then public.estado_planificable_bodega_fq(m.estado_planificacion)
    when bool_or(public.estado_planificable_bodega_fq(pbf.excluidos) = 'agotar stock')
      then 'agotar stock'
    when bool_or(public.estado_planificable_bodega_fq(pbf.excluidos) = 'planificable')
      then 'planificable'
    else 'no planificable'
  end as estado_planificable,
  greatest(
    0,
    coalesce(demanda.demanda_bodega_fq, 0)
      - greatest(0, coalesce(inv.stock_disponible, 0))
      - greatest(0, coalesce(inv.stock_en_curso_pedido, 0))
      - greatest(
        0,
        case
          when coalesce(oc.cantidad_oc_pendiente, 0) > 0 then coalesce(oc.cantidad_oc_pendiente, 0)
          else coalesce(tran.stock_transito, 0)
        end
      )
  ) as faltante_total,
  case
    when greatest(0, coalesce(inv.stock_disponible, 0)) >= coalesce(demanda.demanda_bodega_fq, 0)
      then 'cubierto'
    when greatest(0, coalesce(inv.stock_disponible, 0))
      + greatest(0, coalesce(inv.stock_en_curso_pedido, 0))
      + greatest(
        0,
        case
          when coalesce(oc.cantidad_oc_pendiente, 0) > 0 then coalesce(oc.cantidad_oc_pendiente, 0)
          else coalesce(tran.stock_transito, 0)
        end
      )
      >= coalesce(demanda.demanda_bodega_fq, 0)
      then 'cubierto_con_transito'
    when coalesce(demanda.demanda_bodega_fq, 0) > 0
      then 'faltante'
    else 'sin_demanda'
  end as estado_cobertura
from base_materiales bm
join public.material_catalogo m on m.codigo_material = bm.codigo_material
left join inv on inv.codigo_material = m.codigo_material
left join catman_pedidos catman on catman.codigo_material = m.codigo_material
left join proveedores_material prov on prov.codigo_material = m.codigo_material
left join tran on tran.codigo_material = m.codigo_material
left join oc on oc.codigo_material = m.codigo_material
left join demanda on demanda.codigo_material = m.codigo_material
left join public.pedidos_bodega_fq pbf on pbf.codigo_material = m.codigo_material
where
  (
    m.fuente_catalogo = 'BASE.xlsx'
    and (
      nullif(btrim(coalesce(m.catman_categoria, '')), '') is not null
      or nullif(btrim(coalesce(m.catman_nombre, '')), '') is not null
      or nullif(btrim(coalesce(m.catman_nuestro, '')), '') is not null
    )
  )
  or exists (
    select 1
    from public.inventario_bodega inv_manual
    where inv_manual.codigo_material = m.codigo_material
      and inv_manual.fuente = 'registro_manual_web'
  )
group by
  m.codigo_material,
  m.nombre_material,
  m.unidad_medida_base,
  m.marca_material,
  m.catman_nombre,
  m.catman_nuestro,
  m.catman_categoria,
  m.codigo_suministrador,
  m.nombre_suministrador,
  m.min_compra,
  m.mult_compra,
  m.min_venta,
  m.mult_venta,
  m.estado_planificacion,
  inv.unidad_medida,
  inv.marca_material,
  inv.catman_nombre,
  catman.catman_categoria,
  prov.numero_suministradores,
  prov.codigo_suministrador,
  prov.nombre_suministrador,
  inv.stock_libre,
  inv.stock_disponible,
  inv.bloqueado,
  inv.comprometido_ped_vta,
  inv.stock_en_curso_pedido,
  tran.stock_transito,
  tran.ocs_transito,
  tran.valor_transito,
  oc.cantidad_oc_pendiente,
  oc.ocs_pendientes,
  oc.valor_oc_pendiente,
  demanda.demanda_bodega_fq,
  demanda.pedido_maximo_material,
  demanda.casos_bodega_fq,
  demanda.pedidos_bodega_fq;

create or replace view public.pedido_detalle_operativo_v as
with proveedores_material as (
  select
    codigo_material,
    (array_agg(codigo_proveedor order by prioridad, fecha_documento desc nulls last)
      filter (where nullif(codigo_proveedor, '') is not null))[1] as codigo_proveedor,
    (array_agg(nombre_proveedor order by prioridad, fecha_documento desc nulls last)
      filter (where nullif(nombre_proveedor, '') is not null))[1] as nombre_proveedor
  from (
    select codigo_material, codigo_proveedor, nombre_proveedor, fecha_documento, 1 as prioridad
    from public.oc_pendientes_bodega
    union all
    select codigo_material, codigo_proveedor, nombre_proveedor, fecha_documento, 2 as prioridad
    from public.transito_bodega
  ) fuente
  group by codigo_material
),
transito_activo as (
  select codigo_material, sum(cantidad_por_entregar) as stock_transito
  from public.transito_bodega
  where coalesce(cantidad_por_entregar, 0) > 0
  group by codigo_material
),
oc_activa as (
  select codigo_material, sum(cantidad_por_entregar) as cantidad_oc_pendiente
  from public.oc_pendientes_bodega
  where coalesce(cantidad_por_entregar, 0) > 0
  group by codigo_material
),
reabastecimiento_evento as (
  select codigo_material, documento_compras, fecha_documento, 1 as prioridad
  from public.oc_pendientes_bodega
  where coalesce(cantidad_por_entregar, 0) > 0
  union all
  select codigo_material, documento_compras, fecha_documento, 2 as prioridad
  from public.transito_bodega
  where coalesce(cantidad_por_entregar, 0) > 0
),
reabastecimiento_reciente as (
  select
    codigo_material,
    (array_agg(documento_compras order by fecha_documento desc nulls last, prioridad)
      filter (where nullif(documento_compras, '') is not null))[1] as orden_compra_reabastecimiento,
    (array_agg(fecha_documento order by fecha_documento desc nulls last, prioridad)
      filter (where fecha_documento is not null))[1] as fecha_reabastecimiento
  from reabastecimiento_evento
  group by codigo_material
),
reabastecimiento_material as (
  select
    coalesce(oc.codigo_material, tran.codigo_material) as codigo_material,
    case
      when coalesce(oc.cantidad_oc_pendiente, 0) > 0 then coalesce(oc.cantidad_oc_pendiente, 0)
      else coalesce(tran.stock_transito, 0)
    end as reabastecimiento_pendiente,
    reciente.fecha_reabastecimiento,
    reciente.orden_compra_reabastecimiento
  from oc_activa oc
  full join transito_activo tran on tran.codigo_material = oc.codigo_material
  left join reabastecimiento_reciente reciente
    on reciente.codigo_material = coalesce(oc.codigo_material, tran.codigo_material)
)
select
  'BFQ-' || p.pedido_key as codigo_pedido,
  p.pedido_key,
  p.cod_pedido as codigo_consulta,
  'venta_bodega_franquiciado'::text as flujo_operativo,
  p.tipo_caso,
  p.responsable as responsable_operativo,
  coalesce(nullif(p.resolucion, ''), p.estado, 'Sin resolucion') as resolucion,
  p.estado as estado_fuente,
  p.codigo_cliente,
  coalesce(p.cliente, p.nombre_cliente, 'Cliente sin registrar') as cliente,
  coalesce(
    nullif(
      array_to_string(
        array(
          select distinct zona_valor
          from unnest(array[p.zona_cliente, p.zona, p.zona_cliente_detalle]) as zonas(zona_valor)
          where nullif(btrim(zona_valor), '') is not null
        ),
        ', '
      ),
      ''
    ),
    'Sin zona registrada'
  ) as zonas,
  p.codigo_material,
  coalesce(p.nombre_material, mc.nombre_material, p.descripcion_material, 'Material sin descripcion') as nombre_material,
  coalesce(
    nullif(
      concat_ws(
        ' - ',
        nullif(coalesce(prov.codigo_proveedor, pm.codigo_proveedor, mc.codigo_suministrador, p.cod_proveedor, ''), ''),
        nullif(coalesce(prov.nombre_proveedor, pm.nombre_proveedor, mc.nombre_suministrador, ''), '')
      ),
      ''
    ),
    'Sin suministrador registrado'
  ) as nombre_suministrador,
  coalesce(p.stock_disponible_real, 0) as stock_disponible_real,
  coalesce(p.stock_transito_real, 0) as stock_transito_real,
  coalesce(p.cantidad_oc_pendiente, 0) as cantidad_oc_pendiente,
  coalesce(reab.reabastecimiento_pendiente, 0) as reabastecimiento_pendiente,
  reab.fecha_reabastecimiento,
  reab.orden_compra_reabastecimiento,
  greatest(0, coalesce(nullif(mc.min_venta, 0), 1)) as minimo_venta,
  greatest(0, coalesce(nullif(mc.mult_venta, 0), 1)) as multiplo_venta,
  case
    when nullif(btrim(coalesce(p.excluidos, '')), '') is null
      then public.estado_planificable_bodega_fq(mc.estado_planificacion)
    else coalesce(p.estado_planificable_operativo, 'no planificable')
  end as estado_planificable,
  p.prioridad_operativa as prioridad_calculada
from public.pedidos_bodega_fq_priorizados_v p
left join public.material_catalogo mc on mc.codigo_material = p.codigo_material
left join proveedores_material pm on pm.codigo_material = p.codigo_material
left join reabastecimiento_material reab on reab.codigo_material = p.codigo_material
left join public.proveedores_operativos prov
  on prov.codigo_proveedor = coalesce(nullif(p.cod_proveedor, ''), nullif(mc.codigo_suministrador, ''));

create or replace view public.operacion_bodega_fq_kpis_v as
select
  (select count(*)::integer from public.pedidos_bodega_fq) as casos_bodega_fq,
  (select count(distinct cod_pedido)::integer from public.pedidos_bodega_fq) as pedidos_bodega_fq,
  (select count(*)::integer from public.inventario_bodega) as materiales_inventario,
  (select count(*)::integer from public.transito_bodega) as lineas_transito,
  (select count(distinct documento_compras)::integer from public.transito_bodega) as oc_transito,
  (select count(*)::integer from public.oc_pendientes_bodega) as lineas_oc_pendientes,
  (select count(*)::integer from public.materiales_operativos_v where estado_cobertura = 'faltante') as materiales_faltantes,
  (select count(*)::integer from public.pedidos_bodega_fq_priorizados_v where prioridad_operativa >= 50) as pedidos_prioridad_alta;

grant select on public.materiales_operativos_v to anon, authenticated;
grant select on public.pedido_detalle_operativo_v to anon, authenticated;
grant select on public.operacion_bodega_fq_kpis_v to anon, authenticated;
