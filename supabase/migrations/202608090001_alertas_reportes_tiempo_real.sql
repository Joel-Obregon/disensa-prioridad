-- El semaforo de pedidos tiene solo tres tramos:
-- verde hasta la fecha comprometida, amarillo de 1 a 7 dias de retraso y rojo desde 8 dias.
update public.reglas_negocio
set
  nombre = 'Retraso del pedido (amarillo)',
  descripcion = 'Pedidos con 1 a 7 dias de retraso respecto a la fecha comprometida.',
  condicion = '{"diasDesde":1,"diasHasta":7}',
  accion = 'Coordinar la entrega y dar seguimiento durante la jornada.',
  color = 'yellow',
  criterio = 'Pedido con 1 a 7 dias de retraso respecto al dia de entrega del SLA del cliente.',
  efecto = 'Sube el pedido en la cola y lo marca en amarillo.',
  peso = 20,
  estado = 'activa',
  activo = true
where clave = 'entrega_proxima';

update public.reglas_negocio
set
  nombre = 'Retraso critico desde 8 dias (rojo)',
  descripcion = 'Pedidos con 8 o mas dias de retraso respecto a la fecha comprometida.',
  condicion = '{"diasDesde":8}',
  accion = 'Escalar de inmediato y revisar la causa del incumplimiento.',
  color = 'red',
  criterio = 'Pedido con 8 o mas dias de retraso respecto al dia de entrega del SLA del cliente.',
  efecto = 'Lo coloca al inicio de la cola y lo marca en rojo.',
  peso = 40,
  estado = 'activa',
  activo = true
where clave = 'pendiente_prolongado';

update public.reglas_negocio
set
  nombre = 'Escalamiento por retraso persistente (rojo)',
  descripcion = 'Seguimiento adicional para pedidos que acumulan mas de 30 dias de retraso.',
  color = 'red',
  criterio = 'Pedido con mas de 30 dias de retraso; mantiene el semaforo rojo.',
  efecto = 'Mantiene el pedido en rojo y requiere escalamiento adicional.'
where clave = 'pedido_sin_movimiento';

-- Regla independiente: un administrador puede desactivarla desde el modulo Reglas.
insert into public.reglas_negocio (
  nombre, descripcion, condicion, accion, color, activo, criterio, efecto, peso, estado, clave, orden
)
select
  'Alertas de reportes',
  'Controla los avisos en tiempo real y el indicador titilante del modulo Reportes.',
  '{}',
  'Notificar al equipo operativo cuando se registre un reporte.',
  'green',
  true,
  'Se registra un reporte de franquiciado u operativo.',
  'Crea una alerta en tiempo real con el color vigente del pedido y activa el indicador de Reportes.',
  10,
  'activa',
  'alertas_reportes',
  102
where not exists (
  select 1 from public.reglas_negocio where clave = 'alertas_reportes'
);

create or replace function public.regla_por_tipo_alerta(p_tipo text)
returns uuid
language sql
stable
set search_path to 'public'
as $function$
  select id from public.reglas_negocio
  where nombre = case
    when p_tipo = 'inventario_por_agotarse' then 'Inventario por agotarse'
    when p_tipo = 'material_multifranquiciado' then 'Material critico multifranquiciado'
    when p_tipo = 'material_no_planificable' then 'Material no planificable NC'
    when p_tipo = 'franquiciado_alta_frecuencia' then 'Franquiciado alta frecuencia'
    when p_tipo = 'nota_credito_bodega_fq' then 'Franquiciado solicita NC'
    when p_tipo in ('priorizacion_bodega_fq','pedido_retrasado') then 'Retraso del pedido (amarillo)'
    when p_tipo in ('falta_material_pedido','stock_agotado_planificable','material_sin_inventario') then 'Material sin existencia'
    when p_tipo in ('stock_bajo','faltante_bodega_fq') then 'Stock critico'
    when p_tipo in ('reporte_franquiciado','reporte_operativo') then 'Alertas de reportes'
    else null
  end
  limit 1;
$function$;

-- Genera una alerta por cada reporte sin modificar el pedido. De esta forma un
-- reporte nunca puede degradar un pedido rojo a amarillo.
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
begin
  if not public.regla_negocio_activa('alertas_reportes') then
    return new;
  end if;

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
    tipo_alerta,
    nivel,
    mensaje,
    estado,
    responsable
  )
  values (
    v_pedido.id,
    v_pedido.material_id,
    v_tipo,
    v_nivel,
    format('Se registró un reporte para el pedido %s. Motivo: %s.', v_codigo, v_motivo),
    'activa',
    v_responsable
  );

  return new;
end;
$function$;

drop trigger if exists reportes_franquiciado_alertas_after_save on public.reportes_franquiciado;
create trigger reportes_franquiciado_alertas_after_insert
after insert on public.reportes_franquiciado
for each row execute function public.crear_alerta_reporte_tiempo_real_trg();

drop trigger if exists reportes_operativos_alertas_after_insert on public.reportes_operativos;
create trigger reportes_operativos_alertas_after_insert
after insert on public.reportes_operativos
for each row execute function public.crear_alerta_reporte_tiempo_real_trg();
