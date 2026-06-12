-- Reportes de franquiciado por pedido/material exacto.
-- Ejecutar despues de patch_reportes_reabren_y_alertas_stock_real.sql.
-- No borra pedidos: solo limpia el reporte de prueba que reabrio varias lineas.

begin;

-- Limpieza puntual del reporte de prueba asociado al pedido base 509458741.
-- La novedad se aplico por codigo corto y marco tambien dos Tanque Botella.
with pedidos_afectados as (
  select id, codigo, codigo_consulta
  from public.pedidos
  where codigo in (
    'BFQ-509458741-91001555',
    'BFQ-509458741-91003008',
    'BFQ-509458741-91004042'
  )
)
delete from public.reportes_franquiciado rf
using pedidos_afectados p
where rf.estado in ('recibido', 'en_revision')
  and (
    rf.pedido_id = p.id
    or rf.codigo_consulta = p.codigo
    or rf.codigo_consulta = p.codigo_consulta
    or rf.codigo_consulta = '509458741'
  );

update public.alertas a
set estado = 'cerrada'
where a.estado in ('activa', 'revisada')
  and a.tipo_alerta in ('reporte_franquiciado_abierto', 'reporte_franquiciado_duplicado')
  and (
    a.pedido_id in (
      select id
      from public.pedidos
      where codigo in (
        'BFQ-509458741-91001555',
        'BFQ-509458741-91003008',
        'BFQ-509458741-91004042'
      )
    )
    or a.mensaje ilike '%509458741%'
  );

update public.pedidos
set estado = case
  when estado in ('entregado', 'cancelado', 'rechazado') then estado
  else 'entregado'
end
where codigo in (
  'BFQ-509458741-91001555',
  'BFQ-509458741-91003008',
  'BFQ-509458741-91004042'
);

-- Los reportes existentes con pedido_id pasan a guardar el codigo BFQ completo.
-- Asi un reporte queda amarrado a una linea/material y no al pedido base.
update public.reportes_franquiciado rf
set codigo_consulta = p.codigo
from public.pedidos p
where rf.pedido_id = p.id
  and rf.codigo_consulta is distinct from p.codigo;

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
  select * into v_pedido
  from public.pedidos
  where id = new.pedido_id
     or codigo = new.codigo_consulta
  order by created_at desc nulls last
  limit 1;

  if new.estado = 'cerrado' then
    update public.alertas
    set estado = 'cerrada'
    where tipo_alerta in ('reporte_franquiciado_abierto', 'reporte_franquiciado_duplicado')
      and estado in ('activa', 'revisada')
      and (
        (new.pedido_id is not null and pedido_id = new.pedido_id)
        or (v_pedido.id is not null and pedido_id = v_pedido.id)
      );

    return new;
  end if;

  if v_pedido.id is null then
    return new;
  end if;

  select count(*) into v_activos
  from public.reportes_franquiciado rf
  where rf.estado in ('recibido', 'en_revision')
    and (
      rf.pedido_id = v_pedido.id
      or rf.codigo_consulta = v_pedido.codigo
    );

  v_nivel := case when v_activos > 1 then 'critica' else 'alta' end;
  v_mensaje :=
    case
      when v_activos > 1 then 'Reporte duplicado del franquiciado para pedido '
      else 'Reporte abierto del franquiciado para pedido '
    end
    || v_pedido.codigo
    || '. Material: '
    || coalesce(v_pedido.material, 'sin material')
    || '. Motivo: '
    || coalesce(new.motivo, 'sin motivo')
    || '.';

  select id into v_alerta_id
  from public.alertas
  where tipo_alerta in ('reporte_franquiciado_abierto', 'reporte_franquiciado_duplicado')
    and estado in ('activa', 'revisada')
    and pedido_id = v_pedido.id
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
      v_pedido.id,
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
      material_id = coalesce(v_pedido.material_id, material_id),
      tipo_alerta = case when v_activos > 1 then 'reporte_franquiciado_duplicado' else 'reporte_franquiciado_abierto' end,
      nivel = v_nivel,
      mensaje = v_mensaje,
      estado = 'activa',
      responsable = 'Operacion'
    where id = v_alerta_id;
  end if;

  update public.pedidos
  set prioridad_calculada = least(
    100,
    greatest(coalesce(prioridad_calculada, 0), case when v_activos > 1 then 80 else 60 end)
  )
  where id = v_pedido.id;

  return new;
end;
$$;

drop trigger if exists reportes_franquiciado_alertas_after_save on public.reportes_franquiciado;
create trigger reportes_franquiciado_alertas_after_save
after insert or update of estado, motivo, descripcion, pedido_id, codigo_consulta
on public.reportes_franquiciado
for each row
execute function public.sincronizar_alertas_reporte_franquiciado_trg();

grant execute on function public.sincronizar_alertas_reporte_franquiciado_trg() to anon, authenticated;

notify pgrst, 'reload schema';

commit;
