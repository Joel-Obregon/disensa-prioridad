-- Motor de reglas parametrizables para priorizacion de pedidos.
-- Ejecutar despues de schema_2_0_base_nueva.sql.
--
-- La interfaz guarda los parametros funcionales dentro de reglas_negocio.condicion
-- como JSON. Este parche hace que la funcion SQL use esos mismos parametros,
-- respete reglas inactivas y permita recalcular el prototipo despues de un cambio.

create or replace function public.peso_regla_activa(
  p_nombre text
)
returns integer
language sql
stable
as $$
  select coalesce(
    max(
      case
        when estado = 'activa' and coalesce(activo, true) then peso
        else 0
      end
    ),
    0
  )::integer
  from public.reglas_negocio
  where nombre = p_nombre;
$$;

create or replace function public.parametro_regla_numero(
  p_nombre text,
  p_clave text,
  p_defecto numeric
)
returns numeric
language plpgsql
stable
as $$
declare
  v_condicion text;
  v_parametros jsonb;
  v_valor numeric;
begin
  select condicion
  into v_condicion
  from public.reglas_negocio
  where nombre = p_nombre
  limit 1;

  if v_condicion is null or left(ltrim(v_condicion), 1) <> '{' then
    return p_defecto;
  end if;

  begin
    v_parametros := v_condicion::jsonb;
    v_valor := nullif(v_parametros ->> p_clave, '')::numeric;
  exception
    when others then
      return p_defecto;
  end;

  return greatest(0, coalesce(v_valor, p_defecto));
end;
$$;

create or replace function public.prioridad_pedido_erp(
  p_status_erp text,
  p_estado_operativo text,
  p_valor_pendiente numeric,
  p_fecha_pedido date,
  p_fecha_objetivo date,
  p_nc_pendientes integer,
  p_cantidad_pendiente numeric,
  p_tiene_gestion_stock boolean
)
returns integer
language plpgsql
stable
as $$
declare
  puntaje integer := 0;
  dias_pedido integer := 0;
  dias_objetivo integer := 999;
  peso_cant_pend integer := public.peso_regla_activa('Cantidad pendiente ERP');
  peso_nota_cred integer := public.peso_regla_activa('Nota de credito pendiente');
  peso_antiguedad integer := public.peso_regla_activa('Antiguedad del pedido');
  peso_valor_pend integer := public.peso_regla_activa('Valor pendiente');
  peso_cond_mat integer := public.peso_regla_activa('Condicion de material');
  cantidad_minima numeric := public.parametro_regla_numero(
    'Cantidad pendiente ERP',
    'cantidadMinima',
    1
  );
  cantidad_alta numeric := public.parametro_regla_numero(
    'Cantidad pendiente ERP',
    'cantidadAlta',
    100
  );
  cantidad_critica numeric := public.parametro_regla_numero(
    'Cantidad pendiente ERP',
    'cantidadCritica',
    500
  );
  notas_minimas numeric := public.parametro_regla_numero(
    'Nota de credito pendiente',
    'notasMinimas',
    1
  );
  notas_criticas numeric := public.parametro_regla_numero(
    'Nota de credito pendiente',
    'notasCriticas',
    2
  );
  dias_seguimiento integer := public.parametro_regla_numero(
    'Antiguedad del pedido',
    'diasSeguimiento',
    14
  )::integer;
  dias_criticos integer := public.parametro_regla_numero(
    'Antiguedad del pedido',
    'diasCriticos',
    30
  )::integer;
  dias_proximos integer := public.parametro_regla_numero(
    'Antiguedad del pedido',
    'diasProximos',
    2
  )::integer;
  dias_retraso_critico integer := public.parametro_regla_numero(
    'Antiguedad del pedido',
    'diasRetrasoCritico',
    60
  )::integer;
  valor_relevante numeric := public.parametro_regla_numero(
    'Valor pendiente',
    'valorRelevante',
    1000
  );
  valor_alto numeric := public.parametro_regla_numero(
    'Valor pendiente',
    'valorAlto',
    3000
  );
  valor_critico numeric := public.parametro_regla_numero(
    'Valor pendiente',
    'valorCritico',
    5000
  );
