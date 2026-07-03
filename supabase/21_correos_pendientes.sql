-- ============================================================================
-- 21_correos_pendientes.sql
-- Gestion de la cola public.notificaciones_correo (153 correos en 'pendiente').
-- ----------------------------------------------------------------------------
-- CONTEXTO (verificado en vivo): hay 153 filas en estado 'pendiente' creadas
-- entre 2026-06-11 y 2026-06-18, pero NINGUNA funcion viva inserta ya en esta
-- tabla (la cola quedo huerfana de un trigger anterior) y nada las envia.
--
-- Tienes dos caminos. La PARTE 1 (indices) es segura y conviene siempre.
-- Elige A o B segun quieras correo real o no, descomentando lo que aplique.
-- ============================================================================

-- PARTE 1 (segura): indices que pedian los advisors de rendimiento.
create index if not exists notificaciones_correo_material_idx
  on public.notificaciones_correo (material_id);
create index if not exists notificaciones_correo_pedido_idx
  on public.notificaciones_correo (pedido_id);
create index if not exists notificaciones_correo_estado_idx
  on public.notificaciones_correo (estado);

-- ----------------------------------------------------------------------------
-- OPCION A: NO usaras correo -> descarta los 153 pendientes (limpia la cola).
--   Son alertas viejas; enviarlas ahora seria ruido. Descomenta para ejecutar:
--
-- delete from public.notificaciones_correo where estado = 'pendiente';

-- ----------------------------------------------------------------------------
-- OPCION B: SI usaras correo -> deja los pendientes y despliega la Edge Function
--   supabase/edge-functions/enviar-notificaciones-correo. Ademas, para que la
--   cola se vuelva a llenar cuando entra una alerta CRITICA, activa este
--   trigger (descomenta el bloque). Ajusta el destinatario por departamento.
--
-- create or replace function public.encolar_correo_alerta_critica_trg()
-- returns trigger
-- language plpgsql
-- security definer
-- set search_path = public
-- as $fn$
-- begin
--   if new.nivel = 'critica' and coalesce(new.estado,'activa') = 'activa' then
--     insert into public.notificaciones_correo
--       (alerta_id, pedido_id, material_id, departamento, asunto, mensaje, estado)
--     values (
--       new.id, new.pedido_id, new.material_id,
--       coalesce(new.responsable, 'Departamento de inventario'),
--       'Alerta critica - Disensa',
--       new.mensaje,
--       'pendiente'
--     );
--   end if;
--   return new;
-- end;
-- $fn$;
--
-- drop trigger if exists alertas_encolar_correo_critico on public.alertas;
-- create trigger alertas_encolar_correo_critico
--   after insert on public.alertas
--   for each row execute function public.encolar_correo_alerta_critica_trg();

notify pgrst, 'reload schema';
