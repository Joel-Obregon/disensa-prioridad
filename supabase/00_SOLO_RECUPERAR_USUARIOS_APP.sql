-- Recuperacion minima de acceso interno.
-- Ejecuta este archivo COMPLETO en Supabase SQL Editor.
-- No borra inventario, pedidos, alertas, reportes ni reglas.

create extension if not exists pgcrypto;

create table if not exists public.usuarios_app (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  correo text not null,
  rol text not null default 'administrador',
  estado text not null default 'activo',
  created_at timestamptz not null default now()
);

alter table public.usuarios_app disable row level security;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.usuarios_app to anon, authenticated;

update public.usuarios_app
set nombre = 'Joel Administrador', rol = 'administrador', estado = 'activo'
where lower(correo) = 'joelobre123@gmail.com';

insert into public.usuarios_app (nombre, correo, rol, estado)
select 'Joel Administrador', 'joelobre123@gmail.com', 'administrador', 'activo'
where not exists (
  select 1 from public.usuarios_app where lower(correo) = 'joelobre123@gmail.com'
);

update public.usuarios_app
set nombre = 'Bodega', rol = 'bodega', estado = 'activo'
where lower(correo) = 'joelobr123@gmail.com';

insert into public.usuarios_app (nombre, correo, rol, estado)
select 'Bodega', 'joelobr123@gmail.com', 'bodega', 'activo'
where not exists (
  select 1 from public.usuarios_app where lower(correo) = 'joelobr123@gmail.com'
);

update public.usuarios_app
set nombre = 'Suministrador', rol = 'suministrador', estado = 'activo'
where lower(correo) = 'joel_obregon@hotmail.com';

insert into public.usuarios_app (nombre, correo, rol, estado)
select 'Suministrador', 'joel_obregon@hotmail.com', 'suministrador', 'activo'
where not exists (
  select 1 from public.usuarios_app where lower(correo) = 'joel_obregon@hotmail.com'
);

notify pgrst, 'reload schema';

select correo, rol, estado
from public.usuarios_app
order by correo;
