-- Cierra alertas operativas de pedidos con gestion cerrada.
-- Ejecutar completo en Supabase SQL Editor.
-- Excepcion: si existe reporte activo de franquiciado, la alerta puede seguir operativa
-- porque el pedido vuelve a revision por observacion del franquiciado.

update public.alertas a
set estado = 'cerrada'
from public.pedidos p
where a.pedido_id = p.id
  and a.estado in ('activa', 'revisada')
  and p.estado in ('entregado', 'cancelado', 'rechazado')
  and not (
    a.tipo_alerta in ('reporte_franquiciado_abierto', 'reporte_franquiciado_duplicado')
    or exists (
      select 1
      from public.reportes_franquiciado rf
      where rf.estado in ('recibido', 'en_revision')
        and (
          rf.pedido_id = p.id
          or rf.codigo_consulta = p.codigo
          or rf.codigo_consulta = p.codigo_consulta
        )
    )
  );

select count(*) as alertas_operativas_de_gestion_cerrada_restantes
from public.alertas a
join public.pedidos p on p.id = a.pedido_id
where a.estado in ('activa', 'revisada')
  and p.estado in ('entregado', 'cancelado', 'rechazado')
  and a.tipo_alerta not in ('reporte_franquiciado_abierto', 'reporte_franquiciado_duplicado');

notify pgrst, 'reload schema';
