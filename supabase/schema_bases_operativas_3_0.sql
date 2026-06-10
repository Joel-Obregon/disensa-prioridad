-- Modelo operativo 3.0 para integrar:
-- - BASE_PENDIENTES_BODEGA_A_FQ_EDITADO.xlsx
-- - INVENTARIO_03-06-2026_EDITADO.xlsx
-- - TRANSITO_ejemplo_EDITADO.xlsx
-- - OC_PENDIENTES_SUM_A_BOG_EDITADO.xlsx
--
-- Ejecutar despues de limpiar datos importados y antes de correr
-- scripts/importar_bases_operativas_3_0.py.

create extension if not exists pgcrypto;

create table if not exists public.centros_bodega (
  centro_codigo text primary key,
  nombre_centro text,
  sociedad text,
  nombre_empresa text,
  fuente text not null default 'bases_operativas_3_0',
  updated_at timestamptz not null default now()
);

create table if not exists public.clientes_franquiciado (
  codigo_cliente text primary key,
  nombre_cliente text not null,
  zona_cliente text,
  zona text,
  fuente text not null default 'BASE_PENDIENTES_BODEGA_A_FQ_EDITADO.xlsx',
  updated_at timestamptz not null default now()
);

create table if not exists public.proveedores_operativos (
  codigo_proveedor text primary key,
  nombre_proveedor text not null,
  fuente text not null default 'bases_operativas_3_0',
  updated_at timestamptz not null default now()
);

create table if not exists public.inventario_bodega (
  centro_codigo text not null references public.centros_bodega(centro_codigo)
    on update cascade on delete cascade,
  codigo_material text not null references public.material_catalogo(codigo_material)
    on update cascade on delete cascade,
  sociedad text,
  nombre_empresa text,
  nombre_centro text,
  tipo_material text,
  fabricante text,
  unidad_medida text not null default 'UN',
  stock_libre_utilizacion numeric(14, 3) not null default 0,
  bloqueado numeric(14, 3) not null default 0,
  comprometido_ped_vta numeric(14, 3) not null default 0,
  comprometido_entregas numeric(14, 3) not null default 0,
  consignacion_libre numeric(14, 3) not null default 0,
  stock_en_curso_pedido numeric(14, 3) not null default 0,
  devoluciones numeric(14, 3) not null default 0,
  stock_disponible numeric(14, 3) not null default 0,
  fuente text not null default 'INVENTARIO_03-06-2026_EDITADO.xlsx',
  updated_at timestamptz not null default now(),
  primary key (centro_codigo, codigo_material)
);

create index if not exists inventario_bodega_material_idx
on public.inventario_bodega (codigo_material);

alter table public.inventario_bodega
  drop constraint if exists inventario_bodega_stock_no_negativo;

update public.inventario_bodega
set
  stock_libre_utilizacion = greatest(0, coalesce(stock_libre_utilizacion, 0)),
  bloqueado = greatest(0, coalesce(bloqueado, 0)),
  comprometido_ped_vta = greatest(0, coalesce(comprometido_ped_vta, 0)),
  comprometido_entregas = greatest(0, coalesce(comprometido_entregas, 0)),
  consignacion_libre = greatest(0, coalesce(consignacion_libre, 0)),
  stock_en_curso_pedido = greatest(0, coalesce(stock_en_curso_pedido, 0)),
  devoluciones = greatest(0, coalesce(devoluciones, 0)),
  stock_disponible = greatest(0, coalesce(stock_disponible, 0)),
  updated_at = now()
where
  coalesce(stock_libre_utilizacion, 0) < 0
  or coalesce(bloqueado, 0) < 0
  or coalesce(comprometido_ped_vta, 0) < 0
  or coalesce(comprometido_entregas, 0) < 0
  or coalesce(consignacion_libre, 0) < 0
  or coalesce(stock_en_curso_pedido, 0) < 0
  or coalesce(devoluciones, 0) < 0
  or coalesce(stock_disponible, 0) < 0;

alter table public.inventario_bodega
  add constraint inventario_bodega_stock_no_negativo
  check (
    stock_libre_utilizacion >= 0
    and bloqueado >= 0
    and comprometido_ped_vta >= 0
    and comprometido_entregas >= 0
    and consignacion_libre >= 0
    and stock_en_curso_pedido >= 0
    and devoluciones >= 0
    and stock_disponible >= 0
  );

