-- Alertas puntuales y reglas coherentes.
-- Ejecutar despues de 16_motor_reglas_parametrizables.sql.
--
-- Objetivo:
--   1) Si cambia el stock de un material, solo se actualiza/genera la alerta de ese material.
--   2) Si cambia un pedido, solo se actualiza/genera la alerta de ese pedido.
--   3) Un cambio amarillo <-> rojo crea una nueva alerta visual puntual.
--   4) Cambios dentro del mismo color actualizan datos, pero no duplican alertas.

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
  v_minimo integer;
  v_normal integer;
  v_alerta_id uuid;
  v_alerta_nivel text;
  v_mensaje text;
  v_nivel text;
begin
  select * into v_material
  from public.materiales
  where id = p_material_id;

  if not found then
    return null;
  end if;

  v_stock := coalesce(p_stock_nuevo, v_material.stock_actual, 0);
  v_minimo := greatest(1, coalesce(nullif(v_material.stock_minimo, 0), 1));
  v_normal := v_minimo * 3;

  if v_stock >= v_normal then
    update public.alertas
    set estado = 'cerrada'
    where material_id = v_material.id
      and tipo_alerta in ('stock_bajo', 'faltante_bodega_fq')
      and estado in ('activa', 'revisada');

    return null;
  end if;

  v_nivel := case when v_stock <= 0 or v_stock < v_minimo then 'critica' else 'alta' end;
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
    where id = v_alerta_id
      and (
        pedido_id is distinct from coalesce(p_pedido_id, pedido_id)
        or tipo_alerta is distinct from 'stock_bajo'
        or nivel is distinct from v_nivel
        or mensaje is distinct from v_mensaje
        or estado is distinct from 'activa'
        or responsable is distinct from coalesce(p_responsable, responsable, 'Departamento de inventario')
      );

    update public.alertas
    set estado = 'cerrada'
    where material_id = v_material.id
      and tipo_alerta in ('stock_bajo', 'faltante_bodega_fq')
      and estado in ('activa', 'revisada')
      and id <> v_alerta_id;
  end if;

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

create or replace function public.sincronizar_alertas_pedido_operativo_trg()
returns trigger
language plpgsql
security definer
as $$
declare
  v_cantidad integer := greatest(1, coalesce(nullif(new.cantidad_despacho, 0), new.cantidad, 1));
  v_dias_retraso integer := 0;
  v_alerta_id uuid;
  v_alerta_nivel text;
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
      and estado in ('activa', 'revisada')
      and not exists (
        select 1
        from public.reportes_franquiciado rf
        where rf.estado in ('recibido', 'en_revision')
          and (
            rf.pedido_id = new.id
            or rf.codigo_consulta = new.codigo
            or rf.codigo_consulta = new.codigo_consulta
          )
      );

    return new;
  end if;

  if v_dias_retraso > 0 then
    v_nivel := case when v_dias_retraso > 60 then 'critica' else 'alta' end;
    v_mensaje :=
      'Pedido '
      || coalesce(new.codigo_consulta, new.codigo)
      || ' requiere atencion por entrega: '
      || v_dias_retraso::text
      || ' d de retraso para '
      || coalesce(new.material, 'material sin registrar')
      || '.';

    select id, nivel into v_alerta_id, v_alerta_nivel
    from public.alertas
    where pedido_id = new.id
      and tipo_alerta in ('priorizacion_bodega_fq', 'pedido_retrasado')
      and estado in ('activa', 'revisada')
    order by created_at desc
    limit 1;

    if v_alerta_id is not null and v_alerta_nivel is distinct from v_nivel then
      update public.alertas
      set estado = 'cerrada'
      where pedido_id = new.id
        and tipo_alerta in ('priorizacion_bodega_fq', 'pedido_retrasado')
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
        );

      update public.alertas
      set estado = 'cerrada'
      where pedido_id = new.id
        and tipo_alerta in ('priorizacion_bodega_fq', 'pedido_retrasado')
        and estado in ('activa', 'revisada')
        and id <> v_alerta_id;
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

    select id, nivel into v_alerta_id, v_alerta_nivel
    from public.alertas
    where pedido_id = new.id
      and tipo_alerta = 'falta_material_pedido'
      and estado in ('activa', 'revisada')
    order by created_at desc
    limit 1;

    if v_alerta_id is not null and v_alerta_nivel is distinct from v_nivel then
      update public.alertas
      set estado = 'cerrada'
      where pedido_id = new.id
        and tipo_alerta = 'falta_material_pedido'
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

      update public.alertas
      set estado = 'cerrada'
      where pedido_id = new.id
        and tipo_alerta = 'falta_material_pedido'
        and estado in ('activa', 'revisada')
        and id <> v_alerta_id;
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

grant execute on function public.registrar_alerta_stock_material(uuid, uuid, integer, text) to anon, authenticated;
grant execute on function public.inventario_bodega_stock_alerta_trg() to anon, authenticated;
grant execute on function public.sincronizar_alertas_pedido_operativo_trg() to anon, authenticated;

notify pgrst, 'reload schema';
