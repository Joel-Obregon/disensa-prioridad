-- ============================================================================
-- 24_reglas_negocio_nuevas.sql
-- Reemplaza el catalogo de reglas por las 11 nuevas, parametrizables y editables
-- desde el modulo Reglas. Las reglas anteriores se DESACTIVAN (no se borran).
-- ----------------------------------------------------------------------------
-- Parametros: se guardan como JSON en reglas_negocio.condicion y los leen el
-- motor (src/lib/prioridad.ts y la funcion SQL prioridad_pedido_erp) y las
-- alertas. Reejecutable: no pisa reglas ya personalizadas (ON CONFLICT DO NOTHING).
-- ============================================================================

-- 1) Insertar las 11 reglas nuevas (si faltan)
insert into public.reglas_negocio
  (nombre, descripcion, condicion, accion, color, activo, criterio, efecto, peso, estado, clave)
values
  ('Stock critico',
   'Si el inventario disponible de un material es menor o igual al stock minimo.',
   '{"factorMinimo":1}', 'Abastecimiento inmediato', 'red', true,
   'Stock disponible por debajo de la cantidad requerida del pedido.',
   'Material en nivel critico. Se requiere abastecimiento inmediato.', 40, 'activa', 'stock_critico'),

  ('Pedido con entrega proxima',
   'Pedido que debe entregarse dentro del SLA (proximas 24 h por defecto).',
   '{"diasEntrega":1}', 'Priorizar despacho', 'red', true,
   'Faltan diasEntrega dias o menos para la fecha comprometida (o ya vencio).',
   'Pedido proximo a vencer.', 40, 'activa', 'entrega_proxima'),

  ('Pedido pendiente prolongado',
   'Solicitudes que permanecen sin atencion demasiado tiempo.',
   '{"diasPendiente":3}', 'Acelerar gestion', 'yellow', true,
   'Estado pendiente por mas de diasPendiente dias.',
   'Solicitud pendiente sin atencion.', 20, 'activa', 'pendiente_prolongado'),

  ('Material sin existencia',
   'Productos agotados.',
   '{}', 'Bloquear nuevos pedidos del material', 'red', true,
   'Stock disponible igual a 0.',
   'Material agotado. No es posible atender nuevos pedidos.', 40, 'activa', 'material_sin_existencia'),

  ('Inventario por agotarse',
   'Advertencia preventiva antes de llegar al stock critico.',
   '{"porcentajeAlerta":20}', 'Planificar reabastecimiento', 'yellow', true,
   'Stock menor o igual a porcentajeAlerta% del inventario maximo.',
   'Inventario proximo a agotarse.', 20, 'activa', 'inventario_por_agotarse'),

  ('Pedido sin movimiento',
   'Pedidos que no cambian de estado.',
   '{"horasSinMovimiento":48}', 'Revisar pedido detenido', 'orange', true,
   'Sin actualizacion por mas de horasSinMovimiento horas.',
   'Pedido sin actualizacion reciente.', 30, 'activa', 'pedido_sin_movimiento'),

  ('Monto de facturacion por zona',
   'Zonas con alto monto de facturacion pendiente. (Requiere fuente de monto/zona.)',
   '{"montoUmbral":1000}', 'Revisar impacto por zona', 'orange', true,
   'Monto de facturacion por zona supera montoUmbral.',
   'Zona con alto monto de facturacion.', 30, 'activa', 'monto_facturacion_zona'),

  ('Franquiciado alta frecuencia',
   'Franquiciado que pide mas que su promedio historico. (Requiere historico.)',
   '{"factorPromedio":1}', 'Anticipar demanda', 'yellow', true,
   'Pedidos del mes mayores a factorPromedio x promedio historico.',
   'Incremento de demanda detectado.', 20, 'activa', 'franquiciado_alta_frecuencia'),

  ('Franquiciado solicita NC',
   'El franquiciado solicita una nota de credito.',
   '{}', 'Enviar a revision comercial', 'orange', true,
   'El pedido tiene nota de credito solicitada o pendiente.',
   'Franquiciado pidio NC reciente.', 30, 'activa', 'franquiciado_nc'),

  ('Material critico multifranquiciado',
   'Mismo material solicitado por muchos franquiciados a la vez.',
   '{"minFranquiciados":5}', 'Escalar abastecimiento', 'red', true,
   'Mismo material solicitado por mas de minFranquiciados franquiciados.',
   'Demanda critica detectada.', 40, 'activa', 'material_multifranquiciado'),

  ('Material no planificable NC',
   'Pedido de un material que ya no se planifica: NC inmediata.',
   '{}', 'Emitir NC inmediata', 'orange', true,
   'El material solicitado esta marcado como no planificable.',
   'Material no se planifica, NC inmediata.', 30, 'activa', 'no_planificable_nc')