begin
  if p_fecha_pedido is not null then
    dias_pedido := greatest(0, current_date - p_fecha_pedido);
  end if;

  if p_fecha_objetivo is not null then
    dias_objetivo := p_fecha_objetivo - current_date;
  end if;

  puntaje := puntaje + case coalesce(p_estado_operativo, 'pendiente')
    when 'sin_stock' then 40
    when 'retrasado' then 38
    when 'en_revision' then 32
    when 'pendiente' then 26
    when 'aprobado' then 18
    when 'en_despacho' then 14
    else 0
  end;

  if coalesce(p_status_erp, '') ilike '%pendiente por despacho%' then
    puntaje := puntaje + 20;
  end if;

  if peso_nota_cred > 0
    and coalesce(p_nc_pendientes, 0) >= notas_criticas then
    puntaje := puntaje + least(40, peso_nota_cred + 5);
  elsif peso_nota_cred > 0
    and coalesce(p_nc_pendientes, 0) >= notas_minimas then
    puntaje := puntaje + peso_nota_cred;
  end if;

  if peso_cant_pend > 0
    and coalesce(p_cantidad_pendiente, 0) >= cantidad_minima then
    if coalesce(p_cantidad_pendiente, 0) >= cantidad_critica then
      puntaje := puntaje + peso_cant_pend;
    elsif coalesce(p_cantidad_pendiente, 0) >= cantidad_alta then
      puntaje := puntaje + round(peso_cant_pend * 0.75)::integer;
    else
      puntaje := puntaje + greatest(5, round(peso_cant_pend * 0.35)::integer);
    end if;
  end if;

  if peso_valor_pend > 0 and coalesce(p_valor_pendiente, 0) >= valor_critico then
    puntaje := puntaje + peso_valor_pend + 5;
  elsif peso_valor_pend > 0 and coalesce(p_valor_pendiente, 0) >= valor_alto then
    puntaje := puntaje + peso_valor_pend;
  elsif peso_valor_pend > 0 and coalesce(p_valor_pendiente, 0) >= valor_relevante then
    puntaje := puntaje + round(peso_valor_pend * 0.7)::integer;
  elsif peso_valor_pend > 0 and coalesce(p_valor_pendiente, 0) > 0 then
    puntaje := puntaje + round(peso_valor_pend * 0.35)::integer;
  end if;

  if p_tiene_gestion_stock and peso_cond_mat > 0 then
    puntaje := puntaje + greatest(0, peso_cond_mat - 7);
  end if;

  if peso_antiguedad > 0 then
    if dias_objetivo < -dias_retraso_critico then
      puntaje := puntaje + 26;
    elsif dias_objetivo < 0 then
      puntaje := puntaje + 22;
    elsif dias_objetivo <= dias_proximos then
      puntaje := puntaje + 14;
    end if;

    if dias_pedido >= dias_criticos then
      puntaje := puntaje + greatest(0, peso_antiguedad - 2);
    elsif dias_pedido >= dias_seguimiento then
      puntaje := puntaje + round(peso_antiguedad * 0.5)::integer;
    end if;
  end if;

  return least(100, greatest(0, puntaje));
end;
$$;

create or replace function public.recalcular_pedidos_reglas_parametrizables()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_evaluables integer := 0;
begin
  select count(*) into v_evaluables
  from public.pedidos
  where estado not in ('entregado', 'cancelado', 'rechazado');

  return jsonb_build_object(
    'ok',
    true,
    'pedidos_evaluables',
    coalesce(v_evaluables, 0),
    'detalle',
    'Reglas guardadas. La app recalcula la prioridad en pantalla sin regenerar alertas masivas.'
  );
end;
$$;

create or replace function public.aplicar_motor_reglas_parametrizables()
returns jsonb
language plpgsql
security definer
as $$
begin
  return public.recalcular_pedidos_reglas_parametrizables();
end;
$$;

grant execute on function public.peso_regla_activa(text) to anon, authenticated;
grant execute on function public.parametro_regla_numero(text, text, numeric) to anon, authenticated;
grant execute on function public.prioridad_pedido_erp(
  text,
  text,
  numeric,
  date,
  date,
  integer,
  numeric,
  boolean
) to anon, authenticated;
grant execute on function public.aplicar_motor_reglas_parametrizables() to authenticated;
grant execute on function public.recalcular_pedidos_reglas_parametrizables() to authenticated;

notify pgrst, 'reload schema';
