-- Reparacion segura posterior a ejecuciones parciales en SQL Editor.
-- No borra datos operativos. No limpia inventario, pedidos, alertas ni reportes.
-- Objetivo:
--   1. Recuperar usuarios internos de la aplicacion.
--   2. Desbloquear lectura/escritura desde la app para tablas existentes.
--   3. Recargar cache de PostgREST.

create extension if not exists pgcrypto;

create table if not exists public.usuarios_app (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  correo text not null,
  rol text not null default 'administrador',
  estado text not null default 'activo',
  created_at timestamptz not null default now()
);

alter table public.usuarios_app add column if not exists id uuid default gen_random_uuid();
alter table public.usuarios_app add column if not exists nombre text;
alter table public.usuarios_app add column if not exists correo text;
alter table public.usuarios_app add column if not exists rol text default 'administrador';
alter table public.usuarios_app add column if not exists estado text default 'activo';
alter table public.usuarios_app add column if not exists created_at timestamptz default now();

update public.usuarios_app
set
  nombre = coalesce(nullif(nombre, ''), 'Usuario interno'),
  rol = case
    when rol in ('administrador', 'suministrador', 'bodega') then rol
    else 'administrador'
  end,
  estado = case
    when estado in ('activo', 'inactivo') then estado
    else 'activo'
  end,
  created_at = coalesce(created_at, now())
where nombre is null
   or rol is null
   or estado is null
   or created_at is null
   or rol not in ('administrador', 'suministrador', 'bodega')
   or estado not in ('activo', 'inactivo');

with usuarios_base(nombre, correo, rol, estado) as (
  values
    ('Joel Administrador', 'joelobre123@gmail.com', 'administrador', 'activo'),
    ('Bodega', 'joelobr123@gmail.com', 'bodega', 'activo'),
    ('Suministrador', 'joel_obregon@hotmail.com', 'suministrador', 'activo'),
    ('Administrador', 'admin@disensa.local', 'administrador', 'activo')
)
update public.usuarios_app destino
set
  nombre = origen.nombre,
  rol = origen.rol,
  estado = origen.estado
from usuarios_base origen
where lower(destino.correo) = lower(origen.correo);

with usuarios_base(nombre, correo, rol, estado) as (
  values
    ('Joel Administrador', 'joelobre123@gmail.com', 'administrador', 'activo'),
    ('Bodega', 'joelobr123@gmail.com', 'bodega', 'activo'),
    ('Suministrador', 'joel_obregon@hotmail.com', 'suministrador', 'activo'),
    ('Administrador', 'admin@disensa.local', 'administrador', 'activo')
)
insert into public.usuarios_app (nombre, correo, rol, estado)
select origen.nombre, origen.correo, origen.rol, origen.estado
from usuarios_base origen
where not exists (
  select 1
  from public.usuarios_app destino
  where lower(destino.correo) = lower(origen.correo)
);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.usuarios_app to anon, authenticated;
alter table public.usuarios_app disable row level security;

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
    'alertas',
    'reglas_negocio',
    'notificaciones_correo',
    'reportes_operativos',
    'reportes_franquiciado',
    'materiales',
    'pedidos',
    'movimientos_inventario',
    'auditoria'
  ]
  loop
    if to_regclass('public.' || tabla) is not null then
      execute format('alter table public.%I disable row level security', tabla);
      execute format('grant select, insert, update, delete on public.%I to anon, authenticated', tabla);
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
    'otif_operativo_v'
  ]
  loop
    if to_regclass('public.' || vista) is not null then
      execute format('grant select on public.%I to anon, authenticated', vista);
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
    to_regprocedure('public.despachar_pedido_seguro(uuid, uuid, text)'),
    to_regprocedure('public.despachar_pedido_operativo_seguro(uuid, uuid, text, text, numeric)'),
    to_regprocedure('public.registrar_alerta_stock_material(uuid, uuid, integer, text)'),
    to_regprocedure('public.sincronizar_alertas_resueltas_por_stock()')
  ]
  loop
    if funcion is not null then
      execute format('grant execute on function %s to anon, authenticated', funcion);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

select correo, rol, estado
from public.usuarios_app
where lower(correo) in (
  'joelobre123@gmail.com',
  'joelobr123@gmail.com',
  'joel_obregon@hotmail.com',
  'admin@disensa.local'
)
order by correo;
