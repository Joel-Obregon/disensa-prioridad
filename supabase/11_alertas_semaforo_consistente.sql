-- Alinea el color de las alertas con el semaforo operativo.
-- Materiales:
--   rojo: stock <= 0 o stock < minimo operativo
--   amarillo: stock >= minimo operativo y stock < stock normal
--   verde: stock >= stock normal, se cierra la alerta
-- Pedidos:
--   rojo: retraso mayor a 60 dias
--   amarillo: retraso desde 1 hasta 60 dias
-- Cuando una alerta cambia entre rojo y amarillo, se cierra la anterior
-- y se crea una nueva para disparar la notificacion en tiempo real.

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

  v_stock := coalesce(p_stock_nuevo, v_material.stock_actual);
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
    'Verificar stock: ' || v_material.nombre,
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
      where id = v_alerta_id;

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
      where id = v_alerta_id;

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

create or replace function public.sincronizar_alertas_resueltas_por_stock()
returns integer
language plpgsql
security definer
as $$
declare
  v_cerradas_material integer := 0;
  v_cerradas_pedido_cerrado integer := 0;
  v_cerradas_pedido_stock integer := 0;
begin
  if to_regprocedure('public.sincronizar_stock_materiales_desde_inventario()') is not null then
    perform public.sincronizar_stock_materiales_desde_inventario();
  end if;

  update public.alertas a
  set estado = 'cerrada'
  from public.materiales m
  left join (
    select codigo_material, sum(greatest(0, stock_disponible)) as stock_real
    from public.inventario_bodega
    group by codigo_material
  ) inv on inv.codigo_material = m.codigo_material
  where a.material_id = m.id
    and a.estado in ('activa', 'revisada')
    and a.tipo_alerta in ('stock_bajo', 'faltante_bodega_fq', 'material_sin_inventario')
    and (
      (
        a.tipo_alerta = 'material_sin_inventario'
        and inv.codigo_material is not null
      )
      or (
        a.tipo_alerta in ('stock_bajo', 'faltante_bodega_fq')
        and coalesce(inv.stock_real, m.stock_actual, 0) >= greatest(1, coalesce(nullif(m.stock_minimo, 0), 1)) * 3
      )
    );

  get diagnostics v_cerradas_material = row_count;

  update public.alertas a
  set estado = 'cerrada'
  from public.pedidos p
  where a.pedido_id = p.id
    and a.estado in ('activa', 'revisada')
    and p.estado in ('entregado', 'cancelado', 'rechazado')
    and not exists (
      select 1
      from public.reportes_franquiciado rf
      where rf.estado in ('recibido', 'en_revision')
        and (
          rf.pedido_id = p.id
          or rf.codigo_consulta = p.codigo
          or rf.codigo_consulta = p.codigo_consulta
        )
    );

  get diagnostics v_cerradas_pedido_cerrado = row_count;

  update public.alertas a
  set estado = 'cerrada'
  from public.pedidos p
  where a.pedido_id = p.id
    and a.estado in ('activa', 'revisada')
    and a.tipo_alerta in ('falta_material_pedido', 'stock_agotado_planificable', 'transito_cubre_pedido')
    and p.estado not in ('entregado', 'cancelado', 'rechazado')
    and coalesce(p.stock_disponible, 0) >= greatest(1, coalesce(nullif(p.cantidad_despacho, 0), p.cantidad, 1));

  get diagnostics v_cerradas_pedido_stock = row_count;

  return v_cerradas_material + v_cerradas_pedido_cerrado + v_cerradas_pedido_stock;
end;
$$;

grant execute on function public.registrar_alerta_stock_material(uuid, uuid, integer, text) to anon, authenticated;
grant execute on function public.sincronizar_alertas_pedido_operativo_trg() to anon, authenticated;
grant execute on function public.sincronizar_alertas_resueltas_por_stock() to anon, authenticated;
notify pgrst, 'reload schema';
