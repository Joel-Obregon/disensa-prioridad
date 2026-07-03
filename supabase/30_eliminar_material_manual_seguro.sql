-- Migracion 30: eliminacion segura de materiales manuales
-- Problema: al eliminar un material recien creado aparecia
--   "invalid input syntax for type uuid: 'NNNNNNNN'"
-- porque el inventario operativo entrega el CODIGO como "id" cuando la fila aun
-- no quedo enlazada a la tabla materiales. El cliente ahora resuelve el UUID
-- real (resolverMaterial) antes de eliminar/editar.
--
-- Ademas, como el trigger de la migracion 29 inserta el codigo en
-- material_catalogo, un material manual reaparecia como fila "fantasma" en la
-- vista operativa tras eliminarlo. Este RPC limpia catalogo+bodega del material
-- manual SIN tocar nunca el catalogo ERP ('BASE.xlsx') ni codigos referenciados.

create or replace function public.limpiar_catalogo_material_manual(p_codigo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_codigo is null or btrim(p_codigo) = '' then
    return;
  end if;

  delete from public.material_catalogo c
  where c.codigo_material = btrim(p_codigo)
    and coalesce(c.fuente_catalogo, 'manual') <> 'BASE.xlsx'
    and not exists (select 1 from public.materiales m where m.codigo_material = btrim(p_codigo))
    and not exists (select 1 from public.pedidos_bodega_fq p where p.codigo_material = btrim(p_codigo))
    and not exists (select 1 from public.transito_bodega t where t.codigo_material = btrim(p_codigo))
    and not exists (select 1 from public.oc_pendientes_bodega o where o.codigo_material = btrim(p_codigo));
  -- inventario_bodega se elimina por ON DELETE CASCADE.
end;
$$;

grant execute on function public.limpiar_catalogo_material_manual(text) to anon, authenticated;

-- El trigger asegurar_material_catalogo ahora marca como 'manual' las filas que
-- crea (solo nuevas), para distinguirlas del catalogo ERP.
create or replace function public.asegurar_material_catalogo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.codigo_material is not null and btrim(new.codigo_material) <> '' then
    new.codigo_material := btrim(new.codigo_material);

    insert into public.material_catalogo (codigo_material, nombre_material, fuente_catalogo)
    values (
      new.codigo_material,
      coalesce(nullif(btrim(new.nombre), ''), new.codigo_material),
      'manual'
    )
    on conflict (codigo_material) do nothing;
  else
    new.codigo_material := null;
  end if;

  return new;
end;
$$;
