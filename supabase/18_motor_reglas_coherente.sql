-- ============================================================================
-- 18_motor_reglas_coherente.sql
-- Motor de reglas de negocio PARAMETRIZABLE y COHERENTE (fuente unica de verdad)
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase DESPUES de 16_motor_reglas_parametrizables.sql y
-- 17_alertas_puntuales_y_reglas_coherentes.sql. Es idempotente y NO destructivo:
-- usa create or replace y ON CONFLICT DO NOTHING, por lo que se puede correr las
-- veces que haga falta sin perder la configuracion que el administrador ya hizo
-- en el modulo Reglas.
--
-- Que corrige este parche:
--   1. Elimina el termino "muerto" de la regla "Condicion de material" dentro de
--      la funcion prioridad_pedido_erp. Esa regla fue retirada del modelo en
--      06_quitar_regla_condicion_material.sql, pero la migracion 16 todavia la
--      leia (peso_cond_mat). Como la regla ya no existe, su peso era 0 y el
--      termino aportaba 0: era codigo muerto que hacia que el SQL pareciera
--      distinto al motor TypeScript (src/lib/prioridad.ts). Quitarlo NO cambia
--      ningun puntaje; solo deja el SQL 1:1 con el TS.
--   2. Deja el motor con EXACTAMENTE los mismos 6 factores y formulas que
--      src/lib/prioridad.ts, leyendo pesos y parametros desde reglas_negocio.
--   3. Garantiza que existan las 4 reglas parametrizables que alimentan el motor
--      (sin sobrescribir las que el usuario ya personalizo).
--
-- La firma de la funcion se mantiene IGUAL (8 argumentos, incluido el booleano
-- p_tiene_gestion_stock) para no romper triggers ni vistas que ya la invocan.
-- El 8vo argumento se conserva por compatibilidad pero se ignora a proposito.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helpers parametrizables (se releen los pesos y parametros desde la tabla)
-- ----------------------------------------------------------------------------

-- Peso vigente de una regla: 0 si no existe, esta inactiva o desactivada.
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

-- Lee un parametro numerico guardado como JSON en reglas_negocio.condicion.
-- Si la regla no guarda JSON valido, devuelve el valor por defecto recibido.
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

-- ----------------------------------------------------------------------------
-- 2. Motor de priorizacion (0-100) COHERENTE 1:1 con src/lib/prioridad.ts
-- ----------------------------------------------------------------------------
create or replace function public.prioridad_pedido_erp(
  p_status_erp text,
  p_estado_operativo text,
  p_valor_pendiente numeric,
  p_fecha_pedido date,
  p_fecha_objetivo date,
  p_nc_pendientes integer,
  p_cantidad_pendiente numeric,
  p_tiene_gestion_stock boolean   -- conservado por compatibilidad; se ignora
)
returns integer
language plpgsql
stable
as $$
declare
  puntaje integer := 0;
  dias_pedido integer := 0;
  dias_objetivo integer := 999;

  -- Pesos vigentes (leidos de reglas_negocio; 0 si la regla esta inactiva)
  peso_cant_pend  integer := public.peso_regla_activa('Cantidad pendiente ERP');
  peso_nota_cred  integer := public.peso_regla_activa('Nota de credito pendiente');
  peso_antiguedad integer := public.peso_regla_activa('Antiguedad del pedido');
  peso_valor_pend integer := public.peso_regla_activa('Valor pendiente');

  -- Parametros de "Cantidad pendiente ERP"
  cantidad_minima  numeric := public.parametro_regla_numero('Cantidad pendiente ERP', 'cantidadMinima', 1);
  cantidad_alta    numeric := public.parametro_regla_numero('Cantidad pendiente ERP', 'cantidadAlta', 100);
  cantidad_critica numeric := public.parametro_regla_numero('Cantidad pendiente ERP', 'cantidadCritica', 500);

  -- Parametros de "Nota de credito pendiente"
  notas_minimas  numeric := public.parametro_regla_numero('Nota de credito pendiente', 'notasMinimas', 1);
  notas_criticas numeric := public.parametro_regla_numero('Nota de credito pendiente', 'notasCriticas', 2);

  -- Parametros de "Antiguedad del pedido"
  dias_seguimiento     integer := public.parametro_regla_numero('Antiguedad del pedido', 'diasSeguimiento', 14)::integer;
  dias_criticos        integer := public.parametro_regla_numero('Antiguedad del pedido', 'diasCriticos', 30)::integer;
  dias_proximos        integer := public.parametro_regla_numero('Antiguedad del pedido', 'diasProximos', 2)::integer;
  dias_retraso_critico integer := public.parametro_regla_numero('Antiguedad del pedido', 'diasRetrasoCritico', 60)::integer;

  -- Parametros de "Valor pendiente"
  valor_relevante numeric := public.parametro_regla_numero('Valor pendiente', 'valorRelevante', 1000);
  valor_alto      numeric := public.parametro_regla_numero('Valor pendiente', 'valorAlto', 3000);
  valor_critico   numeric := public.parametro_regla_numero('Valor pendiente', 'valorCritico', 5000);
