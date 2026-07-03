-- ============================================================================
-- 25_reglas_avanzadas_alertas.sql
-- Hace OPERATIVAS y LOGICAS las reglas de inventario/franquiciado que no entran
-- en la prioridad del pedido: generan ALERTAS calculadas desde los datos reales,
-- leyendo sus parametros (condicion JSON) y solo si la regla esta activa.
--
--   R5  Inventario por agotarse        -> alerta de material (preventiva)
--   R8  Franquiciado alta frecuencia   -> alerta por franquiciado
--   R10 Material critico multifranquiciado -> alerta de material
--   R11 Material no planificable NC    -> alerta de pedido
--
-- R7 "Monto de facturacion por zona" se DESACTIVA: no existe fuente de monto de
-- facturacion ni zona en `pedidos`. Queda registrada para activarse cuando se
-- cargue esa fuente.
--
-- La funcion es idempotente: inserta lo que falta y cierra lo que ya no aplica.
-- ============================================================================

-- R7 sin fuente de datos: se desactiva (queda en el catalogo).
update public.reglas_negocio
set estado = 'inactiva', activo = false
where nombre = 'Monto de facturacion por zona';

create or replace function public.evaluar_reglas_negocio_avanzadas()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r5 integer := 0;
  v_r8 integer := 0;
  v_r10 integer := 0;
  v_r11 integer := 0;
  porcentaje numeric := public.parametro_regla_numero('Inventario por agotarse', 'porcentajeAlerta', 20);
  factor_prom numeric := public.parametro_regla_numero('Franquiciado alta frecuencia', 'factorPromedio', 1);
  min_fq integer := public.parametro_regla_numero('Material critico multifranquiciado', 'minFranquiciados', 5)::integer;
  peso_r5 integer := public.peso_regla_activa('Inventario por agotarse');
  peso_r8 integer := public.peso_regla_activa('Franquiciado alta frecuencia');
  peso_r10 integer := public.peso_regla_activa('Material critico multifranquiciado');
  peso_r11 integer := public.peso_regla_activa('Material no planificable NC');