on conflict (nombre) do nothing;

-- 2) Desactivar (conservando) toda regla que NO sea de las nuevas
update public.reglas_negocio
set estado = 'inactiva', activo = false
where nombre not in (
  'Stock critico','Pedido con entrega proxima','Pedido pendiente prolongado',
  'Material sin existencia','Inventario por agotarse','Pedido sin movimiento',
  'Monto de facturacion por zona','Franquiciado alta frecuencia',
  'Franquiciado solicita NC','Material critico multifranquiciado','Material no planificable NC'
);

-- 3) Motor SQL: prioridad_pedido_erp con las reglas nuevas que dependen de datos
--    disponibles en la firma (entrega proxima, pendiente prolongado, NC).
--    Las reglas de stock y "sin movimiento" se aplican en la app (tiene el stock
--    y updated_at del pedido) y en las alertas de inventario.
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
set search_path = public
as $$
declare
  puntaje integer := 0;
  dias_pendiente integer := 0;
  dias_entrega integer := 999;
  peso_entrega integer := public.peso_regla_activa('Pedido con entrega proxima');
  peso_pendiente integer := public.peso_regla_activa('Pedido pendiente prolongado');
  peso_nc integer := public.peso_regla_activa('Franquiciado solicita NC');
  dias_entrega_param integer := public.parametro_regla_numero('Pedido con entrega proxima', 'diasEntrega', 1)::integer;
  dias_pendiente_param integer := public.parametro_regla_numero('Pedido pendiente prolongado', 'diasPendiente', 3)::integer;
begin
  if p_fecha_pedido is not null then
    dias_pendiente := greatest(0, current_date - p_fecha_pedido);
  end if;
  if p_fecha_objetivo is not null then
    dias_entrega := p_fecha_objetivo - current_date;
  end if;

  -- R2 Pedido con entrega proxima (o vencida)
  if peso_entrega > 0 then
    if dias_entrega < 0 then
      puntaje := puntaje + peso_entrega + 5;
    elsif dias_entrega <= dias_entrega_param then
      puntaje := puntaje + peso_entrega;
    end if;
  end if;

  -- R3 Pedido pendiente prolongado
  if peso_pendiente > 0
    and coalesce(p_estado_operativo, 'pendiente') = 'pendiente'
    and dias_pendiente > dias_pendiente_param then
    puntaje := puntaje + peso_pendiente;
  end if;

  -- R9 Franquiciado solicita NC
  if peso_nc > 0 and coalesce(p_nc_pendientes, 0) > 0 then
    puntaje := puntaje + peso_nc;
  end if;

  return least(100, greatest(0, puntaje));
end;
$$;

-- 4) updated_at en pedidos (para R6 "Pedido sin movimiento")
alter table public.pedidos add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_pedidos_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pedidos_touch_updated_at on public.pedidos;
create trigger pedidos_touch_updated_at
before update on public.pedidos
for each row execute function public.touch_pedidos_updated_at();

grant execute on function public.touch_pedidos_updated_at() to anon, authenticated;

notify pgrst, 'reload schema';