create table if not exists public.pedidos_bodega_fq (
  pedido_key text primary key,
  validacion_bodega text,
  lider text,
  observacion_despacho text,
  tipo_caso text,
  responsable text,
  resolucion text,
  estado text,
  base text,
  centro_codigo text references public.centros_bodega(centro_codigo)
    on update cascade on delete set null,
  cod_pedido text not null,
  zona_cliente text,
  codigo_cliente text references public.clientes_franquiciado(codigo_cliente)
    on update cascade on delete set null,
  cliente text,
  zona text,
  posicion text,
  cod_proveedor text,
  codigo_material text not null references public.material_catalogo(codigo_material)
    on update cascade on delete restrict,
  descripcion_material text not null,
  cantidad numeric(14, 3) not null default 0,
  unidad text not null default 'UN',
  peso_kg numeric(14, 3) not null default 0,
  m3 numeric(14, 3) not null default 0,
  linea_producto text,
  placa text,
  cod_trans text,
  fecha_solicitud date,
  fecha_limite date,
  observaciones_general text,
  validacion_lizbeth_nicola text,
  fecha_reportado date,
  fecha_revision date,
  fecha_entrega date,
  dias_entregados numeric(10, 2),
  sla text,
  pedidos_dp text,
  fecha_compra date,
  stock_disponible_fuente numeric(14, 3) not null default 0,
  stock_en_transito_fuente numeric(14, 3) not null default 0,
  bloqueado_fuente numeric(14, 3) not null default 0,
  validacion_planning text,
  validado_por text,
  oc text,
  fecha_oc date,
  excluidos text,
  fecha_cierre_bodega date,
  prioridad_calculada integer not null default 0 check (prioridad_calculada between 0 and 100),
  fuente text not null default 'BASE_PENDIENTES_BODEGA_A_FQ_EDITADO.xlsx',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pedidos_bodega_fq_pedido_idx on public.pedidos_bodega_fq (cod_pedido);
create index if not exists pedidos_bodega_fq_material_idx on public.pedidos_bodega_fq (codigo_material);
create index if not exists pedidos_bodega_fq_cliente_idx on public.pedidos_bodega_fq (codigo_cliente);
create index if not exists pedidos_bodega_fq_oc_idx on public.pedidos_bodega_fq (oc);
create index if not exists pedidos_bodega_fq_prioridad_idx on public.pedidos_bodega_fq (prioridad_calculada desc);

create table if not exists public.oc_pendientes_bodega (
  oc_linea_key text primary key,
  centro_codigo text not null references public.centros_bodega(centro_codigo)
    on update cascade on delete cascade,
  documento_compras text not null,
  fecha_documento date,
  codigo_material text not null references public.material_catalogo(codigo_material)
    on update cascade on delete restrict,
  texto_breve text,
  cantidad_pedido numeric(14, 3) not null default 0,
  cantidad_por_entregar numeric(14, 3) not null default 0,
  valor_neto numeric(14, 2) not null default 0,
  codigo_proveedor text references public.proveedores_operativos(codigo_proveedor)
    on update cascade on delete set null,
  nombre_proveedor text,
  tipo_posicion text,
  tipo_posicion_1 text,
  tipo_imputacion text,
  fuente text not null default 'OC_PENDIENTES_SUM_A_BOG_EDITADO.xlsx',
  updated_at timestamptz not null default now()
);

create index if not exists oc_pendientes_bodega_doc_idx on public.oc_pendientes_bodega (documento_compras);
create index if not exists oc_pendientes_bodega_material_idx on public.oc_pendientes_bodega (codigo_material);
create index if not exists oc_pendientes_bodega_proveedor_idx on public.oc_pendientes_bodega (codigo_proveedor);

create table if not exists public.transito_bodega (
  transito_linea_key text primary key,
  centro_codigo text not null references public.centros_bodega(centro_codigo)
    on update cascade on delete cascade,
  documento_compras text not null,
  fecha_documento date,
  codigo_material text not null references public.material_catalogo(codigo_material)
    on update cascade on delete restrict,
  texto_breve text,
  cantidad_pedido numeric(14, 3) not null default 0,
  cantidad_por_entregar numeric(14, 3) not null default 0,
  valor_neto numeric(14, 2) not null default 0,
  codigo_proveedor text references public.proveedores_operativos(codigo_proveedor)
    on update cascade on delete set null,
  nombre_proveedor text,
  fuente text not null default 'TRANSITO_ejemplo_EDITADO.xlsx',
  updated_at timestamptz not null default now()
);

create index if not exists transito_bodega_doc_idx on public.transito_bodega (documento_compras);
create index if not exists transito_bodega_material_idx on public.transito_bodega (codigo_material);
create index if not exists transito_bodega_proveedor_idx on public.transito_bodega (codigo_proveedor);

create or replace function public.estado_pedido_bodega_fq(
  p_resolucion text,
  p_estado text,
  p_cantidad numeric,
  p_stock_disponible numeric,
  p_stock_transito numeric
)
returns text
language plpgsql
immutable
as $$
begin
  if coalesce(p_estado, '') ilike '%cerrad%' then
    return 'entregado';
  end if;

  if coalesce(p_estado, '') ilike '%cancel%' then
    return 'cancelado';
  end if;

  if coalesce(p_resolucion, '') ilike '%entregado%' then
    return 'entregado';
  end if;

  if coalesce(p_resolucion, '') ilike '%nc%' then
    return 'en_revision';
  end if;

  if coalesce(p_stock_disponible, 0) >= coalesce(p_cantidad, 0) then
    return 'aprobado';
  end if;

  if coalesce(p_stock_disponible, 0) <= 0 and coalesce(p_stock_transito, 0) <= 0 then
    return 'sin_stock';
  end if;

  return 'pendiente';
end;
$$;

drop view if exists public.otif_operativo_v cascade;
drop view if exists public.operacion_bodega_fq_kpis_v cascade;
drop view if exists public.pedido_detalle_operativo_v cascade;
drop view if exists public.pedidos_bodega_fq_priorizados_v cascade;
drop view if exists public.materiales_operativos_v cascade;

create or replace function public.estado_planificable_bodega_fq(p_excluidos text)
returns text
language plpgsql
immutable
as $$
declare
  valor text := lower(btrim(coalesce(p_excluidos, '')));
begin
  if valor = '' or valor in ('#n/a', 'n/a', 'na', 'nan') then
    return 'no planificable';
  end if;

  if valor like '%agotar%' then
    return 'agotar stock';
  end if;

  if valor like '%planificable%' and valor not like '%no plan%' then
    return 'planificable';
  end if;

  return 'no planificable';
end;
$$;

drop function if exists public.prioridad_pedido_bodega_fq(text, text, numeric, numeric, numeric, date, date, text);

create or replace function public.prioridad_pedido_bodega_fq(
  p_tipo_caso text,
  p_stock_disponible numeric,
  p_fecha_limite date,
  p_excluidos text
)
returns integer
language plpgsql
stable
as $$
declare
  puntaje numeric := 0;
  dias integer := 0;
begin
  if p_fecha_limite is not null then
    dias := greatest(0, current_date - p_fecha_limite);
  end if;

  puntaje := dias * 2;

  if greatest(0, coalesce(p_stock_disponible, 0)) = 0 then
    puntaje := puntaje + 30;
  end if;

  if upper(coalesce(p_tipo_caso, '')) like '%CADUCIDAD%' then
    puntaje := puntaje + 20;
  end if;

  if public.estado_planificable_bodega_fq(p_excluidos) = 'planificable' then
    puntaje := puntaje + 10;
  end if;

  return least(100, greatest(0, puntaje))::integer;
end;
$$;

-- Las vistas operativas cambian columnas entre versiones del prototipo.
-- PostgreSQL no permite reordenar o renombrar columnas con CREATE OR REPLACE VIEW,
-- por eso se recrean antes de definir la estructura 3.0 completa.
drop view if exists public.otif_operativo_v cascade;
drop view if exists public.operacion_bodega_fq_kpis_v cascade;
drop view if exists public.pedido_detalle_operativo_v cascade;
drop view if exists public.pedidos_bodega_fq_priorizados_v cascade;
drop view if exists public.materiales_operativos_v cascade;

create or replace view public.materiales_operativos_v as
with base_materiales as (
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
    select
      codigo_material,
      codigo_proveedor,
      nombre_proveedor,
      fecha_documento,
      1 as prioridad
    from public.oc_pendientes_bodega
    union all
    select
      codigo_material,
      codigo_proveedor,
      nombre_proveedor,
      fecha_documento,
      2 as prioridad
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
    count(*)::integer as casos_bodega_fq,
    count(distinct cod_pedido)::integer as pedidos_bodega_fq
  from public.pedidos_bodega_fq
  group by codigo_material
)
select
  m.codigo_material,
  m.nombre_material,
  coalesce(inv.unidad_medida, 'UN') as unidad_medida,
  coalesce(inv.marca_material, 'Sin marca registrada') as marca_material,
  coalesce(inv.catman_nombre, 'Sin catman registrado') as catman_nombre,
  coalesce(catman.catman_categoria, 'Sin categoria catman') as catman_categoria,
  coalesce(prov.numero_suministradores, 0) as numero_suministradores,
  prov.codigo_suministrador,
  prov.nombre_suministrador,
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
  coalesce(demanda.casos_bodega_fq, 0) as casos_bodega_fq,
  coalesce(demanda.pedidos_bodega_fq, 0) as pedidos_bodega_fq,
  1::numeric(14, 3) as min_compra,
  1::numeric(14, 3) as mult_compra,
  1::numeric(14, 3) as min_venta,
  1::numeric(14, 3) as mult_venta,
  case
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
group by
  m.codigo_material,
  m.nombre_material,
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
  demanda.casos_bodega_fq,
  demanda.pedidos_bodega_fq;

create or replace function public.limpiar_bases_operativas_3_0()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_pedidos integer := 0;
  v_alertas integer := 0;
  v_materiales integer := 0;
begin
  delete from public.alertas
  where tipo_alerta in (
    'priorizacion_bodega_fq',
    'faltante_bodega_fq',
    'transito_cubre_pedido',
    'nota_credito_bodega_fq'
  )
  or pedido_id in (select id from public.pedidos where codigo like 'BFQ-%');

  get diagnostics v_alertas = row_count;

  delete from public.pedidos where codigo like 'BFQ-%';
  get diagnostics v_pedidos = row_count;

  delete from public.materiales
  where categoria in (
    'Faltante bodega-franquiciado',
    'Cubierto con transito',
    'Demanda bodega-franquiciado',
    'Catalogo operativo'
  );

  get diagnostics v_materiales = row_count;

  truncate table
    public.inventario_bodega,
    public.pedidos_bodega_fq,
    public.oc_pendientes_bodega,
    public.transito_bodega,
    public.clientes_franquiciado,
    public.proveedores_operativos,
    public.centros_bodega;

  return jsonb_build_object(
    'ok', true,
    'pedidos_bfq_eliminados', v_pedidos,
    'alertas_bfq_eliminadas', v_alertas,
    'materiales_operativos_eliminados', v_materiales
  );
end;
$$;

create or replace view public.pedidos_bodega_fq_priorizados_v as
select
  p.*,
  c.nombre_cliente,
  c.zona as zona_cliente_detalle,
  m.nombre_material,
  coalesce(inv.stock_disponible, 0) as stock_disponible_real,
  coalesce(tran.stock_transito, 0) as stock_transito_real,
  coalesce(oc.cantidad_oc_pendiente, 0) as cantidad_oc_pendiente,
  coalesce(oc.ocs_pendientes, 0) as ocs_pendientes,
  public.estado_planificable_bodega_fq(p.excluidos) as estado_planificable_operativo,
  greatest(
    0,
    coalesce(p.cantidad, 0)
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
  public.estado_pedido_bodega_fq(
    p.resolucion,
    p.estado,
    p.cantidad,
    coalesce(inv.stock_disponible, 0),
    coalesce(inv.stock_en_curso_pedido, 0)
      + case
        when coalesce(oc.cantidad_oc_pendiente, 0) > 0 then coalesce(oc.cantidad_oc_pendiente, 0)
        else coalesce(tran.stock_transito, 0)
      end
  ) as estado_prototipo,
  case
    when lower(coalesce(p.estado, '')) like '%cerrad%' then 0
    else public.prioridad_pedido_bodega_fq(
      p.tipo_caso,
      coalesce(inv.stock_disponible, 0),
      p.fecha_limite,
      p.excluidos
    )
  end as prioridad_operativa
from public.pedidos_bodega_fq p
left join public.clientes_franquiciado c on c.codigo_cliente = p.codigo_cliente
left join public.material_catalogo m on m.codigo_material = p.codigo_material
left join (
  select
    codigo_material,
    sum(greatest(0, stock_disponible)) as stock_disponible,
    sum(greatest(0, stock_en_curso_pedido)) as stock_en_curso_pedido
  from public.inventario_bodega
  group by codigo_material
) inv on inv.codigo_material = p.codigo_material
left join (
  select codigo_material, sum(cantidad_por_entregar) as stock_transito
  from public.transito_bodega
  where coalesce(cantidad_por_entregar, 0) > 0
  group by codigo_material
) tran on tran.codigo_material = p.codigo_material
left join (
  select
    codigo_material,
    sum(cantidad_por_entregar) as cantidad_oc_pendiente,
    count(distinct documento_compras)::integer as ocs_pendientes
  from public.oc_pendientes_bodega
  where coalesce(cantidad_por_entregar, 0) > 0
  group by codigo_material
) oc on oc.codigo_material = p.codigo_material;

create or replace view public.pedido_detalle_operativo_v as
with proveedores_material as (
  select
    codigo_material,
    (array_agg(codigo_proveedor order by prioridad, fecha_documento desc nulls last)
      filter (where nullif(codigo_proveedor, '') is not null))[1] as codigo_proveedor,
    (array_agg(nombre_proveedor order by prioridad, fecha_documento desc nulls last)
      filter (where nullif(nombre_proveedor, '') is not null))[1] as nombre_proveedor
  from (
    select
      codigo_material,
      codigo_proveedor,
      nombre_proveedor,
      fecha_documento,
      1 as prioridad
    from public.oc_pendientes_bodega
    union all
    select
      codigo_material,
      codigo_proveedor,
      nombre_proveedor,
      fecha_documento,
      2 as prioridad
    from public.transito_bodega
  ) fuente
  group by codigo_material
),
transito_activo as (
  select
    codigo_material,
    sum(cantidad_por_entregar) as stock_transito
  from public.transito_bodega
  where coalesce(cantidad_por_entregar, 0) > 0
  group by codigo_material
),
oc_activa as (
  select
    codigo_material,
    sum(cantidad_por_entregar) as cantidad_oc_pendiente
  from public.oc_pendientes_bodega
  where coalesce(cantidad_por_entregar, 0) > 0
  group by codigo_material
),
reabastecimiento_evento as (
  select
    codigo_material,
    documento_compras,
    fecha_documento,
    1 as prioridad
  from public.oc_pendientes_bodega
  where coalesce(cantidad_por_entregar, 0) > 0
  union all
  select
    codigo_material,
    documento_compras,
    fecha_documento,
    2 as prioridad
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
  coalesce(p.nombre_material, p.descripcion_material, 'Material sin descripcion') as nombre_material,
  coalesce(
    nullif(
      concat_ws(
        ' - ',
        nullif(coalesce(prov.codigo_proveedor, pm.codigo_proveedor, p.cod_proveedor, ''), ''),
        nullif(coalesce(prov.nombre_proveedor, pm.nombre_proveedor, ''), '')
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
  1::numeric(14, 3) as minimo_venta,
  1::numeric(14, 3) as multiplo_venta,
  coalesce(p.estado_planificable_operativo, 'no planificable') as estado_planificable,
  p.prioridad_operativa as prioridad_calculada
from public.pedidos_bodega_fq_priorizados_v p
left join proveedores_material pm on pm.codigo_material = p.codigo_material
left join reabastecimiento_material reab on reab.codigo_material = p.codigo_material
left join public.proveedores_operativos prov on prov.codigo_proveedor = p.cod_proveedor;

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

create or replace view public.otif_operativo_v as
with oc_documentos as (
  select
    documento_compras,
    min(fecha_documento) as fecha_documento,
    sum(cantidad_por_entregar) as cantidad_por_entregar
  from public.oc_pendientes_bodega
  where documento_compras is not null
  group by documento_compras
),
oc_evaluables as (
  select *
  from oc_documentos
  where fecha_documento is not null
    and (
      current_date >= fecha_documento + 30
      or coalesce(cantidad_por_entregar, 0) <= 0
    )
),
otif_suministrador as (
  select
    count(*)::integer as total,
    count(*) filter (
      where coalesce(cantidad_por_entregar, 0) <= 0
        and current_date - fecha_documento <= 30
    )::integer as cumplidos
  from oc_evaluables
),
pedidos_cerrados as (
  select
    pedido_key,
    estado,
    fecha_limite,
    fecha_entrega,
    fecha_solicitud
  from public.pedidos_bodega_fq
  where lower(coalesce(estado, '')) like '%cerrad%'
),
otif_bodega as (
  select
    count(*)::integer as total,
    count(*) filter (
      where fecha_entrega is not null
        and fecha_limite is not null
        and fecha_entrega <= fecha_limite
    )::integer as cumplidos_completos,
    count(*) filter (
      where fecha_entrega is not null
        and fecha_limite is not null
        and fecha_entrega <= fecha_limite
    )::integer as cumplidos_sla
  from pedidos_cerrados
)
select
  case
    when os.total > 0 then round((os.cumplidos::numeric / os.total::numeric) * 100)::integer
    else 0
  end as suministrador_bodega_valor,
  coalesce(os.cumplidos, 0) as suministrador_bodega_cumplidos,
  coalesce(os.total, 0) as suministrador_bodega_total,
  'OC unicas dentro de 30 dias de espera'::text as suministrador_bodega_detalle,
  case
    when ob.total > 0 then round((ob.cumplidos_completos::numeric / ob.total::numeric) * 100)::integer
    else 0
  end as bodega_franquiciado_valor,
  coalesce(ob.cumplidos_completos, 0) as bodega_franquiciado_cumplidos,
  coalesce(ob.total, 0) as bodega_franquiciado_total,
  (
    'Pedidos cerrados; '
      || coalesce(ob.cumplidos_sla, 0)::text
      || ' dentro del SLA completo'
  )::text as bodega_franquiciado_detalle
from otif_suministrador os
cross join otif_bodega ob;

alter table public.pedidos add column if not exists codigo_consulta text;
alter table public.pedidos add column if not exists tipo_pedido text not null default 'suministrador_franquiciado';
alter table public.pedidos add column if not exists descripcion text not null default 'Pedido importado desde ERP';
alter table public.pedidos add column if not exists fecha_pedido date not null default current_date;
alter table public.pedidos add column if not exists fecha_requerida date not null default current_date;
alter table public.pedidos add column if not exists fecha_entrega date not null default current_date;
alter table public.pedidos add column if not exists prioridad text not null default 'media';
alter table public.pedidos add column if not exists observaciones text not null default '';
alter table public.pedidos add column if not exists material_id uuid references public.materiales(id) on delete set null;
alter table public.pedidos add column if not exists origen text not null default 'suministrador';
alter table public.pedidos add column if not exists destino text not null default 'franquiciado';
alter table public.pedidos add column if not exists solicitante text not null default 'Cliente sin registrar';
alter table public.pedidos add column if not exists cedula_solicitante text;
alter table public.pedidos add column if not exists material text not null default 'Material sin descripcion';
alter table public.pedidos add column if not exists cantidad integer not null default 1;
alter table public.pedidos add column if not exists unidad_medida text not null default 'unidad';
alter table public.pedidos add column if not exists stock_disponible integer not null default 0;
alter table public.pedidos add column if not exists fecha_solicitud timestamptz not null default now();
alter table public.pedidos add column if not exists fecha_compromiso timestamptz not null default now();
alter table public.pedidos add column if not exists urgencia text not null default 'media';
alter table public.pedidos add column if not exists estado text not null default 'pendiente';
alter table public.pedidos add column if not exists tipo_cliente text not null default 'franquiciado';
alter table public.pedidos add column if not exists accion_solicitante text not null default 'despachar';
alter table public.pedidos add column if not exists condicion_material text not null default 'normal';
alter table public.pedidos add column if not exists cantidad_despacho integer not null default 0;
alter table public.pedidos add column if not exists cantidad_despachada integer not null default 0;
alter table public.pedidos add column if not exists valor_pendiente numeric(14, 2) not null default 0;
alter table public.pedidos add column if not exists status_erp text;
alter table public.pedidos add column if not exists nc_pendientes integer not null default 0;
alter table public.pedidos add column if not exists tiene_gestion_stock boolean not null default false;
alter table public.pedidos add column if not exists prioridad_calculada integer not null default 0;

create or replace function public.sincronizar_alertas_pedido_operativo_trg()
returns trigger
language plpgsql
security definer
as $$
declare
  v_cantidad integer := greatest(1, coalesce(nullif(new.cantidad_despacho, 0), new.cantidad, 1));
  v_dias_retraso integer := 0;
  v_alerta_id uuid;
  v_mensaje text;
  v_nivel text;
begin
  if new.fecha_compromiso is not null then
    v_dias_retraso := greatest(
      0,
      floor(extract(epoch from (now() - new.fecha_compromiso)) / 86400)::integer
    );
  end if;

  if new.estado in ('entregado', 'cancelado', 'rechazado') then
    update public.alertas
    set estado = 'cerrada'
    where pedido_id = new.id
      and tipo_alerta in ('priorizacion_bodega_fq', 'pedido_retrasado', 'falta_material_pedido')
      and estado in ('activa', 'revisada');

    return new;
  end if;

  if v_dias_retraso > 0 then
    v_nivel := case
      when coalesce(new.prioridad_calculada, 0) >= 80 or v_dias_retraso > 60 then 'critica'
      else 'alta'
    end;
    v_mensaje :=
      'Pedido '
      || coalesce(new.codigo_consulta, new.codigo)
      || ' requiere atencion por entrega: '
      || v_dias_retraso::text
      || ' d de retraso para '
      || coalesce(new.material, 'material sin registrar')
      || '.';

    select id into v_alerta_id
    from public.alertas
    where pedido_id = new.id
      and tipo_alerta in ('priorizacion_bodega_fq', 'pedido_retrasado')
      and estado in ('activa', 'revisada')
    order by created_at desc
    limit 1;

    if v_alerta_id is null then
      insert into public.alertas (
        pedido_id,
        material_id,
        tipo_alerta,
        nivel,
        mensaje,
        estado,
        responsable
      )
      values (
        new.id,
        new.material_id,
        'priorizacion_bodega_fq',
        v_nivel,
        v_mensaje,
        'activa',
        'Bodega'
      );
    else
      update public.alertas
      set
        material_id = coalesce(new.material_id, material_id),
        nivel = v_nivel,
        mensaje = v_mensaje,
        estado = 'activa',
        responsable = coalesce(responsable, 'Bodega')
      where id = v_alerta_id
        and (
          material_id is distinct from coalesce(new.material_id, material_id)
          or nivel is distinct from v_nivel
          or mensaje is distinct from v_mensaje
          or estado is distinct from 'activa'
          or responsable is distinct from coalesce(responsable, 'Bodega')
        );
    end if;
  else
    update public.alertas
    set estado = 'cerrada'
    where pedido_id = new.id
      and tipo_alerta in ('priorizacion_bodega_fq', 'pedido_retrasado')
      and estado in ('activa', 'revisada');
  end if;

  if coalesce(new.stock_disponible, 0) < v_cantidad then
    v_nivel := case when coalesce(new.stock_disponible, 0) <= 0 then 'critica' else 'alta' end;
    v_mensaje :=
      'Falta material para pedido '
      || coalesce(new.codigo_consulta, new.codigo)
      || ': disponible '
      || greatest(0, coalesce(new.stock_disponible, 0))::text
      || ' / requerido '
      || v_cantidad::text
      || ' de '
      || coalesce(new.material, 'material sin registrar')
      || '.';

    select id into v_alerta_id
    from public.alertas
    where pedido_id = new.id
      and tipo_alerta = 'falta_material_pedido'
      and estado in ('activa', 'revisada')
    order by created_at desc
    limit 1;

    if v_alerta_id is null then
      insert into public.alertas (
        pedido_id,
        material_id,
        tipo_alerta,
        nivel,
        mensaje,
        estado,
        responsable
      )
      values (
        new.id,
        new.material_id,
        'falta_material_pedido',
        v_nivel,
        v_mensaje,
        'activa',
        'Departamento de inventario'
      );
    else
      update public.alertas
      set
        material_id = coalesce(new.material_id, material_id),
        nivel = v_nivel,
        mensaje = v_mensaje,
        estado = 'activa',
        responsable = 'Departamento de inventario'
      where id = v_alerta_id
        and (
          material_id is distinct from coalesce(new.material_id, material_id)
          or nivel is distinct from v_nivel
          or mensaje is distinct from v_mensaje
          or estado is distinct from 'activa'
          or responsable is distinct from 'Departamento de inventario'
        );
    end if;
  else
    update public.alertas
    set estado = 'cerrada'
    where pedido_id = new.id
      and tipo_alerta = 'falta_material_pedido'
      and estado in ('activa', 'revisada');
  end if;

  return new;
end;
$$;

drop trigger if exists pedidos_alertas_operativas_after_save on public.pedidos;
create trigger pedidos_alertas_operativas_after_save
after insert or update of
  estado,
  fecha_compromiso,
  stock_disponible,
  cantidad,
  cantidad_despacho,
  prioridad_calculada
on public.pedidos
for each row execute function public.sincronizar_alertas_pedido_operativo_trg();

create or replace function public.refrescar_prototipo_bodega_fq()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_materiales integer := 0;
  v_pedidos integer := 0;
  v_alertas integer := 0;
  v_insertadas integer := 0;
begin
  insert into public.materiales (
    codigo_material,
    nombre,
    categoria,
    stock_actual,
    stock_minimo,
    unidad_medida,
    es_critico,
    estado
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
    codigo,
    codigo_consulta,
    tipo_pedido,
    descripcion,
    fecha_pedido,
    fecha_requerida,
    fecha_entrega,
    prioridad,
    observaciones,
    material_id,
    origen,
    destino,
    solicitante,
    cedula_solicitante,
    material,
    cantidad,
    unidad_medida,
    stock_disponible,
    fecha_solicitud,
    fecha_compromiso,
    urgencia,
    estado,
    tipo_cliente,
    accion_solicitante,
    condicion_material,
    cantidad_despacho,
    cantidad_despachada,
    valor_pendiente,
    status_erp,
    nc_pendientes,
    tiene_gestion_stock,
    prioridad_calculada
  )
  select
    'BFQ-' || p.pedido_key,
    p.cod_pedido,
    'bodega_franquiciado',
    'Pedido bodega-franquiciado ' || p.cod_pedido || ' - ' || coalesce(p.cliente, p.nombre_cliente, 'Cliente sin registrar'),
    coalesce(p.fecha_solicitud, p.fecha_reportado, current_date),
    coalesce(p.fecha_limite, p.fecha_reportado, p.fecha_solicitud, current_date),
    coalesce(p.fecha_entrega, p.fecha_limite, p.fecha_reportado, p.fecha_solicitud, current_date),
    case
      when p.prioridad_operativa >= 80 then 'critica'
      when p.prioridad_operativa >= 50 then 'alta'
      when p.prioridad_operativa >= 20 then 'media'
      else 'baja'
    end,
    concat_ws(
      ' | ',
      'Caso: ' || coalesce(p.tipo_caso, 'sin caso'),
      'Resolucion: ' || coalesce(p.resolucion, 'sin resolucion'),
      'OC: ' || coalesce(p.oc, 'sin OC'),
      'Cobertura faltante: ' || p.faltante_total::text
    ),
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
    tipo_pedido = excluded.tipo_pedido,
    descripcion = excluded.descripcion,
    fecha_pedido = excluded.fecha_pedido,
    fecha_requerida = excluded.fecha_requerida,
    fecha_entrega = excluded.fecha_entrega,
    prioridad = excluded.prioridad,
    observaciones = excluded.observaciones,
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
  where tipo_alerta in (
    'priorizacion_bodega_fq',
    'faltante_bodega_fq',
    'transito_cubre_pedido',
    'nota_credito_bodega_fq'
  );

  insert into public.alertas (pedido_id, material_id, tipo_alerta, nivel, mensaje, estado, responsable)
  select
    p.id,
    p.material_id,
    'priorizacion_bodega_fq',
    case
      when p.prioridad_calculada >= 80 then 'critica'
      when p.prioridad_calculada >= 50 then 'alta'
      else 'alta'
    end,
    'Pedido ' || p.codigo_consulta || ' requiere atencion: ' || p.material || '. Prioridad ' || p.prioridad_calculada::text || '.',
    'activa',
    'Bodega'
  from public.pedidos p
  where p.codigo like 'BFQ-%'
    and p.estado not in ('entregado', 'cancelado', 'rechazado')
    and (
      p.fecha_compromiso < now()
      or (p.stock_disponible <= 0 and p.condicion_material = 'normal')
    );

  get diagnostics v_insertadas = row_count;
  v_alertas := v_alertas + v_insertadas;

  insert into public.alertas (material_id, tipo_alerta, nivel, mensaje, estado, responsable)
  select
    mat.id,
    'faltante_bodega_fq',
    'critica',
    'Material ' || mat.nombre || ' con faltante operativo bodega-franquiciado.',
    'activa',
    'Bodega'
  from public.materiales_operativos_v mov
  join public.materiales mat on mat.codigo_material = mov.codigo_material
  where mov.estado_cobertura = 'faltante';

  get diagnostics v_insertadas = row_count;
  v_alertas := v_alertas + v_insertadas;

  insert into public.alertas (pedido_id, material_id, tipo_alerta, nivel, mensaje, estado, responsable)
  select
    p.id,
    p.material_id,
    'transito_cubre_pedido',
    'media',
    'Pedido ' || p.codigo_consulta || ' no se cubre con stock actual, pero tiene transito suficiente para el material ' || p.material || '.',
    'activa',
    'Compras'
  from public.pedidos p
  join public.pedidos_bodega_fq_priorizados_v pv on p.codigo = 'BFQ-' || pv.pedido_key
  where p.estado not in ('entregado', 'cancelado', 'rechazado')
    and coalesce(pv.stock_disponible_real, 0) < coalesce(pv.cantidad, 0)
    and coalesce(pv.stock_transito_real, 0) > 0
    and coalesce(pv.faltante_total, 0) = 0;

  get diagnostics v_insertadas = row_count;
  v_alertas := v_alertas + v_insertadas;

  insert into public.alertas (pedido_id, material_id, tipo_alerta, nivel, mensaje, estado, responsable)
  select
    p.id,
    p.material_id,
    'nota_credito_bodega_fq',
    'alta',
    'Pedido ' || p.codigo_consulta || ' tiene resolucion de nota de credito o revision asociada.',
    'activa',
    'Operacion'
  from public.pedidos p
  where p.codigo like 'BFQ-%'
    and p.accion_solicitante = 'nota_credito';

  get diagnostics v_insertadas = row_count;
  v_alertas := v_alertas + v_insertadas;

  insert into public.sync_runs (fecha_hora, estado, pedidos_actualizados, detalle_actualizado, usuario, error)
  values (
    now(),
    'sincronizacion_bases_operativas_3_0',
    v_pedidos,
    v_materiales,
    'Sistema',
    null
  )
  on conflict (fecha_hora, estado) do nothing;

  return jsonb_build_object(
    'ok', true,
    'materiales_afectados', v_materiales,
    'pedidos_afectados', v_pedidos,
    'alertas_generadas', v_alertas
  );
end;
$$;

create table if not exists public.notificaciones_correo (
  id uuid primary key default gen_random_uuid(),
  alerta_id uuid references public.alertas(id) on delete set null,
  pedido_id uuid references public.pedidos(id) on delete set null,
  material_id uuid references public.materiales(id) on delete set null,
  departamento text not null default 'Departamento de inventario',
  destinatario text not null default 'Departamento de inventario',
  asunto text not null,
  mensaje text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviada', 'fallida')),
  created_at timestamptz not null default now(),
  enviado_at timestamptz
);

create index if not exists notificaciones_correo_estado_idx
on public.notificaciones_correo (estado, created_at desc);
create index if not exists notificaciones_correo_alerta_idx
on public.notificaciones_correo (alerta_id);

create or replace function public.registrar_alerta_stock_material(
  p_material_id uuid,
  p_pedido_id uuid default null,
  p_stock_nuevo integer default null,
  p_responsable text default 'Departamento de inventario'
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_material public.materiales%rowtype;
  v_stock integer;
  v_alerta_id uuid;
  v_mensaje text;
  v_nivel text;
begin
  select * into v_material
  from public.materiales
  where id = p_material_id;

  if not found then
    return null;
  end if;

  v_stock := coalesce(p_stock_nuevo, v_material.stock_actual);

  if v_stock > 0 and v_stock >= v_material.stock_minimo then
    update public.alertas
    set estado = 'cerrada'
    where material_id = v_material.id
      and tipo_alerta = 'stock_bajo'
      and estado in ('activa', 'revisada');

    return null;
  end if;

  v_nivel := case when v_stock <= 0 then 'critica' else 'alta' end;
  v_mensaje :=
    'Material '
    || coalesce(v_material.codigo_material || ' - ', '')
    || v_material.nombre
    || ' bajo el minimo en venta: stock '
    || v_stock::text
    || ' / minimo '
    || v_material.stock_minimo::text
    || '. Departamento debe verificar la falta de stock.';

  select id into v_alerta_id
  from public.alertas
  where material_id = v_material.id
    and tipo_alerta = 'stock_bajo'
    and estado in ('activa', 'revisada')
  order by created_at desc
  limit 1;

  if v_alerta_id is null then
    insert into public.alertas (
      pedido_id,
      material_id,
      tipo_alerta,
      nivel,
      mensaje,
      estado,
      responsable
    )
    values (
      p_pedido_id,
      v_material.id,
      'stock_bajo',
      v_nivel,
      v_mensaje,
      'activa',
      coalesce(p_responsable, 'Departamento de inventario')
    )
    returning id into v_alerta_id;
  else
    update public.alertas
    set
      pedido_id = coalesce(p_pedido_id, pedido_id),
      nivel = v_nivel,
      mensaje = v_mensaje,
      estado = 'activa',
      responsable = coalesce(p_responsable, responsable, 'Departamento de inventario')
    where id = v_alerta_id;
  end if;

  insert into public.notificaciones_correo (
    alerta_id,
    pedido_id,
    material_id,
    departamento,
    destinatario,
    asunto,
    mensaje,
    estado
  )
  select
    v_alerta_id,
    p_pedido_id,
    v_material.id,
    coalesce(p_responsable, 'Departamento de inventario'),
    coalesce(p_responsable, 'Departamento de inventario'),
    'Verificar falta de stock: ' || v_material.nombre,
    v_mensaje,
    'pendiente'
  where not exists (
    select 1
    from public.notificaciones_correo nc
    where nc.alerta_id = v_alerta_id
      and nc.estado = 'pendiente'
  );

  return v_alerta_id;
end;
$$;

create or replace function public.materiales_stock_alerta_trg()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op = 'INSERT' then
    perform public.registrar_alerta_stock_material(
      new.id,
      null,
      new.stock_actual,
      'Departamento de inventario'
    );
  elsif old.stock_actual is distinct from new.stock_actual
    or old.stock_minimo is distinct from new.stock_minimo then
    perform public.registrar_alerta_stock_material(
      new.id,
      null,
      new.stock_actual,
      'Departamento de inventario'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists materiales_stock_alerta_after_save on public.materiales;
create trigger materiales_stock_alerta_after_save
after insert or update on public.materiales
for each row execute function public.materiales_stock_alerta_trg();

create or replace function public.inventario_bodega_stock_alerta_trg()
returns trigger
language plpgsql
security definer
as $$
declare
  v_material public.materiales%rowtype;
  v_stock_total numeric := 0;
  v_stock_entero integer := 0;
begin
  if tg_op = 'UPDATE'
    and old.stock_disponible is not distinct from new.stock_disponible
  then
    return new;
  end if;

  select coalesce(sum(greatest(0, stock_disponible)), 0)
  into v_stock_total
  from public.inventario_bodega
  where codigo_material = new.codigo_material;

  v_stock_entero := least(2147483647, greatest(0, ceil(v_stock_total)))::integer;

  select * into v_material
  from public.materiales
  where codigo_material = new.codigo_material
  limit 1;

  if not found then
    return new;
  end if;

  update public.materiales
  set stock_actual = v_stock_entero
  where id = v_material.id
    and stock_actual is distinct from v_stock_entero;

  perform public.registrar_alerta_stock_material(
    v_material.id,
    null,
    v_stock_entero,
    'Departamento de inventario'
  );

  return new;
end;
$$;

drop trigger if exists inventario_bodega_stock_alerta_after_save on public.inventario_bodega;
create trigger inventario_bodega_stock_alerta_after_save
after insert or update of stock_disponible on public.inventario_bodega
for each row execute function public.inventario_bodega_stock_alerta_trg();

create or replace function public.despachar_pedido_seguro(
  p_material_id uuid,
  p_pedido_id uuid,
  p_responsable text default 'Bodega'
)
returns table (
  pedido_estado text,
  stock_anterior integer,
  stock_nuevo integer
)
language plpgsql
security definer
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_material public.materiales%rowtype;
  v_cantidad integer;
begin
  select * into v_pedido
  from public.pedidos
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'No se encontro el pedido %', p_pedido_id;
  end if;

  if p_material_id is null and v_pedido.material_id is null then
    raise exception 'El pedido no tiene material asociado para descontar inventario';
  end if;

  select * into v_material
  from public.materiales
  where id = coalesce(p_material_id, v_pedido.material_id)
  for update;

  if not found then
    raise exception 'No se encontro el material asociado al pedido';
  end if;

  v_cantidad := case
    when coalesce(v_pedido.cantidad_despacho, 0) > 0 then v_pedido.cantidad_despacho
    else v_pedido.cantidad
  end;

  if v_material.stock_actual < v_cantidad then
    raise exception 'Stock insuficiente para despachar %. Disponible %, requerido %',
      v_pedido.codigo, v_material.stock_actual, v_cantidad;
  end if;

  stock_anterior := v_material.stock_actual;
  stock_nuevo := v_material.stock_actual - v_cantidad;

  update public.materiales
  set stock_actual = stock_nuevo
  where id = v_material.id;

  perform public.registrar_alerta_stock_material(
    v_material.id,
    v_pedido.id,
    stock_nuevo,
    'Departamento de inventario'
  );

  update public.pedidos
  set
    estado = 'en_despacho',
    stock_disponible = stock_nuevo,
    cantidad_despachada = v_cantidad,
    despachado_at = now(),
    despachado_por = coalesce(p_responsable, 'Bodega')
  where id = v_pedido.id;

  insert into public.movimientos_inventario (
    material_id,
    material_nombre,
    tipo,
    cantidad,
    stock_anterior,
    stock_nuevo,
    motivo,
    responsable
  )
  values (
    v_material.id,
    v_material.nombre,
    'salida',
    v_cantidad,
    stock_anterior,
    stock_nuevo,
    'Despacho de pedido ' || v_pedido.codigo,
    coalesce(p_responsable, 'Bodega')
  );

  pedido_estado := 'en_despacho';
  return next;
end;
$$;

create or replace function public.despachar_pedido_operativo_seguro(
  p_material_id uuid,
  p_pedido_id uuid,
  p_responsable text default 'Bodega',
  p_codigo_material text default null,
  p_stock_operativo numeric default null
)
returns table (
  pedido_estado text,
  stock_anterior integer,
  stock_nuevo integer
)
language plpgsql
security definer
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_material public.materiales%rowtype;
  v_codigo_material text;
  v_cantidad integer;
  v_stock_operativo numeric := 0;
  v_restante numeric := 0;
  v_descuento numeric := 0;
  v_libre_descuento numeric := 0;
  v_inv record;
begin
  select * into v_pedido
  from public.pedidos
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'No se encontro el pedido %', p_pedido_id;
  end if;

  select * into v_material
  from public.materiales
  where id = coalesce(p_material_id, v_pedido.material_id)
  for update;

  if not found and nullif(btrim(coalesce(p_codigo_material, '')), '') is not null then
    select * into v_material
    from public.materiales
    where codigo_material = nullif(btrim(p_codigo_material), '')
    for update;
  end if;

  v_codigo_material := nullif(
    btrim(coalesce(p_codigo_material, v_material.codigo_material, '')),
    ''
  );

  if v_codigo_material is null then
    raise exception 'El pedido % no tiene codigo de material para descontar inventario operativo',
      v_pedido.codigo;
  end if;

  v_cantidad := case
    when coalesce(v_pedido.cantidad_despacho, 0) > 0 then v_pedido.cantidad_despacho
    else v_pedido.cantidad
  end;

  if v_cantidad <= 0 then
    raise exception 'La cantidad de despacho debe ser mayor a cero para %', v_pedido.codigo;
  end if;

  perform 1
  from public.inventario_bodega
  where codigo_material = v_codigo_material
  for update;

  if not found then
    raise exception 'No existe inventario operativo para el material %', v_codigo_material;
  end if;

  select coalesce(sum(greatest(0, stock_disponible)), 0)
  into v_stock_operativo
  from public.inventario_bodega
  where codigo_material = v_codigo_material;

  if v_stock_operativo < v_cantidad then
    raise exception 'Stock insuficiente para despachar %. Disponible %, requerido %',
      v_pedido.codigo, v_stock_operativo, v_cantidad;
  end if;

  stock_anterior := floor(v_stock_operativo)::integer;
  v_restante := v_cantidad;

  for v_inv in
    select
      centro_codigo,
      greatest(0, stock_disponible) as stock_disponible,
      greatest(0, stock_libre_utilizacion) as stock_libre_utilizacion
    from public.inventario_bodega
    where codigo_material = v_codigo_material
    order by stock_disponible desc
    for update
  loop
    exit when v_restante <= 0;

    v_descuento := least(v_inv.stock_disponible, v_restante);
    v_libre_descuento := least(v_inv.stock_libre_utilizacion, v_descuento);

    update public.inventario_bodega
    set
      stock_disponible = greatest(0, v_inv.stock_disponible - v_descuento),
      stock_libre_utilizacion = greatest(0, v_inv.stock_libre_utilizacion - v_libre_descuento),
      updated_at = now()
    where codigo_material = v_codigo_material
      and centro_codigo = v_inv.centro_codigo;

    v_restante := v_restante - v_descuento;
  end loop;

  if v_restante > 0 then
    raise exception 'No se completo el descuento de inventario para %. Restante %',
      v_pedido.codigo, v_restante;
  end if;

  stock_nuevo := greatest(0, stock_anterior - v_cantidad)::integer;

  if v_material.id is not null then
    update public.materiales
    set stock_actual = stock_nuevo
    where id = v_material.id;

    perform public.registrar_alerta_stock_material(
      v_material.id,
      v_pedido.id,
      stock_nuevo,
      'Departamento de inventario'
    );
  end if;

  update public.pedidos
  set stock_disponible = stock_nuevo
  where material_id = coalesce(v_material.id, v_pedido.material_id)
    or (
      v_material.id is null
      and material = v_pedido.material
    );

  update public.pedidos
  set
    estado = 'en_despacho',
    cantidad_despachada = v_cantidad,
    despachado_at = now(),
    despachado_por = coalesce(p_responsable, 'Bodega')
  where id = v_pedido.id;

  if v_pedido.codigo like 'BFQ-%' then
    update public.pedidos_bodega_fq
    set
      estado = 'En despacho',
      resolucion = 'Listo para entregar',
      fecha_revision = current_date,
      updated_at = now()
    where pedido_key = substring(v_pedido.codigo from 5);
  end if;

  insert into public.movimientos_inventario (
    material_id,
    material_nombre,
    tipo,
    cantidad,
    stock_anterior,
    stock_nuevo,
    motivo,
    responsable
  )
  values (
    v_material.id,
    coalesce(v_material.nombre, v_pedido.material, v_codigo_material),
    'salida',
    v_cantidad,
    stock_anterior,
    stock_nuevo,
    'Despacho de pedido ' || v_pedido.codigo,
    coalesce(p_responsable, 'Bodega')
  );

  pedido_estado := 'en_despacho';
  return next;
end;
$$;

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
grant execute on function public.sincronizar_alertas_pedido_operativo_trg() to anon, authenticated;
grant execute on function public.inventario_bodega_stock_alerta_trg() to anon, authenticated;

grant select, insert, update, delete on public.notificaciones_correo to anon, authenticated;

alter table public.centros_bodega disable row level security;
alter table public.clientes_franquiciado disable row level security;
alter table public.proveedores_operativos disable row level security;
alter table public.inventario_bodega disable row level security;
alter table public.pedidos_bodega_fq disable row level security;
alter table public.oc_pendientes_bodega disable row level security;
alter table public.transito_bodega disable row level security;
alter table public.notificaciones_correo disable row level security;

do $$
begin
  alter publication supabase_realtime add table public.alertas;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

notify pgrst, 'reload schema';
