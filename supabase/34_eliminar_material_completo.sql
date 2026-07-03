-- Migracion 34: eliminacion TOTAL de un material
-- Antes, al borrar un material las FK ON DELETE SET NULL dejaban registros
-- huerfanos (pedidos/alertas con material_id nulo) visibles en Pedidos, Alertas
-- y Dashboard. Este RPC purga el material y TODO lo asociado.
--
-- Borra: pedidos del material (enlazados o huerfanos por nombre), y de esos
-- pedidos sus alertas/reportes_franquiciado/notificaciones; ademas alertas,
-- movimientos_inventario, reportes_operativos y notificaciones del material;
-- el material; y (solo si es manual) su catalogo/bodega/demanda. Protege el
-- catalogo base ERP ('BASE.xlsx').
create or replace function public.eliminar_material_completo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text;
  v_nombre text;
  v_pedidos uuid[];
begin
  select codigo_material, nombre into v_codigo, v_nombre
  from public.materiales where id = p_id;

  if not found then
    return;
  end if;

  select coalesce(array_agg(id), '{}') into v_pedidos
  from public.pedidos
  where material_id = p_id
     or (material_id is null and v_nombre is not null and material = v_nombre);

  if array_length(v_pedidos, 1) is not null then
    delete from public.alertas where pedido_id = any(v_pedidos);
    delete from public.notificaciones_correo where pedido_id = any(v_pedidos);
    delete from public.reportes_franquiciado
      where pedido_id = any(v_pedidos)
         or codigo_consulta in (
              select codigo from public.pedidos where id = any(v_pedidos)
              union
              select codigo_consulta from public.pedidos where id = any(v_pedidos)
            );
    delete from public.pedidos where id = any(v_pedidos);
  end if;

  delete from public.alertas where material_id = p_id;
  delete from public.notificaciones_correo where material_id = p_id;
  delete from public.movimientos_inventario where material_id = p_id;
  delete from public.reportes_operativos where material_id = p_id;

  delete from public.materiales where id = p_id;

  perform public.limpiar_catalogo_material_manual(v_codigo);
end;
$$;

grant execute on function public.eliminar_material_completo(uuid) to anon, authenticated;
