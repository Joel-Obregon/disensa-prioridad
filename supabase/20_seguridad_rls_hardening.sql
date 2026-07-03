-- ============================================================================
-- 20_seguridad_rls_hardening.sql
-- Endurecimiento de seguridad reportado por los advisors de Supabase.
-- ----------------------------------------------------------------------------
-- LEE ESTO ANTES DE EJECUTAR:
--   Tu app usa la *anon key* desde el navegador con login propio (tabla
--   usuarios_app), NO el sistema Auth de Supabase. Por eso, para no romper el
--   acceso, este script activa RLS pero crea politicas PERMISIVAS (permiten a
--   anon/authenticated leer y escribir). Esto resuelve el error "RLS disabled"
--   del linter y deja la puerta para restringir despues, PERO por si solo no
--   limita quien accede.
--
--   Seguridad REAL (siguiente nivel, fuera de este script):
--     * Migrar el login a Supabase Auth y cambiar las politicas a
--       `using (auth.uid() ...)`, o
--     * Mover las escrituras a funciones SECURITY DEFINER y dejar las tablas
--       solo-lectura para anon.
--
--   PRUEBA con cuidado: despues de correrlo, entra a la app y verifica que
--   pedidos, alertas, inventario y reglas siguen cargando y guardando.
-- ============================================================================

-- 1) RLS activado + politica permisiva explicita en las 16 tablas expuestas
do $$
declare t text;
begin
  foreach t in array array[
    'material_catalogo','materiales','pedidos','alertas','movimientos_inventario',
    'auditoria','reportes_operativos','reportes_franquiciado','centros_bodega',
    'clientes_franquiciado','proveedores_operativos','inventario_bodega',
    'pedidos_bodega_fq','oc_pendientes_bodega','transito_bodega','notificaciones_correo'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'p_'||t||'_app', t);
    -- Politica permisiva: mantiene el comportamiento actual de la app.
    -- Para restringir, reemplaza using(true)/with check(true) por tus reglas.
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      'p_'||t||'_app', t
    );
  end loop;
end $$;

-- 2) Fijar search_path en TODAS las funciones public que no lo tengan
--    (resuelve los avisos "function_search_path_mutable", incluidas las del
--     motor de reglas). Es seguro: todas referencian objetos con esquema.
do $$
declare r record;
begin
  for r in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
        where c like 'search_path=%'
      )
  loop
    execute format('alter function public.%I(%s) set search_path = public', r.name, r.args);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- 3) AJUSTE MANUAL EN EL DASHBOARD (no es SQL):
--    Authentication > Policies/Settings > activar "Leaked password protection"
--    (verifica contra HaveIBeenPwned). Resuelve el aviso auth_leaked_password_protection.
