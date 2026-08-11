-- Un reporte es una gestión paralela: no puede devolver un pedido a una etapa
-- anterior ni cambiar su estado operativo. La vista de pedidos ya incorpora los
-- reportes activos sin requerir que el pedido sea reabierto artificialmente.
create or replace function public.sincronizar_reportes_activos_reabren_pedidos()
returns integer
language sql
stable
security invoker
set search_path = public
as $function$
  select 0;
$function$;
