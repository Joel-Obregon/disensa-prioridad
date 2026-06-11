-- Semaforo de inventario por pedido maximo de cada material.
-- Ejecutar completo en Supabase SQL Editor.
-- Regla:
--   rojo: stock disponible menor al pedido mas grande del material o stock 0
--   amarillo: stock disponible entre 1x y menos de 3x el pedido mas grande
--   verde: stock disponible igual o mayor a 3x el pedido mas grande

create or replace function public.sincronizar_umbral_stock_por_pedido_maximo()
returns integer
language plpgsql
security invoker
as $$
declare
  v_actualizados integer := 0;
begin
  with demanda as (
    select
      coalesce(p.material_id, m.id) as material_id,
      max(greatest(
        0,
        coalesce(nullif(p.cantidad_despacho, 0), p.cantidad, 0)
      ))::integer as pedido_maximo
    from public.pedidos p
    left join public.materiales m
      on lower(btrim(m.nombre)) = lower(btrim(p.material))
    where p.estado not in ('entregado', 'cancelado', 'rechazado')
    group by coalesce(p.material_id, m.id)
  )
  update public.materiales m
  set
    stock_minimo = greatest(1, demanda.pedido_maximo),
    es_critico = coalesce(m.stock_actual, 0) < greatest(1, demanda.pedido_maximo)
  from demanda
  where demanda.material_id = m.id
    and demanda.pedido_maximo > 0
    and (
      m.stock_minimo is distinct from greatest(1, demanda.pedido_maximo)
      or m.es_critico is distinct from (coalesce(m.stock_actual, 0) < greatest(1, demanda.pedido_maximo))
    );

  get diagnostics v_actualizados = row_count;
  return v_actualizados;
end;
$$;

select public.sincronizar_umbral_stock_por_pedido_maximo() as materiales_actualizados;

grant execute on function public.sincronizar_umbral_stock_por_pedido_maximo() to authenticated;
revoke execute on function public.sincronizar_umbral_stock_por_pedido_maximo() from anon;

notify pgrst, 'reload schema';
