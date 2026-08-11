-- El stock de los pedidos abiertos representa disponibilidad actual, no una
-- foto historica. Cualquier cambio de inventario del material lo propaga a
-- todos sus pedidos activos.
create or replace function public.sincronizar_stock_material_en_pedidos_trg()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.stock_actual is not distinct from old.stock_actual then
    return new;
  end if;

  update public.pedidos
  set stock_disponible = greatest(0, new.stock_actual)
  where estado not in ('entregado', 'cancelado', 'rechazado')
    and (
      material_id = new.id
      or (
        new.codigo_material is not null
        and codigo_material = new.codigo_material
      )
    )
    and stock_disponible is distinct from greatest(0, new.stock_actual);

  return new;
end;
$function$;

drop trigger if exists materiales_stock_pedidos_after_save on public.materiales;

create trigger materiales_stock_pedidos_after_save
after update of stock_actual on public.materiales
for each row
execute function public.sincronizar_stock_material_en_pedidos_trg();

-- Corrige los pedidos abiertos que ya tenian un valor anterior antes de esta
-- sincronizacion automatica.
update public.pedidos p
set stock_disponible = greatest(0, m.stock_actual)
from public.materiales m
where p.estado not in ('entregado', 'cancelado', 'rechazado')
  and (
    p.material_id = m.id
    or (
      m.codigo_material is not null
      and p.codigo_material = m.codigo_material
    )
  )
  and p.stock_disponible is distinct from greatest(0, m.stock_actual);
