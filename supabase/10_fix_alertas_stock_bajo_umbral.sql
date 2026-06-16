-- Corrige el cierre automatico de alertas de stock.
-- Una alerta de stock_bajo o faltante_bodega_fq solo debe cerrarse
-- cuando el stock real llega al nivel normal/verde del material.
-- Regla vigente: minimo = pedido mas grande; normal/verde = minimo * 3.

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
        and coalesce(inv.stock_real, m.stock_actual, 0) >= greatest(1, coalesce(nullif(m.stock_minimo, 0), 1)) * 3
      )
    );

  get diagnostics v_cerradas_material = row_count;

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

grant execute on function public.sincronizar_alertas_resueltas_por_stock() to anon, authenticated;
notify pgrst, 'reload schema';
