-- ============================================================================
-- 22_reglas_condicion_json.sql
-- Deja las 4 reglas parametrizables 100% coherentes: guarda sus parametros como
-- JSON en `condicion` (que es lo que leen el motor SQL y prioridad.ts).
-- ----------------------------------------------------------------------------
-- POR QUE: hoy esas reglas tienen una descripcion de texto en `condicion`
-- (ej. "cantidad_despacho > 0"), no JSON, asi que el motor cae a los parametros
-- por defecto hasta que editas la regla en la pantalla Reglas. Esto siembra el
-- JSON con los valores por defecto SIN pisar reglas que ya hayas personalizado
-- (solo cambia las que aun no tienen JSON). La descripcion legible se conserva
-- en las columnas `criterio`, `descripcion` y `efecto`.
-- Idempotente y seguro.
-- ============================================================================

update public.reglas_negocio
set condicion = '{"cantidadMinima":1,"cantidadAlta":100,"cantidadCritica":500}'
where nombre = 'Cantidad pendiente ERP'
  and (condicion is null or left(btrim(condicion), 1) <> '{');

update public.reglas_negocio
set condicion = '{"notasMinimas":1,"notasCriticas":2}'
where nombre = 'Nota de credito pendiente'
  and (condicion is null or left(btrim(condicion), 1) <> '{');

update public.reglas_negocio
set condicion = '{"diasSeguimiento":14,"diasCriticos":30,"diasProximos":2,"diasRetrasoCritico":60}'
where nombre = 'Antiguedad del pedido'
  and (condicion is null or left(btrim(condicion), 1) <> '{');

update public.reglas_negocio
set condicion = '{"valorRelevante":1000,"valorAlto":3000,"valorCritico":5000}'
where nombre = 'Valor pendiente'
  and (condicion is null or left(btrim(condicion), 1) <> '{');

notify pgrst, 'reload schema';

-- ============================================================================
-- COLUMNAS LEGACY DE public.pedidos  (NO incluidas arriba a proposito)
-- ----------------------------------------------------------------------------
-- Columnas que el tipo TS `Pedido` no usa: tipo_pedido, fecha_pedido,
-- fecha_requerida, prioridad (texto), observaciones.
--
-- NO se pueden borrar directamente: la funcion VIVA
-- public.refrescar_prototipo_bodega_fq() todavia las ESCRIBE al refrescar
-- pedidos. Para quitarlas sin romper nada hay que, en este orden:
--   1) Editar refrescar_prototipo_bodega_fq() para que deje de insertar/actualizar
--      esas 5 columnas.
--   2) Recien entonces:
--        alter table public.pedidos
--          drop column if exists tipo_pedido,
--          drop column if exists fecha_pedido,
--          drop column if exists fecha_requerida,
--          drop column if exists prioridad,
--          drop column if exists observaciones;
--
-- Es un cambio mas delicado (toca una funcion central). Si quieres, lo preparo
-- aparte con la version corregida de refrescar_prototipo_bodega_fq().
-- ============================================================================
