-- Migracion 35: autenticacion real de retrasos por SLA del cliente
-- Fuente: SOLO la Hoja1 del Excel "OTIF SUMINISTRADOR" (SLA | Cliente | Subdivision).
-- Se importan unicamente los 22 clientes que existen en la BD
-- (match codigo_cliente = pedidos.cedula_solicitante).
--
-- fecha_compromiso del pedido = proximo dia de entrega segun el SLA desde la fecha
-- del pedido (dia(s) de semana o frecuencia "CADA N HORAS"). Un trigger lo fija al
-- crear/actualizar el pedido y se hace backfill de los existentes.
--
-- Semaforo (en el front, lib/semaforoOperativo.ts) sobre esa fecha:
--   verde   : hasta el dia planificado
--   amarillo: hasta la reagendacion (+7 dias)
--   naranja : prioridad alta, hasta el mes (+30 dias)
--   rojo    : prioridad critica, pasado el mes

create table if not exists public.cliente_sla (
  codigo_cliente text primary key,
  sla_texto text not null,
  dias_semana int[] not null default '{}',
  horas_frecuencia int,
  subdivision text,
  updated_at timestamptz not null default now()
);

alter table public.cliente_sla enable row level security;
drop policy if exists p_cliente_sla_read on public.cliente_sla;
create policy p_cliente_sla_read on public.cliente_sla for select to anon, authenticated using (true);

insert into public.cliente_sla (codigo_cliente, sla_texto, dias_semana, horas_frecuencia, subdivision) values
  ('6100595','MARTES S1 y S4','{2}',null,'LOJA FORANEO'),
  ('6106013','MARTES','{2}',null,'LOJA COMUN'),
  ('6132916','LUNES','{1}',null,'LOS RIOS / BOLIVAR BAJO'),
  ('6133635','MARTES y JUEVES','{2,4}',null,'GUAYAS SUR TRONCAL'),
  ('6133957','VIERNES','{5}',null,'MANABI CENTRO / SUR'),
  ('6134752','CADA 48 HORAS','{}',48,'GUAYAS ESTE / CHIMBORAZO'),
  ('6135099','VIERNES','{5}',null,'MANABI CENTRO / SUR'),
  ('6188281','VIERNES','{5}',null,'MANABI CENTRO / SUR'),
  ('6189299','LUNES S2 y S4','{1}',null,'MANABI FORANEO'),
  ('6192102','MIERCOLES y VIERNES','{3,5}',null,'QUITO SUR'),
  ('6192538','CADA 48 HORAS','{}',48,'GUAYAS NORTE AURORA'),
  ('6195848','CADA 48 HORAS','{}',48,'EL ORO'),
  ('6196780','VIERNES','{5}',null,'MANABI CENTRO / SUR'),
  ('6197702','LUNES S2 y S4','{1}',null,'MANABI FORANEO'),
  ('6198642','MARTES y JUEVES','{2,4}',null,'GUAYAS OESTE - SANTA ELENA'),
  ('6198913','CADA 48 HORAS','{}',48,'EL ORO'),
  ('6199150','VIERNES y LUNES','{1,5}',null,'QUITO NORTE'),
  ('6199649','MARTES y JUEVES','{2,4}',null,'GUAYAS OESTE - SANTA ELENA'),
  ('6321212','CADA 24 HORAS','{}',24,'GRAN GUAYAQUIL'),
  ('6321759','LUNES','{1}',null,'LOS RIOS / BOLIVAR BAJO'),
  ('6322339','VIERNES','{5}',null,'MANABI CENTRO / SUR'),
  ('6322746','MARTES S2','{2}',null,'LOJA - ZAMORA NORTE')
on conflict (codigo_cliente) do update set
  sla_texto=excluded.sla_texto, dias_semana=excluded.dias_semana,
  horas_frecuencia=excluded.horas_frecuencia, subdivision=excluded.subdivision, updated_at=now();

create or replace function public.fecha_compromiso_sla(p_codigo text, p_desde timestamptz)
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare v_dias int[]; v_horas int; v_base date; v_d date; i int;
begin
  if p_codigo is null then return p_desde; end if;
  select dias_semana, horas_frecuencia into v_dias, v_horas
  from public.cliente_sla where codigo_cliente = p_codigo;
  if not found then return p_desde; end if;
  if v_horas is not null then return p_desde + make_interval(hours => v_horas); end if;
  if array_length(v_dias, 1) is null then return p_desde; end if;
  v_base := (p_desde at time zone 'America/Guayaquil')::date;
  for i in 0..13 loop
    v_d := v_base + i;
    if extract(dow from v_d)::int = any (v_dias) then
      return (v_d::timestamp) at time zone 'America/Guayaquil';
    end if;
  end loop;
  return p_desde;
end; $$;

create or replace function public.set_fecha_compromiso_sla()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cedula_solicitante is not null
     and exists (select 1 from public.cliente_sla where codigo_cliente = new.cedula_solicitante) then
    new.fecha_compromiso := public.fecha_compromiso_sla(
      new.cedula_solicitante, coalesce(new.fecha_solicitud, new.created_at, now()));
  end if;
  return new;
end; $$;

drop trigger if exists pedidos_fecha_compromiso_sla on public.pedidos;
create trigger pedidos_fecha_compromiso_sla
before insert or update of cedula_solicitante, fecha_solicitud
on public.pedidos for each row execute function public.set_fecha_compromiso_sla();

update public.pedidos p
set fecha_compromiso = public.fecha_compromiso_sla(
  p.cedula_solicitante, coalesce(p.fecha_solicitud, p.created_at, now()))
where exists (select 1 from public.cliente_sla c where c.codigo_cliente = p.cedula_solicitante);
