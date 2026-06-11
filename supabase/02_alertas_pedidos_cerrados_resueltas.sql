-- Cierra automaticamente alertas de pedidos cuya gestion ya fue cerrada.
-- Ejecutar completo en Supabase SQL Editor.
-- No borra datos. Solo marca alertas como cerradas/resueltas.

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
        and coalesce(inv.stock_real, m.stock_actual, 0) > 0
      )
    );

  get diagnostics v_cerradas_material = row_count;

  -- Gestion cerrada: ninguna alerta operativa del pedido debe seguir activa.
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

  -- Stock resuelto: las alertas de falta de material dejan la vista operativa.
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

select public.sincronizar_alertas_resueltas_por_stock() as alertas_marcadas_resueltas;

grant execute on function public.sincronizar_alertas_resueltas_por_stock() to anon, authenticated;
grant execute on function public.sincronizar_alertas_pedido_operativo_trg() to anon, authenticated;

notify pgrst, 'reload schema';
