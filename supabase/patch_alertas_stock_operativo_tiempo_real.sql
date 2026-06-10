-- Parche: alertas visuales en tiempo real cuando cambia el stock operativo.
-- Ejecutar en Supabase SQL Editor despues del modelo operativo 3.0.

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

grant execute on function public.registrar_alerta_stock_material(uuid, uuid, integer, text) to anon, authenticated;
grant execute on function public.inventario_bodega_stock_alerta_trg() to anon, authenticated;
