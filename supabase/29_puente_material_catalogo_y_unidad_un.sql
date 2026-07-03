-- Migracion 29: puente material_catalogo + unidad UN
-- Contexto: la FK materiales.codigo_material -> material_catalogo(codigo_material)
-- rompia al crear/editar/fusionar un material cuyo codigo aun no existia en el
-- catalogo maestro (error materiales_codigo_material_fkey).
--
-- Solucion robusta a nivel de BD: un trigger BEFORE INSERT/UPDATE garantiza que
-- exista la fila en material_catalogo (la crea si falta) y normaliza el codigo
-- vacio '' a NULL (la FK admite NULL). Cubre TODAS las rutas de la app.

create or replace function public.asegurar_material_catalogo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.codigo_material is not null and btrim(new.codigo_material) <> '' then
    new.codigo_material := btrim(new.codigo_material);

    insert into public.material_catalogo (codigo_material, nombre_material)
    values (
      new.codigo_material,
      coalesce(nullif(btrim(new.nombre), ''), new.codigo_material)
    )
    on conflict (codigo_material) do nothing;
  else
    new.codigo_material := null;
  end if;

  return new;
end;
$$;

drop trigger if exists materiales_asegurar_catalogo on public.materiales;
create trigger materiales_asegurar_catalogo
before insert or update on public.materiales
for each row
execute function public.asegurar_material_catalogo();

-- Coherencia de unidades: 'UND' (resto del default antiguo de la app) -> 'UN',
-- que es la unidad real usada en el catalogo (UN, CAJ, SAC, GLL, M2, T, PAQ, L).
update public.materiales set unidad_medida = 'UN' where unidad_medida = 'UND';
update public.inventario_bodega set unidad_medida = 'UN' where unidad_medida = 'UND';