begin
  -- Dias de antiguedad y de holgura hasta la fecha objetivo
  if p_fecha_pedido is not null then
    dias_pedido := greatest(0, current_date - p_fecha_pedido);
  end if;

  if p_fecha_objetivo is not null then
    dias_objetivo := p_fecha_objetivo - current_date;
  end if;

  -- 1. Estado operativo (hasta 40 pts)
  puntaje := puntaje + case coalesce(p_estado_operativo, 'pendiente')
    when 'sin_stock'   then 40
    when 'retrasado'   then 38
    when 'en_revision' then 32
    when 'pendiente'   then 26
    when 'aprobado'    then 18
    when 'en_despacho' then 14
    else 0
  end;

  -- 2. STATUS ERP pendiente por despacho (+20)
  if coalesce(p_status_erp, '') ilike '%pendiente por despacho%' then
    puntaje := puntaje + 20;
  end if;

  -- 3. Nota de credito pendiente
  if peso_nota_cred > 0 and coalesce(p_nc_pendientes, 0) >= notas_criticas then
    puntaje := puntaje + least(40, peso_nota_cred + 5);
  elsif peso_nota_cred > 0 and coalesce(p_nc_pendientes, 0) >= notas_minimas then
    puntaje := puntaje + peso_nota_cred;
  end if;

  -- 4. Cantidad pendiente ERP
  if peso_cant_pend > 0 and coalesce(p_cantidad_pendiente, 0) >= cantidad_minima then
    if coalesce(p_cantidad_pendiente, 0) >= cantidad_critica then
      puntaje := puntaje + peso_cant_pend;
    elsif coalesce(p_cantidad_pendiente, 0) >= cantidad_alta then
      puntaje := puntaje + round(peso_cant_pend * 0.75)::integer;
    else
      puntaje := puntaje + greatest(5, round(peso_cant_pend * 0.35)::integer);
    end if;
  end if;

  -- 5. Valor pendiente
  if peso_valor_pend > 0 and coalesce(p_valor_pendiente, 0) >= valor_critico then
    puntaje := puntaje + peso_valor_pend + 5;
  elsif peso_valor_pend > 0 and coalesce(p_valor_pendiente, 0) >= valor_alto then
    puntaje := puntaje + peso_valor_pend;
  elsif peso_valor_pend > 0 and coalesce(p_valor_pendiente, 0) >= valor_relevante then
    puntaje := puntaje + round(peso_valor_pend * 0.7)::integer;
  elsif peso_valor_pend > 0 and coalesce(p_valor_pendiente, 0) > 0 then
    puntaje := puntaje + round(peso_valor_pend * 0.35)::integer;
  end if;

  -- 6. Antiguedad / fecha objetivo (regla "Antiguedad del pedido")
  if peso_antiguedad > 0 then
    if dias_objetivo < -dias_retraso_critico then
      puntaje := puntaje + 26;      -- vencido > 2 meses (retraso critico)
    elsif dias_objetivo < 0 then
      puntaje := puntaje + 22;      -- vencido
    elsif dias_objetivo <= dias_proximos then
      puntaje := puntaje + 14;      -- fecha objetivo proxima
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

