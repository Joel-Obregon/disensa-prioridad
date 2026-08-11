-- Cada alerta de reporte queda vinculada a su reporte de origen. El campo no
-- tiene una FK porque puede referenciar reportes_franquiciado o reportes_operativos.
alter table public.alertas
  add column if not exists reporte_id uuid;

create index if not exists alertas_reporte_id_abiertas_idx
  on public.alertas (reporte_id)
  where reporte_id is not null and estado <> 'cerrada';

-- Crea alertas para los reportes nuevos y las resuelve al cerrar el reporte.
-- El cierre conserva el registro en alertas para auditoria, pero deja de ser
-- operativo, visible y notificable.
create or replace function public.crear_alerta_reporte_tiempo_real_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pedido public.pedidos%rowtype;
  v_codigo text;
  v_motivo text;
  v_tipo text;
  v_responsable text;
  v_nivel text;
  v_dias_retraso integer := 0;
  v_sin_reportes_activos boolean := false;
begin
  if tg_table_name = 'reportes_franquiciado' then
    select * into v_pedido
    from public.pedidos
    where id = new.pedido_id
       or codigo = new.codigo_consulta
       or codigo_consulta = new.codigo_consulta
    order by created_at desc nulls last
    limit 1;

    v_codigo := coalesce(new.codigo_consulta, v_pedido.codigo_consulta, v_pedido.codigo, 'sin codigo');
    v_motivo := coalesce(new.motivo, 'sin motivo');
    v_tipo := 'reporte_franquiciado';
    v_responsable := 'Franquiciado';
  else
    select * into v_pedido
    from public.pedidos
    where codigo = new.pedido_codigo
       or codigo_consulta = new.pedido_codigo
    order by created_at desc nulls last
    limit 1;

    v_codigo := coalesce(new.pedido_codigo, v_pedido.codigo_consulta, v_pedido.codigo, 'sin codigo');
    v_motivo := coalesce(new.titulo, new.tipo, 'sin detalle');
    v_tipo := 'reporte_operativo';
    v_responsable := coalesce(new.rol_origen, 'Operacion');
  end if;

  -- La alerta de un reporte cerrado o resuelto no debe mostrarse de nuevo.
  -- Primero se cierra exactamente la alerta vinculada al reporte. Para alertas
  -- anteriores a esta migracion se usa un respaldo por pedido, solo cuando ya
  -- no queda otro reporte abierto para el mismo pedido.
  if tg_op = 'UPDATE' then
    if (tg_table_name = 'reportes_franquiciado' and new.estado = 'cerrado' and old.estado is distinct from new.estado)
       or (tg_table_name = 'reportes_operativos' and new.estado = 'resuelto' and old.estado is distinct from new.estado) then
      update public.alertas
      set estado = 'cerrada'
      where estado <> 'cerrada'
        and tipo_alerta = v_tipo
        and reporte_id = new.id;

      if tg_table_name = 'reportes_franquiciado' then
        select not exists (
          select 1
          from public.reportes_franquiciado reporte
          where reporte.estado <> 'cerrado'
            and (
              (new.pedido_id is not null and reporte.pedido_id = new.pedido_id)
              or reporte.codigo_consulta = new.codigo_consulta
            )
        ) into v_sin_reportes_activos;
      else
        select not exists (
          select 1
          from public.reportes_operativos reporte
          where reporte.estado <> 'resuelto'
            and (
              (coalesce(new.pedido_codigo, '') <> '' and reporte.pedido_codigo = new.pedido_codigo)
              or (
                coalesce(new.pedido_codigo, '') = ''
                and new.material_id is not null
                and reporte.material_id = new.material_id
              )
            )
        ) into v_sin_reportes_activos;
      end if;

      if v_pedido.id is not null and v_sin_reportes_activos then
        update public.alertas
        set estado = 'cerrada'
        where estado <> 'cerrada'
          and tipo_alerta = v_tipo
          and reporte_id is null
          and pedido_id = v_pedido.id;
      end if;
    end if;

    return new;
  end if;

  if tg_op <> 'INSERT' or not public.regla_negocio_activa('alertas_reportes') then
    return new;
  end if;

  if v_pedido.id is not null and v_pedido.fecha_compromiso is not null then
    v_dias_retraso := greatest(
      0,
      timezone('America/Guayaquil', now())::date -
        (v_pedido.fecha_compromiso at time zone 'UTC')::date
    );
  end if;

  v_nivel := case
    when v_pedido.id is null then 'informativa'
    when v_pedido.estado in ('entregado', 'cancelado', 'rechazado') then 'informativa'
    when v_dias_retraso >= 8 then 'critica'
    when v_dias_retraso >= 1 then 'alta'
    else 'informativa'
  end;

  insert into public.alertas (
    pedido_id,
    material_id,
    reporte_id,
    tipo_alerta,
    nivel,
    mensaje,
    estado,
    responsable
  )
  values (
    v_pedido.id,
    v_pedido.material_id,
    new.id,
    v_tipo,
    v_nivel,
    format('Se registro un reporte para el pedido %s. Motivo: %s.', v_codigo, v_motivo),
    'activa',
    v_responsable
  );

  return new;
end;
$function$;

drop trigger if exists reportes_franquiciado_alertas_after_insert on public.reportes_franquiciado;
create trigger reportes_franquiciado_alertas_after_save
after insert or update of estado on public.reportes_franquiciado
for each row execute function public.crear_alerta_reporte_tiempo_real_trg();

drop trigger if exists reportes_operativos_alertas_after_insert on public.reportes_operativos;
create trigger reportes_operativos_alertas_after_save
after insert or update of estado on public.reportes_operativos
for each row execute function public.crear_alerta_reporte_tiempo_real_trg();

-- La funcion es interna: solo debe ejecutarse desde los triggers.
revoke execute on function public.crear_alerta_reporte_tiempo_real_trg()
from public, anon, authenticated;
