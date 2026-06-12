-- Rol temporal observador.
-- Permite acceso completo de lectura desde la app sin permisos de escritura.

alter table public.usuarios_app
  drop constraint if exists usuarios_app_rol_check;

alter table public.usuarios_app
  add constraint usuarios_app_rol_check
  check (rol in ('administrador', 'suministrador', 'bodega', 'observador'));

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
      and usuario.rol in ('administrador', 'suministrador', 'bodega', 'observador')
  );
$$;

grant execute on function public.usuario_app_activo() to authenticated;
