-- Reglas de negocio operativas 3.0.
-- Ejecutar en Supabase SQL Editor para agregar las reglas al modulo "Reglas"
-- y activar validaciones coherentes con inventario, pedidos y reportes.

create table if not exists public.reglas_negocio (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  descripcion text not null default 'Regla de negocio',
  condicion text not null default 'Condicion pendiente',
  accion text not null default 'Accion pendiente',
  color text not null default 'orange',
  activo boolean not null default true,
  criterio text not null,
  efecto text not null,
  peso integer not null check (peso > 0),
  estado text not null default 'activa' check (estado in ('activa', 'inactiva')),
  created_at timestamptz not null default now()
);

insert into public.reglas_negocio (
  nombre,
  descripcion,
  condicion,
  accion,
  color,
  activo,
  criterio,
  efecto,
  peso,
  estado
)
values
  (
    'Stock agotado planificable',
    'Detecta materiales planificables sin stock disponible para despacho.',
    'stock_disponible = 0 and estado_planificable = planificable',
    'Generar alerta critica para bodega e inventario',
    'red',
    true,
    'Si un pedido usa un material planificable y el inventario real disponible es cero.',
    'El pedido queda marcado por falta de material y se alerta al departamento responsable.',
    40,
    'activa'
  ),
  (
    'Retraso critico mayor a 60 dias',
    'Escala pedidos con retraso superior a dos meses.',
    'dias_retraso > 60',
    'Subir al inicio de la cola priorizada',
    'red',
    true,
    'Si la fecha limite fue superada por mas de 60 dias.',
    'El pedido se considera critico y se mantiene arriba en la lista por antiguedad de retraso.',
    45,
    'activa'
  ),
  (
    'Hasta agotar stock',
    'Controla materiales restrictivos cuya venta depende del stock disponible.',
    'estado_planificable = agotar stock and cantidad > stock_disponible',
    'Validar alternativa, sustituto o reabastecimiento',
    'yellow',
    true,
    'Si el material esta marcado como hasta agotar stock y la cantidad solicitada supera el inventario real.',
    'Genera gestion preventiva para evitar prometer un despacho que no se puede cubrir.',
    24,
    'activa'
  ),
  (
    'Reporte de franquiciado abierto',
    'Prioriza pedidos con novedad reportada por el franquiciado.',
    'reportes_franquiciado.estado in (recibido, en_revision)',
    'Crear alerta operativa y enviar a revision',
    'red',
    true,
    'Si el franquiciado registra una novedad activa sobre su pedido.',
    'El reporte aparece en Reportes y genera alerta visual para que Operacion lo revise.',
    26,
    'activa'
  ),
  (
    'Reporte duplicado del mismo pedido',
    'Escala reclamos repetidos del mismo pedido.',
    'count(reportes_franquiciado activos por pedido) > 1',
    'Escalar alerta a critica',
    'red',
    true,
    'Si existe mas de un reporte activo asociado al mismo pedido o codigo de consulta.',
    'La alerta del reporte sube a critica por recurrencia del problema.',
    32,
    'activa'
  ),
  (
    'Material pedido no existe en inventario',
    'Detecta pedidos con material operativo que no tiene registro en inventario_bodega.',
    'pedidos_bodega_fq.codigo_material not in inventario_bodega.codigo_material',
    'Crear alerta de consistencia de datos',
    'red',
    true,
    'Si un material existe en pedidos pendientes pero no tiene fila en el inventario operativo.',
    'Advierte que el material debe crearse o corregirse para evitar stock cero incoherente.',
    38,
    'activa'
  )
on conflict (nombre) do update
set
  descripcion = excluded.descripcion,
  condicion = excluded.condicion,
  accion = excluded.accion,
  color = excluded.color,
  activo = excluded.activo,
  criterio = excluded.criterio,
  efecto = excluded.efecto,
  peso = excluded.peso,
  estado = excluded.estado;

create or replace function public.sincronizar_alertas_reporte_franquiciado_trg()
returns trigger
language plpgsql
security definer
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_alerta_id uuid;
  v_activos integer := 0;
  v_nivel text;
  v_mensaje text;
