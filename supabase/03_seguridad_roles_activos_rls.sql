-- Seguridad por roles activos.
-- Ejecutar COMPLETO en Supabase SQL Editor despues de recuperar usuarios_app.
-- Objetivo:
--   - Ningun anonimo puede insertar/actualizar/eliminar datos.
--   - Solo usuarios autenticados con perfil activo en usuarios_app pueden leer y operar.
--   - Usuarios sin rol activo quedan bloqueados por RLS aunque tengan cuenta Auth.

create or replace function public.usuario_app_activo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.usuarios_app usuario
    where lower(usuario.correo) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and usuario.estado = 'activo'
      and usuario.rol in ('administrador', 'suministrador', 'bodega')
  );
$$;

create or replace function public.usuario_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.usuarios_app usuario
    where lower(usuario.correo) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and usuario.estado = 'activo'
      and usuario.rol = 'administrador'
  );
$$;

grant execute on function public.usuario_app_activo() to authenticated;
grant execute on function public.usuario_app_admin() to authenticated;
revoke execute on function public.usuario_app_activo() from anon;
revoke execute on function public.usuario_app_admin() from anon;

alter table public.usuarios_app enable row level security;

drop policy if exists usuarios_app_select_perfil_o_admin on public.usuarios_app;
drop policy if exists usuarios_app_insert_admin on public.usuarios_app;
drop policy if exists usuarios_app_update_admin on public.usuarios_app;
drop policy if exists usuarios_app_delete_admin on public.usuarios_app;

create policy usuarios_app_select_perfil_o_admin
on public.usuarios_app
for select
to authenticated
using (
  lower(correo) = lower(coalesce(auth.jwt() ->> 'email', ''))
  or public.usuario_app_admin()
);

create policy usuarios_app_insert_admin
on public.usuarios_app
for insert
to authenticated
with check (public.usuario_app_admin());

create policy usuarios_app_update_admin
on public.usuarios_app
for update
to authenticated
using (public.usuario_app_admin())
with check (public.usuario_app_admin());

create policy usuarios_app_delete_admin
on public.usuarios_app
for delete
to authenticated
using (public.usuario_app_admin());

do $$
declare
  tabla text;
begin
  foreach tabla in array array[
    'centros_bodega',
    'clientes_franquiciado',
    'proveedores_operativos',
    'material_catalogo',
    'inventario_bodega',
    'pedidos_bodega_fq',
    'oc_pendientes_bodega',
    'transito_bodega',
    'notificaciones_correo',
    'proveedores',
    'solicitantes',
    'pedidos_erp',
    'pedido_lineas',
    'gestiones_pedido',
    'solicitudes_gestion',
    'notas_credito',
    'nota_credito_lineas',
    'sync_runs',
    'seguimiento_proveedor_fuente',
    'consolidado_nc_fuente',
    'import_errores_2_0',
    'materiales',
    'pedidos',
    'reglas_negocio',
    'alertas',
    'movimientos_inventario',
    'auditoria',
    'reportes_operativos',
    'reportes_franquiciado'
  ]
  loop
    if to_regclass('public.' || tabla) is not null then
      execute format('alter table public.%I enable row level security', tabla);
      execute format('revoke all on public.%I from anon', tabla);
      execute format('grant select, insert, update, delete on public.%I to authenticated', tabla);

      execute format('drop policy if exists %I on public.%I', tabla || '_select_activo', tabla);
      execute format('drop policy if exists %I on public.%I', tabla || '_insert_activo', tabla);
      execute format('drop policy if exists %I on public.%I', tabla || '_update_activo', tabla);
      execute format('drop policy if exists %I on public.%I', tabla || '_delete_activo', tabla);

      execute format(
        'create policy %I on public.%I for select to authenticated using (public.usuario_app_activo())',
        tabla || '_select_activo',
        tabla
      );
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.usuario_app_activo())',
        tabla || '_insert_activo',
        tabla
      );
      execute format(
        'create policy %I on public.%I for update to authenticated using (public.usuario_app_activo()) with check (public.usuario_app_activo())',
        tabla || '_update_activo',
        tabla
      );
      execute format(
        'create policy %I on public.%I for delete to authenticated using (public.usuario_app_activo())',
        tabla || '_delete_activo',
        tabla
      );
    end if;
  end loop;
end $$;

do $$
declare
  vista text;
begin
  foreach vista in array array[
    'materiales_operativos_v',
    'pedidos_bodega_fq_priorizados_v',
    'pedido_detalle_operativo_v',
    'operacion_bodega_fq_kpis_v',
    'otif_operativo_v',
    'pedidos_erp_resumen_v',
    'proveedor_kpis_v',
    'seguimiento_kpis_v',
    'materiales_demanda_v',
    'import_errores_resumen_v'
  ]
  loop
    if to_regclass('public.' || vista) is not null then
      execute format('revoke all on public.%I from anon', vista);
      execute format('grant select on public.%I to authenticated', vista);
    end if;
  end loop;
end $$;

do $$
declare
  funcion regprocedure;
begin
  foreach funcion in array array[
    to_regprocedure('public.refrescar_prototipo_bodega_fq()'),
    to_regprocedure('public.limpiar_bases_operativas_3_0()'),
    to_regprocedure('public.refrescar_prototipo_desde_erp_2_0()'),
    to_regprocedure('public.despachar_pedido_seguro(uuid, uuid, text)'),
    to_regprocedure('public.despachar_pedido_operativo_seguro(uuid, uuid, text, text, numeric)'),
    to_regprocedure('public.registrar_alerta_stock_material(uuid, uuid, integer, text)'),
    to_regprocedure('public.sincronizar_alertas_resueltas_por_stock()'),
    to_regprocedure('public.sincronizar_stock_materiales_desde_inventario()'),
    to_regprocedure('public.sincronizar_reportes_activos_reabren_pedidos()')
  ]
  loop
    if funcion is not null then
      execute format('alter function %s security invoker', funcion);
      execute format('revoke all on function %s from anon', funcion);
      execute format('grant execute on function %s to authenticated', funcion);
    end if;
  end loop;
end $$;

-- Funciones destructivas/importacion: solo service role/dueno de BD debe usarlas desde SQL o scripts.
do $$
declare
  funcion regprocedure;
begin
  foreach funcion in array array[
    to_regprocedure('public.limpiar_bases_operativas_3_0()')
  ]
  loop
    if funcion is not null then
      execute format('revoke all on function %s from anon', funcion);
      execute format('revoke all on function %s from authenticated', funcion);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

select
  'seguridad_roles_activos_aplicada' as resultado,
  count(*) filter (where estado = 'activo') as usuarios_activos
from public.usuarios_app;
