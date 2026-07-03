-- Migracion 31: eliminar materiales huerfanos no-ERP
-- Sintoma: "No se encontro el material en el inventario" al intentar eliminar.
-- Causa: filas que aparecen en el inventario operativo (vista materiales_operativos_v,
--   que hace UNION del catalogo y bodega) pero NO tienen fila en la tabla materiales
--   (materiales de prueba huerfanos). Sin fila en materiales no habia nada que borrar.
--
-- Solucion: el RPC ahora limpia cualquier codigo NO-ERP sin material (su catalogo,
-- bodega -por cascade- y huella en pedidos_bodega_fq/transito/oc) y devuelve cuantas
-- filas de catalogo elimino. Protege SIEMPRE el catalogo base ('BASE.xlsx') y los
-- codigos aun usados por algun material.

drop function if exists public.limpiar_catalogo_material_manual(text);

create or replace function public.limpiar_catalogo_material_manual(p_codigo text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text := btrim(coalesce(p_codigo, ''));
  v_borrados integer;
begin
  if v_codigo = '' then
    return 0;
  end if;

  if exists (
    select 1 from public.material_catalogo
    where codigo_material = v_codigo
      and coalesce(fuente_catalogo, 'manual') = 'BASE.xlsx'
  ) then
    return 0;  -- nunca tocar catalogo base/ERP
  end if;

  if exists (select 1 from public.materiales where codigo_material = v_codigo) then
    return 0;  -- aun en uso por un material
  end if;

  delete from public.pedidos_bodega_fq where codigo_material = v_codigo;
  delete from public.transito_bodega where codigo_material = v_codigo;
  delete from public.oc_pendientes_bodega where codigo_material = v_codigo;
  delete from public.material_catalogo where codigo_material = v_codigo;  -- cascade: inventario_bodega
  get diagnostics v_borrados = row_count;

  return v_borrados;
end;
$$;

grant execute on function public.limpiar_catalogo_material_manual(text) to anon, authenticated;
