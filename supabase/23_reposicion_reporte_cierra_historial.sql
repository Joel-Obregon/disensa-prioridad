-- ============================================================================
-- 23_reposicion_reporte_cierra_historial.sql
-- Respaldo en BD del flujo de reposicion por reporte del franquiciado.
-- ----------------------------------------------------------------------------
-- La logica principal vive en la app (Pedidos.tsx + franquiciadoService.ts):
--   reporte 'recibido'  -> operador "Reponer" (descuenta stock UNA vez) ->
--   reporte 'en_revision' (boton bloqueado, espera validacion) ->
--   franquiciado valida la entrega -> reporte 'cerrado' + pedido 'entregado' ->
--   el pedido sale de la cola operativa y pasa a historial.
--
-- Este trigger es una RED DE SEGURIDAD: si un pedido con reporte activo se cierra
-- (entregado/cancelado/rechazado) por cualquier via, su reporte tambien se cierra,
-- para que no quede "reabierto por reporte" eternamente y llegue a historial.
-- Es idempotente y seguro de re-ejecutar.
-- ============================================================================

create or replace function public.cerrar_reportes_pedido_cerrado_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado in ('entregado', 'cancelado', 'rechazado') then
    update public.reportes_franquiciado
    set estado = 'cerrado'
    where estado in ('recibido', 'en_revision')
      and (
        pedido_id = new.id
        or codigo_consulta = new.codigo
        or codigo_consulta = new.codigo_consulta
      );
  end if;

  return new;
end;
$$;

drop trigger if exists pedidos_cerrar_reporte_al_cerrar on public.pedidos;
create trigger pedidos_cerrar_reporte_al_cerrar
after update of estado on public.pedidos
for each row
when (new.estado in ('entregado', 'cancelado', 'rechazado'))
execute function public.cerrar_reportes_pedido_cerrado_trg();

grant execute on function public.cerrar_reportes_pedido_cerrado_trg() to anon, authenticated;

notify pgrst, 'reload schema';
