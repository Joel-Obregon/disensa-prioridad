-- Reversion del rol temporal observador.
-- Ejecutar en Supabase SQL Editor si se alcanzo a aplicar 07_rol_temporal_observador.sql.

begin;

update public.usuarios_app
set rol = 'administrador'
where rol = 'observador';

alter table public.usuarios_app
  drop constraint if exists usuarios_app_rol_check;

alter table public.usuarios_app
  add constraint usuarios_app_rol_check
  check (rol in ('administrador', 'suministrador', 'bodega'));

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

grant execute on function public.usuario_app_activo() to authenticated;

notify pgrst, 'reload schema';

commit;
