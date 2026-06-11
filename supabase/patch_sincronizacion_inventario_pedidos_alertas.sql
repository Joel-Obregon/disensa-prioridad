-- Sincronizacion operativa entre inventario, pedidos y alertas.
-- Ejecutar en Supabase SQL Editor cuando ya existe el esquema 3.0.

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

  return new;
end;
$$;

drop trigger if exists inventario_bodega_stock_alerta_after_save on public.inventario_bodega;
create trigger inventario_bodega_stock_alerta_after_save
after insert or update of stock_disponible on public.inventario_bodega
for each row execute function public.inventario_bodega_stock_alerta_trg();

do $$
begin
  alter publication supabase_realtime add table public.alertas;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.pedidos;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.materiales;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.inventario_bodega;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.oc_pendientes_bodega;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.transito_bodega;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.pedidos_bodega_fq;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

notify pgrst, 'reload schema';