begin
  if new.estado = 'cerrado' then
    update public.alertas
    set estado = 'cerrada'
    where tipo_alerta in ('reporte_franquiciado_abierto', 'reporte_franquiciado_duplicado')
      and estado in ('activa', 'revisada')
      and (
        pedido_id = new.pedido_id
        or mensaje ilike '%' || coalesce(new.codigo_consulta, '') || '%'
      );

    return new;
  end if;

  select * into v_pedido
  from public.pedidos
  where id = new.pedido_id
     or codigo = new.codigo_consulta
     or codigo_consulta = new.codigo_consulta
  order by created_at desc nulls last
  limit 1;

  select count(*) into v_activos
  from public.reportes_franquiciado rf
  where rf.estado in ('recibido', 'en_revision')
    and (
      (new.pedido_id is not null and rf.pedido_id = new.pedido_id)
      or rf.codigo_consulta = new.codigo_consulta
    );

  v_nivel := case when v_activos > 1 then 'critica' else 'alta' end;
  v_mensaje :=
    case
      when v_activos > 1 then 'Reporte duplicado del franquiciado para pedido '
      else 'Reporte abierto del franquiciado para pedido '
    end
    || coalesce(new.codigo_consulta, v_pedido.codigo_consulta, v_pedido.codigo, 'sin codigo')
    || '. Motivo: '
    || coalesce(new.motivo, 'sin motivo')
    || '.';

  select id into v_alerta_id
  from public.alertas
  where tipo_alerta in ('reporte_franquiciado_abierto', 'reporte_franquiciado_duplicado')
    and estado in ('activa', 'revisada')
    and (
      pedido_id = coalesce(new.pedido_id, v_pedido.id)
      or mensaje ilike '%' || coalesce(new.codigo_consulta, '') || '%'
    )
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
      coalesce(new.pedido_id, v_pedido.id),
      v_pedido.material_id,
      case when v_activos > 1 then 'reporte_franquiciado_duplicado' else 'reporte_franquiciado_abierto' end,
      v_nivel,
      v_mensaje,
      'activa',
      'Operacion'
    );
  else
    update public.alertas
    set
      pedido_id = coalesce(new.pedido_id, v_pedido.id, pedido_id),
      material_id = coalesce(v_pedido.material_id, material_id),
      tipo_alerta = case when v_activos > 1 then 'reporte_franquiciado_duplicado' else 'reporte_franquiciado_abierto' end,
      nivel = v_nivel,
      mensaje = v_mensaje,
      estado = 'activa',
      responsable = 'Operacion'
    where id = v_alerta_id;
  end if;

  if v_pedido.id is not null then
    update public.pedidos
    set
      estado = case
        when estado = 'en_despacho' then estado
        else 'en_revision'
      end,
      prioridad_calculada = least(100, greatest(coalesce(prioridad_calculada, 0), case when v_activos > 1 then 80 else 60 end))
    where id = v_pedido.id;
  end if;

  return new;
end;
$$;

drop trigger if exists reportes_franquiciado_alertas_after_save on public.reportes_franquiciado;
create trigger reportes_franquiciado_alertas_after_save
after insert or update of estado, motivo, descripcion, pedido_id, codigo_consulta
on public.reportes_franquiciado
for each row execute function public.sincronizar_alertas_reporte_franquiciado_trg();

create or replace function public.sincronizar_alertas_material_sin_inventario()
returns integer
language plpgsql
security definer
as $$
declare
  v_insertadas integer := 0;
begin
  update public.alertas
  set estado = 'cerrada'
  where tipo_alerta = 'material_sin_inventario'
    and estado in ('activa', 'revisada')
    and material_id in (
      select mat.id
      from public.materiales mat
      join public.inventario_bodega inv on inv.codigo_material = mat.codigo_material
    );

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
  left join public.inventario_bodega inv on inv.codigo_material = mat.codigo_material
  where p.estado not in ('entregado', 'cancelado', 'rechazado')
    and nullif(btrim(coalesce(mat.codigo_material, '')), '') is not null
    and inv.codigo_material is null
    and not exists (
      select 1
      from public.alertas a
      where a.material_id = mat.id
        and a.tipo_alerta = 'material_sin_inventario'
        and a.estado in ('activa', 'revisada')
    )
  order by mat.id, p.created_at desc nulls last;

  get diagnostics v_insertadas = row_count;
  return v_insertadas;
end;
$$;

select public.sincronizar_alertas_material_sin_inventario();

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

drop trigger if exists pedidos_material_sin_inventario_after_save on public.pedidos;
create trigger pedidos_material_sin_inventario_after_save
after insert or update of material_id, material, estado
on public.pedidos
for each statement execute function public.sincronizar_alertas_material_sin_inventario_trg();

drop trigger if exists inventario_material_sin_inventario_after_save on public.inventario_bodega;
create trigger inventario_material_sin_inventario_after_save
after insert or update of codigo_material
on public.inventario_bodega
for each statement execute function public.sincronizar_alertas_material_sin_inventario_trg();

drop trigger if exists inventario_material_sin_inventario_after_delete on public.inventario_bodega;
create trigger inventario_material_sin_inventario_after_delete
after delete
on public.inventario_bodega
for each statement execute function public.sincronizar_alertas_material_sin_inventario_trg();

grant select, insert, update, delete on public.reglas_negocio to anon, authenticated;
grant execute on function public.sincronizar_alertas_reporte_franquiciado_trg() to anon, authenticated;
grant execute on function public.sincronizar_alertas_material_sin_inventario() to anon, authenticated;
grant execute on function public.sincronizar_alertas_material_sin_inventario_trg() to anon, authenticated;

alter table public.reglas_negocio disable row level security;

do $$
begin
  alter publication supabase_realtime add table public.reportes_franquiciado;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

notify pgrst, 'reload schema';
