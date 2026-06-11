-- Reportes reabren gestion cerrada y alertas usan inventario real.
-- Ejecutar despues de patch_reglas_negocio_operativas_3_0.sql y del patch de historial.

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
      prioridad_calculada = least(
        100,
        greatest(coalesce(prioridad_calculada, 0), case when v_activos > 1 then 80 else 60 end)
      )
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

create or replace function public.sincronizar_reportes_activos_reabren_pedidos()
returns integer
language plpgsql
security definer
as $$
declare
  v_actualizados integer := 0;
begin
  update public.pedidos p
  set
    estado = 'en_revision',
    prioridad_calculada = least(100, greatest(coalesce(p.prioridad_calculada, 0), 60))
  where p.estado in ('entregado', 'cancelado', 'rechazado')
    and exists (
      select 1
      from public.reportes_franquiciado rf
      where rf.estado in ('recibido', 'en_revision')
        and (
          rf.pedido_id = p.id
          or rf.codigo_consulta = p.codigo
          or rf.codigo_consulta = p.codigo_consulta
        )
    );

  get diagnostics v_actualizados = row_count;
  return v_actualizados;
end;
$$;

create or replace function public.sincronizar_stock_materiales_desde_inventario()
returns integer
language plpgsql
security definer
as $$
declare
  v_actualizados integer := 0;
begin
  with inv as (
    select
      codigo_material,
      least(2147483647, greatest(0, ceil(sum(greatest(0, stock_disponible)))))::integer as stock_real
    from public.inventario_bodega
    group by codigo_material
  )
  update public.materiales m
  set stock_actual = inv.stock_real
  from inv
  where m.codigo_material = inv.codigo_material
    and m.stock_actual is distinct from inv.stock_real;

  get diagnostics v_actualizados = row_count;
  return v_actualizados;
end;
$$;

create or replace function public.sincronizar_alertas_resueltas_por_stock()
returns integer
language plpgsql
security definer
as $$
declare
  v_cerradas_material integer := 0;
  v_cerradas_pedido integer := 0;
begin
  perform public.sincronizar_stock_materiales_desde_inventario();

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

  update public.alertas a
  set estado = 'cerrada'
  from public.pedidos p
  where a.pedido_id = p.id
    and a.estado in ('activa', 'revisada')
    and a.tipo_alerta in ('falta_material_pedido', 'stock_agotado_planificable', 'transito_cubre_pedido')
    and (
      p.estado in ('entregado', 'cancelado', 'rechazado')
      or coalesce(p.stock_disponible, 0) >= greatest(1, coalesce(nullif(p.cantidad_despacho, 0), p.cantidad, 1))
    );

  get diagnostics v_cerradas_pedido = row_count;

  return v_cerradas_material + v_cerradas_pedido;
end;
$$;

select public.sincronizar_reportes_activos_reabren_pedidos();
select public.sincronizar_alertas_resueltas_por_stock();

grant execute on function public.sincronizar_alertas_reporte_franquiciado_trg() to anon, authenticated;
grant execute on function public.sincronizar_reportes_activos_reabren_pedidos() to anon, authenticated;
grant execute on function public.sincronizar_stock_materiales_desde_inventario() to anon, authenticated;
grant execute on function public.sincronizar_alertas_resueltas_por_stock() to anon, authenticated;

notify pgrst, 'reload schema';
