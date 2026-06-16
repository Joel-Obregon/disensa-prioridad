-- Hace que el modulo Inventario muestre solo materiales del catalogo maestro
-- BASE.xlsx que tengan catman/categoria, mas materiales creados manualmente
-- desde la app. Los materiales referenciados por pedidos/OC/inventario se
-- conservan para relaciones y alertas, pero no se muestran como inventario
-- visible si no pertenecen al catalogo maestro depurado.

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

delete from public.materiales mat
where mat.categoria in (
    'Faltante bodega-franquiciado',
    'Cubierto con transito',
    'Demanda bodega-franquiciado',
    'Catalogo operativo'
  )
  and not exists (
    select 1
    from public.materiales_operativos_v mov
    where mov.codigo_material = mat.codigo_material
  );

grant select on public.materiales_operativos_v to anon, authenticated;
notify pgrst, 'reload schema';
