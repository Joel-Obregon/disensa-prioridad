-- Politicas seguras para usuarios_app.
-- Ejecutar completo en Supabase SQL Editor.
-- Permite:
--   - Que cada usuario autenticado lea su propio perfil interno.
--   - Que administradores activos gestionen usuarios desde el modulo Usuarios.
--   - Que existan los usuarios internos base para no perder acceso.

create extension if not exists pgcrypto;

create table if not exists public.usuarios_app (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  correo text not null unique,
  rol text not null default 'administrador'
    check (rol in ('administrador', 'suministrador', 'bodega')),
  estado text not null default 'activo'
    check (estado in ('activo', 'inactivo')),
  created_at timestamptz not null default now()
);

insert into public.usuarios_app (nombre, correo, rol, estado)
values
  ('Joel Administrador', 'joelobre123@gmail.com', 'administrador', 'activo'),
  ('Bodega', 'joelobr123@gmail.com', 'bodega', 'activo'),
  ('Suministrador', 'joel_obregon@hotmail.com', 'suministrador', 'activo')
on conflict (correo) do update
set
  nombre = excluded.nombre,
  rol = excluded.rol,
  estado = 'activo';

create or replace function public.es_administrador_app()
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
      and usuario.rol = 'administrador'
      and usuario.estado = 'activo'
  );
$$;

grant execute on function public.es_administrador_app() to anon, authenticated;

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
  or public.es_administrador_app()
);

create policy usuarios_app_insert_admin
on public.usuarios_app
for insert
to authenticated
with check (public.es_administrador_app());

create policy usuarios_app_update_admin
on public.usuarios_app
for update
to authenticated
using (public.es_administrador_app())
with check (public.es_administrador_app());

create policy usuarios_app_delete_admin
on public.usuarios_app
for delete
to authenticated
using (public.es_administrador_app());

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.usuarios_app to authenticated;
grant select on public.usuarios_app to anon;

notify pgrst, 'reload schema';

select correo, rol, estado
from public.usuarios_app
order by correo;
