-- Una alerta abierta por material evita duplicados cuando dos procesos de
-- inventario coinciden. Las alertas cerradas conservan el historial de cada
-- nueva caída al umbral.
create unique index if not exists alertas_stock_abiertas_por_material_unica_idx
  on public.alertas (material_id)
  where material_id is not null
    and tipo_alerta in ('stock_bajo', 'faltante_bodega_fq')
    and estado in ('activa', 'revisada');

-- El bloqueo se toma por material, no para toda la tabla. Así, dos ajustes
-- simultáneos del mismo material no pueden crear dos alertas abiertas.
create or replace function public.registrar_alerta_stock_material(
  p_material_id uuid,
  p_pedido_id uuid default null,
  p_stock_nuevo integer default null,
  p_responsable text default 'Departamento de inventario'
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_material public.materiales%rowtype;
  v_stock integer;
  v_minimo integer := 30;
  v_normal integer := 60;
  v_alerta_id uuid;
  v_alerta_nivel text;
  v_mensaje text;
  v_nivel text;
begin
  perform pg_advisory_xact_lock(hashtext('alerta_stock:' || p_material_id::text));

  select * into v_material
  from public.materiales
  where id = p_material_id;

  if not found then
    return null;
  end if;

  v_stock := coalesce(p_stock_nuevo, v_material.stock_actual);

  if v_stock > v_normal then
    update public.alertas
    set estado = 'cerrada'
    where material_id = v_material.id
      and tipo_alerta in ('stock_bajo', 'faltante_bodega_fq')
      and estado in ('activa', 'revisada');

    return null;
  end if;

  v_nivel := case when v_stock <= v_minimo then 'critica' else 'alta' end;
  v_mensaje :=
    'Material '
    || coalesce(v_material.codigo_material || ' - ', '')
    || v_material.nombre
    || case when v_nivel = 'critica' then ' en estado critico: stock ' else ' en riesgo: stock ' end
    || greatest(0, v_stock)::text
    || ' / minimo '
    || v_minimo::text
    || ' / normal '
    || v_normal::text
    || '. Departamento debe verificar reposicion.';

  select id, nivel into v_alerta_id, v_alerta_nivel
  from public.alertas
  where material_id = v_material.id
    and tipo_alerta in ('stock_bajo', 'faltante_bodega_fq')
    and estado in ('activa', 'revisada')
  order by created_at desc
  limit 1;

  if v_alerta_id is not null and v_alerta_nivel is distinct from v_nivel then
    update public.alertas
    set estado = 'cerrada'
    where material_id = v_material.id
      and tipo_alerta in ('stock_bajo', 'faltante_bodega_fq')
      and estado in ('activa', 'revisada');

    v_alerta_id := null;
  end if;

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
      tipo_alerta = 'stock_bajo',
      nivel = v_nivel,
      mensaje = v_mensaje,
      estado = 'activa',
      responsable = coalesce(p_responsable, responsable, 'Departamento de inventario')
    where id = v_alerta_id;

    update public.alertas
    set estado = 'cerrada'
    where material_id = v_material.id
      and tipo_alerta in ('stock_bajo', 'faltante_bodega_fq')
      and estado in ('activa', 'revisada')
      and id <> v_alerta_id;
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
$function$;

-- El cambio de stock consolidado ya actualiza "materiales" y ese cambio tiene
-- su propio trigger. No se debe volver a registrar la misma alerta aquí.
create or replace function public.inventario_bodega_stock_alerta_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_material public.materiales%rowtype;
  v_stock_total numeric := 0;
  v_stock_entero integer := 0;
begin
  if tg_op = 'UPDATE' then
    if old.stock_disponible is not distinct from new.stock_disponible then
      return new;
    end if;
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

  return new;
end;
$function$;
