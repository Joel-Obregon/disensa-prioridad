-- Recuperacion de login interno.
-- Ejecutar en Supabase SQL Editor si Auth entra pero el prototipo rechaza el acceso
-- por falta de perfil activo en public.usuarios_app.

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
  ('Suministrador', 'joel_obregon@hotmail.com', 'suministrador', 'activo'),
  ('Administrador', 'admin@disensa.local', 'administrador', 'activo')
on conflict (correo) do update
set
  nombre = excluded.nombre,
  rol = excluded.rol,
  estado = 'activo';

grant select, insert, update, delete on public.usuarios_app to anon, authenticated;
alter table public.usuarios_app disable row level security;

notify pgrst, 'reload schema';
