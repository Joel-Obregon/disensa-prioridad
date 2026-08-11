-- Reconcilia el historial creado antes de que las alertas de reporte quedaran
-- vinculadas a su reporte de origen. No borra registros: los conserva como
-- cerrados para auditoria y evita que se cuenten como pedidos operativos.

-- Alertas nuevas: se pueden cerrar de forma exacta mediante reporte_id.
update public.alertas alerta
set estado = 'cerrada'
from public.reportes_franquiciado reporte
where alerta.estado <> 'cerrada'
  and alerta.tipo_alerta = 'reporte_franquiciado'
  and alerta.reporte_id = reporte.id
  and reporte.estado = 'cerrado';

-- Alertas antiguas sin reporte_id: se cierran solo si el pedido vinculado no
-- conserva ningun reporte abierto, ya sea por id o por codigo de consulta.
update public.alertas alerta
set estado = 'cerrada'
from public.pedidos pedido
where alerta.estado <> 'cerrada'
  and alerta.tipo_alerta = 'reporte_franquiciado'
  and alerta.reporte_id is null
  and alerta.pedido_id = pedido.id
  and not exists (
    select 1
    from public.reportes_franquiciado reporte
    where reporte.estado <> 'cerrado'
      and (
        reporte.pedido_id = pedido.id
        or reporte.codigo_consulta = pedido.codigo
        or reporte.codigo_consulta = pedido.codigo_consulta
      )
  );
