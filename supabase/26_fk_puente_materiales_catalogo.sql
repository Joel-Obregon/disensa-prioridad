-- ============================================================================
-- 26_fk_puente_materiales_catalogo.sql
-- Conecta el "nucleo operativo" con el "catalogo/fuente" de la base.
-- ----------------------------------------------------------------------------
-- Problema detectado: el modelo tenia dos islas sin relacion formal:
--   (a) nucleo operativo  -> pedidos, materiales, alertas, reglas, reportes...
--   (b) catalogo/fuente    -> material_catalogo, inventario_bodega, pedidos_bodega_fq, oc, transito...
-- El unico puente real es `codigo_material`, que la app ya usa para hacer JOIN,
-- pero no existia una FK que lo formalizara (por eso aparecian tablas "sueltas").
--
-- Verificado en vivo: los 2626 materiales.codigo_material existen en
-- material_catalogo (0 huerfanos) y no hay duplicados, por lo que la FK es segura.
-- La app ya fue ajustada para crear el material en el catalogo ANTES de insertarlo
-- en `materiales` (src/services/materialesService.ts).
-- ============================================================================

create index if not exists materiales_codigo_material_idx
  on public.materiales (codigo_material);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'materiales_codigo_material_fkey'
  ) then
    alter table public.materiales
      add constraint materiales_codigo_material_fkey
      foreign key (codigo_material)
      references public.material_catalogo (codigo_material)
      on update cascade on delete restrict;
  end if;
end $$;

notify pgrst, 'reload schema';
