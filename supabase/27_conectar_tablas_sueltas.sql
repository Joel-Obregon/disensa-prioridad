-- ============================================================================
-- 27_conectar_tablas_sueltas.sql
-- Conecta al modelo las tablas que quedaban "sueltas" (sin FK) con relaciones
-- reales y con sentido de negocio, sin cambiar la aplicacion:
--   * alertas.regla_id      -> reglas_negocio(id)   (que regla origino la alerta)
--   * auditoria.usuario_id  -> usuarios_app(id)     (que usuario hizo la accion)
--   * sync_runs.usuario_id  -> usuarios_app(id)     (que usuario corrio la sync)
-- El FK se resuelve automaticamente por trigger (a partir del tipo de alerta y
-- del responsable/usuario en texto) y se backfillean los datos existentes.
-- ============================================================================

-- 1) Columnas nuevas (nullable)
alter table public.alertas    add column if not exists regla_id   uuid;
alter table public.auditoria  add column if not exists usuario_id uuid;
alter table public.sync_runs  add column if not exists usuario_id uuid;

-- 2) Indices para las FK
create index if not exists alertas_regla_id_idx    on public.alertas (regla_id);
create index if not exists auditoria_usuario_id_idx on public.auditoria (usuario_id);
create index if not exists sync_runs_usuario_id_idx on public.sync_runs (usuario_id);

-- 3) Llaves foraneas (idempotentes)
do $$
begin
  if not exists (select 1 from pg_constraint where conname='alertas_regla_id_fkey') then
    alter table public.alertas add constraint alertas_regla_id_fkey
      foreign key (regla_id) references public.reglas_negocio(id) on delete set null on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='auditoria_usuario_id_fkey') then
    alter table public.auditoria add constraint auditoria_usuario_id_fkey
      foreign key (usuario_id) references public.usuarios_app(id) on delete set null on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='sync_runs_usuario_id_fkey') then
    alter table public.sync_runs add constraint sync_runs_usuario_id_fkey
      foreign key (usuario_id) references public.usuarios_app(id) on delete set null on update cascade;
  end if;
end $$;

-- 4) Helpers de resolucion
create or replace function public.regla_por_tipo_alerta(p_tipo text)
returns uuid language sql stable set search_path = public as $$
  select id from public.reglas_negocio
  where nombre = case
    when p_tipo = 'inventario_por_agotarse' then 'Inventario por agotarse'
    when p_tipo = 'material_multifranquiciado' then 'Material critico multifranquiciado'
    when p_tipo = 'material_no_planificable' then 'Material no planificable NC'
    when p_tipo = 'franquiciado_alta_frecuencia' then 'Franquiciado alta frecuencia'
    when p_tipo = 'nota_credito_bodega_fq' then 'Franquiciado solicita NC'
    when p_tipo in ('priorizacion_bodega_fq','pedido_retrasado') then 'Pedido con entrega proxima'
    when p_tipo in ('falta_material_pedido','stock_agotado_planificable','material_sin_inventario') then 'Material sin existencia'
    when p_tipo in ('stock_bajo','faltante_bodega_fq') then 'Stock critico'
    else null
  end
  limit 1;
$$;

create or replace function public.usuario_por_texto(p_txt text)
returns uuid language sql stable set search_path = public as $$
  select id from public.usuarios_app
  where p_txt is not null and (correo = p_txt or nombre = p_txt)
  order by case when correo = p_txt then 0 else 1 end
  limit 1;
$$;

-- 5) Triggers que rellenan el FK automaticamente
create or replace function public.alertas_set_regla_trg()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.regla_id is null then
    new.regla_id := public.regla_por_tipo_alerta(new.tipo_alerta);
  end if;
  return new;
end; $$;
drop trigger if exists alertas_set_regla on public.alertas;
create trigger alertas_set_regla before insert or update of tipo_alerta on public.alertas
for each row execute function public.alertas_set_regla_trg();

create or replace function public.auditoria_set_usuario_trg()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.usuario_id is null then
    new.usuario_id := public.usuario_por_texto(new.responsable);
  end if;
  return new;
end; $$;
drop trigger if exists auditoria_set_usuario on public.auditoria;
create trigger auditoria_set_usuario before insert or update of responsable on public.auditoria
for each row execute function public.auditoria_set_usuario_trg();

create or replace function public.sync_runs_set_usuario_trg()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.usuario_id is null then
    new.usuario_id := public.usuario_por_texto(new.usuario);
  end if;
  return new;
end; $$;
drop trigger if exists sync_runs_set_usuario on public.sync_runs;
create trigger sync_runs_set_usuario before insert or update of usuario on public.sync_runs
for each row execute function public.sync_runs_set_usuario_trg();

-- 6) Backfill de datos existentes
update public.alertas   set regla_id   = public.regla_por_tipo_alerta(tipo_alerta) where regla_id is null;
update public.auditoria set usuario_id = public.usuario_por_texto(responsable)     where usuario_id is null;
update public.sync_runs set usuario_id = public.usuario_por_texto(usuario)         where usuario_id is null;

-- 7) Permisos
grant execute on function public.regla_por_tipo_alerta(text) to anon, authenticated;
grant execute on function public.usuario_por_texto(text) to anon, authenticated;

notify pgrst, 'reload schema';
