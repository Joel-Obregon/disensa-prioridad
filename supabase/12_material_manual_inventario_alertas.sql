-- Sincroniza materiales creados manualmente con las alertas de consistencia.
-- Objetivo:
-- - Si un material ya existe en inventario_bodega, no debe seguir apareciendo
--   como "material sin inventario".
-- - La validacion se hace por material_id y tambien por codigo_material en el
--   mensaje para resolver alertas antiguas que quedaron creadas antes del enlace.

insert into public.material_catalogo (
  codigo_material,
  nombre_material,
  updated_at
)
select
  btrim(m.codigo_material),
  m.nombre,
  now()
from public.materiales m
where nullif(btrim(coalesce(m.codigo_material, '')), '') is not null
on conflict (codigo_material) do update
set
  nombre_material = excluded.nombre_material,
  updated_at = now();

insert into public.centros_bodega (
  centro_codigo,
  nombre_centro,
  sociedad,
  nombre_empresa,
  fuente,
  updated_at
)
values (
  'YDUR',
  'Duran',
  'EC10',
  'Disensa Ecuador',
  'registro_manual_web',
  now()
)
on conflict (centro_codigo) do update
set
  nombre_centro = coalesce(public.centros_bodega.nombre_centro, excluded.nombre_centro),
  sociedad = coalesce(public.centros_bodega.sociedad, excluded.sociedad),
  nombre_empresa = coalesce(public.centros_bodega.nombre_empresa, excluded.nombre_empresa),
  updated_at = now();

insert into public.inventario_bodega (
  centro_codigo,
  codigo_material,
  sociedad,
  nombre_empresa,
  nombre_centro,
  unidad_medida,
  stock_libre_utilizacion,
  stock_disponible,
  bloqueado,
  comprometido_ped_vta,
  comprometido_entregas,
  consignacion_libre,
  stock_en_curso_pedido,
  devoluciones,
  fuente,
  updated_at
)
select
  'YDUR',
  btrim(m.codigo_material),
  'EC10',
  'Disensa Ecuador',
  'Duran',
  coalesce(nullif(btrim(m.unidad_medida), ''), 'UN'),
  greatest(0, coalesce(m.stock_actual, 0)),
  greatest(0, coalesce(m.stock_actual, 0)),
  0,
  0,
  0,
  0,
  0,
  0,
  'registro_manual_web',
  now()
from public.materiales m
where nullif(btrim(coalesce(m.codigo_material, '')), '') is not null
  and not exists (
    select 1
    from public.inventario_bodega inv
    where inv.codigo_material = btrim(m.codigo_material)
  )
on conflict (centro_codigo, codigo_material) do update
set
  unidad_medida = excluded.unidad_medida,
  stock_libre_utilizacion = greatest(0, excluded.stock_libre_utilizacion),
  stock_disponible = greatest(0, excluded.stock_disponible),
  updated_at = now();

create or replace function public.sincronizar_alertas_material_sin_inventario()
returns integer
language plpgsql
security definer
as $$
declare
  v_cerradas integer := 0;
  v_insertadas integer := 0;
begin
  update public.alertas a
  set estado = 'cerrada'
  from public.materiales mat
  where a.tipo_alerta = 'material_sin_inventario'
    and a.estado in ('activa', 'revisada')
    and nullif(btrim(coalesce(mat.codigo_material, '')), '') is not null
    and exists (
      select 1
      from public.inventario_bodega inv
      where inv.codigo_material = mat.codigo_material
    )
    and (
      a.material_id = mat.id
      or a.mensaje ilike '%' || mat.codigo_material || '%'
      or exists (
        select 1
        from public.pedidos p
        where p.id = a.pedido_id
          and p.material_id = mat.id
      )
    );

  get diagnostics v_cerradas = row_count;

  insert into public.alertas (
    pedido_id,
    material_id,
    tipo_alerta,
    nivel,
    mensaje,
    estado,
    responsable
  )
  select distinct on (mat.id)
    p.id,
    mat.id,
    'material_sin_inventario',
    'critica',
    'Material pedido no existe en inventario: '
      || coalesce(mat.codigo_material || ' - ', '')
      || mat.nombre
      || '. Debe crearse o corregirse en inventario_bodega.',
    'activa',
    'Departamento de inventario'
  from public.pedidos p
  join public.materiales mat on mat.id = p.material_id
  where p.estado not in ('entregado', 'cancelado', 'rechazado')
    and nullif(btrim(coalesce(mat.codigo_material, '')), '') is not null
    and not exists (
      select 1
      from public.inventario_bodega inv
      where inv.codigo_material = mat.codigo_material
    )
    and not exists (
      select 1
      from public.alertas a
      where a.tipo_alerta = 'material_sin_inventario'
        and a.estado in ('activa', 'revisada')
        and (
          a.material_id = mat.id
          or a.mensaje ilike '%' || mat.codigo_material || '%'
        )
    )
  order by mat.id, p.created_at desc nulls last;

  get diagnostics v_insertadas = row_count;
  return v_cerradas + v_insertadas;
end;
$$;

create or replace function public.sincronizar_alertas_material_sin_inventario_trg()
returns trigger
language plpgsql
security definer
as $$
begin
  perform public.sincronizar_alertas_material_sin_inventario();
  return null;
end;
$$;

drop trigger if exists materiales_material_sin_inventario_after_save on public.materiales;
create trigger materiales_material_sin_inventario_after_save
after insert or update of codigo_material
on public.materiales
for each statement execute function public.sincronizar_alertas_material_sin_inventario_trg();

drop trigger if exists inventario_material_sin_inventario_after_save on public.inventario_bodega;
create trigger inventario_material_sin_inventario_after_save
after insert or update of codigo_material, stock_disponible
on public.inventario_bodega
for each statement execute function public.sincronizar_alertas_material_sin_inventario_trg();

drop trigger if exists inventario_material_sin_inventario_after_delete on public.inventario_bodega;
create trigger inventario_material_sin_inventario_after_delete
after delete
on public.inventario_bodega
for each statement execute function public.sincronizar_alertas_material_sin_inventario_trg();

grant execute on function public.sincronizar_alertas_material_sin_inventario() to anon, authenticated;
grant execute on function public.sincronizar_alertas_material_sin_inventario_trg() to anon, authenticated;

select public.sincronizar_alertas_material_sin_inventario();

notify pgrst, 'reload schema';