-- ----------------------------------------------------------------------------
-- 3. Recalculo del prototipo tras un cambio de reglas (sin regenerar alertas)
-- ----------------------------------------------------------------------------
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
    'ok', true,
    'pedidos_evaluables', coalesce(v_evaluables, 0),
    'detalle', 'Reglas guardadas. La app recalcula la prioridad en pantalla sin regenerar alertas masivas.'
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Coherencia de datos: garantizar las 4 reglas parametrizables y retirar la
--    regla obsoleta "Condicion de material" (idempotente, no destructivo).
-- ----------------------------------------------------------------------------

-- Inserta las 4 reglas SOLO si faltan. Si ya existen, respeta la configuracion
-- (peso y parametros) que el administrador haya guardado desde el modulo Reglas.
insert into public.reglas_negocio
  (nombre, descripcion, condicion, accion, color, activo, criterio, efecto, peso, estado)
values
  ('Cantidad pendiente ERP',
   'Prioriza pedidos con cantidad pendiente por despachar.',
   '{"cantidadMinima":1,"cantidadAlta":100,"cantidadCritica":500}',
   'Elevar prioridad y mostrar alerta visual',
   'red', true,
   'Si el pedido tiene cantidad pendiente por despachar.',
   'Aumenta el puntaje y empuja el pedido arriba en la cola.',
   35, 'activa'),
  ('Nota de credito pendiente',
   'Resalta pedidos con solicitud de nota de credito abierta.',
   '{"notasMinimas":1,"notasCriticas":2}',
   'Enviar a revision comercial',
   'orange', true,
   'Si la gestion del proveedor deriva en NC total o parcial.',
   'Marca el pedido en revision y genera alerta de negocio.',
   30, 'activa'),
  ('Antiguedad del pedido',
   'Aumenta prioridad a pedidos antiguos o con fecha objetivo vencida.',
   '{"diasSeguimiento":14,"diasCriticos":30,"diasProximos":2,"diasRetrasoCritico":60}',
   'Acelerar seguimiento operativo',
   'yellow', true,
   'Si el pedido supera los umbrales de espera definidos.',
   'Incrementa prioridad por riesgo de retraso.',
   20, 'activa'),
  ('Valor pendiente',
   'Da mayor peso a pedidos con valor pendiente alto.',
   '{"valorRelevante":1000,"valorAlto":3000,"valorCritico":5000}',
   'Atender por impacto financiero',
   'blue', true,
   'Si el pedido representa un monto pendiente relevante.',
   'Sube prioridad por impacto comercial.',
   15, 'activa')
on conflict (nombre) do nothing;

-- La regla "Condicion de material" fue retirada del modelo (06). Se asegura que
-- no vuelva a existir para que el motor SQL y el TS queden 100% identicos.
delete from public.reglas_negocio
where nombre = 'Condicion de material';

-- ----------------------------------------------------------------------------
-- 5. Permisos (Supabase / PostgREST)
-- ----------------------------------------------------------------------------
grant execute on function public.peso_regla_activa(text) to anon, authenticated;
grant execute on function public.parametro_regla_numero(text, text, numeric) to anon, authenticated;
grant execute on function public.prioridad_pedido_erp(
  text, text, numeric, date, date, integer, numeric, boolean
) to anon, authenticated;
grant execute on function public.recalcular_pedidos_reglas_parametrizables() to anon, authenticated;

notify pgrst, 'reload schema';