begin
  -- ===================== R5 Inventario por agotarse =====================
  if peso_r5 > 0 then
    -- cerrar las que ya se recuperaron
    update public.alertas a
    set estado = 'cerrada'
    where a.tipo_alerta = 'inventario_por_agotarse'
      and a.estado in ('activa', 'revisada')
      and not exists (
        select 1 from public.materiales_operativos_v v
        join public.materiales m on m.codigo_material = v.codigo_material
        where m.id = a.material_id
          and coalesce(v.stock_objetivo_material, 0) > 0
          and v.stock_disponible > 0
          and v.stock_disponible <= (porcentaje / 100.0) * v.stock_objetivo_material
      );

    insert into public.alertas (material_id, tipo_alerta, nivel, mensaje, estado, responsable)
    select m.id, 'inventario_por_agotarse', 'media',
      'Inventario por agotarse: ' || v.codigo_material || ' ' || coalesce(v.nombre_material, '')
        || ' (disponible ' || v.stock_disponible || ', umbral ' || round((porcentaje / 100.0) * v.stock_objetivo_material) || ').',
      'activa', 'Departamento de inventario'
    from public.materiales_operativos_v v
    join public.materiales m on m.codigo_material = v.codigo_material
    where coalesce(v.demanda_bodega_fq, 0) > 0
      and coalesce(v.stock_objetivo_material, 0) > 0
      and v.stock_disponible > 0
      and v.stock_disponible <= (porcentaje / 100.0) * v.stock_objetivo_material
      and not exists (
        select 1 from public.alertas a
        where a.material_id = m.id and a.tipo_alerta = 'inventario_por_agotarse'
          and a.estado in ('activa', 'revisada')
      );
    get diagnostics v_r5 = row_count;
  end if;

  -- ===================== R10 Material multifranquiciado =====================
  if peso_r10 > 0 then
    update public.alertas a
    set estado = 'cerrada'
    where a.tipo_alerta = 'material_multifranquiciado'
      and a.estado in ('activa', 'revisada')
      and not exists (
        select 1 from public.pedidos p
        where p.material_id = a.material_id
          and p.estado not in ('entregado', 'cancelado', 'rechazado')
        group by p.material_id
        having count(distinct p.cedula_solicitante) > min_fq
      );

    insert into public.alertas (material_id, tipo_alerta, nivel, mensaje, estado, responsable)
    select p.material_id, 'material_multifranquiciado', 'critica',
      'Demanda critica detectada: el material ' || coalesce(max(p.material), '') ||
      ' lo solicitan ' || count(distinct p.cedula_solicitante) || ' franquiciados.',
      'activa', 'Operacion'
    from public.pedidos p
    where p.estado not in ('entregado', 'cancelado', 'rechazado')
      and p.material_id is not null
    group by p.material_id
    having count(distinct p.cedula_solicitante) > min_fq
      and not exists (
        select 1 from public.alertas a
        where a.material_id = p.material_id and a.tipo_alerta = 'material_multifranquiciado'
          and a.estado in ('activa', 'revisada')
      );
    get diagnostics v_r10 = row_count;
  end if;

  -- ===================== R11 Material no planificable NC =====================
  if peso_r11 > 0 then
    update public.alertas a
    set estado = 'cerrada'
    where a.tipo_alerta = 'material_no_planificable'
      and a.estado in ('activa', 'revisada')
      and not exists (
        select 1 from public.pedidos p
        join public.materiales m on m.id = p.material_id
        join public.materiales_operativos_v v on v.codigo_material = m.codigo_material
        where p.id = a.pedido_id
          and p.estado not in ('entregado', 'cancelado', 'rechazado')
          and v.estado_planificable ilike '%no%planific%'
      );

    insert into public.alertas (pedido_id, material_id, tipo_alerta, nivel, mensaje, estado, responsable)
    select p.id, p.material_id, 'material_no_planificable', 'alta',
      'Material no se planifica, NC inmediata: pedido ' || coalesce(p.codigo_consulta, p.codigo)
        || ' de ' || coalesce(p.material, 'material'),
      'activa', 'Operacion'
    from public.pedidos p
    join public.materiales m on m.id = p.material_id
    join public.materiales_operativos_v v on v.codigo_material = m.codigo_material
    where p.estado not in ('entregado', 'cancelado', 'rechazado')
      and v.estado_planificable ilike '%no%planific%'
      and not exists (
        select 1 from public.alertas a
        where a.pedido_id = p.id and a.tipo_alerta = 'material_no_planificable'
          and a.estado in ('activa', 'revisada')
      );
    get diagnostics v_r11 = row_count;
  end if;

  -- ===================== R8 Franquiciado alta frecuencia =====================
  if peso_r8 > 0 then
    with por_fq as (
      select
        cedula_solicitante,
        max(solicitante) as nombre,
        count(*) filter (where date_trunc('month', fecha_solicitud) = date_trunc('month', current_date)) as mes_actual,
        count(*) filter (where date_trunc('month', fecha_solicitud) < date_trunc('month', current_date)) as historicos,
        greatest(1, count(distinct date_trunc('month', fecha_solicitud))
          filter (where date_trunc('month', fecha_solicitud) < date_trunc('month', current_date))) as meses_hist
      from public.pedidos
      where cedula_solicitante is not null and fecha_solicitud is not null
      group by cedula_solicitante
    )
    insert into public.alertas (tipo_alerta, nivel, mensaje, estado, responsable)
    select 'franquiciado_alta_frecuencia', 'media',
      'Incremento de demanda detectado: franquiciado ' || coalesce(nombre, cedula_solicitante)
        || ' (' || cedula_solicitante || ') con ' || mes_actual || ' pedidos este mes vs promedio '
        || round(historicos::numeric / meses_hist, 1) || '.',
      'activa', 'Operacion'
    from por_fq
    where mes_actual >= 2
      and mes_actual > factor_prom * (historicos::numeric / meses_hist)
      and not exists (
        select 1 from public.alertas a
        where a.tipo_alerta = 'franquiciado_alta_frecuencia'
          and a.estado in ('activa', 'revisada')
          and a.mensaje ilike '%(' || cedula_solicitante || ')%'
      );
    get diagnostics v_r8 = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'inventario_por_agotarse', v_r5,
    'material_multifranquiciado', v_r10,
    'material_no_planificable', v_r11,
    'franquiciado_alta_frecuencia', v_r8
  );
end;
$$;

grant execute on function public.evaluar_reglas_negocio_avanzadas() to anon, authenticated;

notify pgrst, 'reload schema';
