-- Historial operativo y cierre automatico de alertas resueltas por stock.
-- Ejecutar en Supabase SQL Editor sobre la base 3.0 existente.

create or replace function public.sincronizar_alertas_resueltas_por_stock()
returns integer
language plpgsql
security definer
as $$
declare
  v_cerradas_material integer := 0;
  v_cerradas_pedido integer := 0;
begin
  update public.alertas a
  set estado = 'cerrada'
  from public.materiales m
  where a.material_id = m.id
    and a.estado in ('activa', 'revisada')
    and a.tipo_alerta in ('stock_bajo', 'faltante_bodega_fq', 'material_sin_inventario')
    and (
      (
        a.tipo_alerta = 'material_sin_inventario'
        and exists (
          select 1
          from public.inventario_bodega inv
          where inv.codigo_material = m.codigo_material
        )
      )
      or (
        a.tipo_alerta in ('stock_bajo', 'faltante_bodega_fq')
        and coalesce(m.stock_actual, 0) >= greatest(1, coalesce(m.stock_minimo, 0))
      )
    );

  get diagnostics v_cerradas_material = row_count;

  update public.alertas a
  set estado = 'cerrada'
  from public.pedidos p
  where a.pedido_id = p.id
    and a.estado in ('activa', 'revisada')
    and a.tipo_alerta in ('falta_material_pedido', 'stock_agotado_planificable', 'transito_cubre_pedido')
    and (
      p.estado in ('entregado', 'cancelado', 'rechazado')
      or coalesce(p.stock_disponible, 0) >= greatest(1, coalesce(nullif(p.cantidad_despacho, 0), p.cantidad, 1))
    );

  get diagnostics v_cerradas_pedido = row_count;

  return v_cerradas_material + v_cerradas_pedido;
end;
$$;

create or replace function public.inventario_bodega_stock_alerta_trg()
returns trigger
language plpgsql
security definer
as $$
declare
  v_material public.materiales%rowtype;
  v_stock_total numeric := 0;
  v_stock_entero integer := 0;
begin
  if tg_op = 'UPDATE'
    and old.stock_disponible is not distinct from new.stock_disponible
  then
    return new;
  end if;

  select coalesce(sum(greatest(0, stock_disponible)), 0)
  into v_stock_total
  from public.inventario_bodega
  where codigo_material = new.codigo_material;

  v_stock_entero := least(2147483647, greatest(0, ceil(v_stock_total)))::integer;

  select * into v_material
  from public.materiales
  where codigo_material = new.codigo_material
  limit 1;

  if not found then
    perform public.sincronizar_alertas_resueltas_por_stock();
    return new;
  end if;

  update public.materiales
  set stock_actual = v_stock_entero
  where id = v_material.id
    and stock_actual is distinct from v_stock_entero;

  update public.pedidos
  set
    stock_disponible = v_stock_entero,
    tiene_gestion_stock = v_stock_entero < greatest(1, coalesce(nullif(cantidad_despacho, 0), cantidad, 1)),
    estado = case
      when estado in ('entregado', 'cancelado', 'rechazado', 'en_despacho') then estado
      when v_stock_entero < greatest(1, coalesce(nullif(cantidad_despacho, 0), cantidad, 1))
        then 'sin_stock'
      when estado = 'sin_stock' then 'pendiente'
      else estado
    end
  where material_id = v_material.id
    or (
      material_id is null
      and lower(btrim(material)) = lower(btrim(v_material.nombre))
    );

  update public.pedidos p
  set prioridad_calculada = public.prioridad_pedido_bodega_fq(
    bfq.tipo_caso,
    v_stock_entero,
    bfq.fecha_limite,
    bfq.excluidos
  )
  from public.pedidos_bodega_fq bfq
  where p.codigo = 'BFQ-' || bfq.pedido_key
    and (
      p.material_id = v_material.id
      or (
        p.material_id is null
        and lower(btrim(p.material)) = lower(btrim(v_material.nombre))
      )
    );

  perform public.registrar_alerta_stock_material(
    v_material.id,
    null,
    v_stock_entero,
    'Departamento de inventario'
  );

  perform public.sincronizar_alertas_resueltas_por_stock();

  return new;
end;
$$;

drop trigger if exists inventario_bodega_stock_alerta_after_save on public.inventario_bodega;
create trigger inventario_bodega_stock_alerta_after_save
after insert or update of stock_disponible on public.inventario_bodega
for each row execute function public.inventario_bodega_stock_alerta_trg();

select public.sincronizar_alertas_resueltas_por_stock();

grant execute on function public.sincronizar_alertas_resueltas_por_stock() to anon, authenticated;
grant execute on function public.inventario_bodega_stock_alerta_trg() to anon, authenticated;

notify pgrst, 'reload schema';
