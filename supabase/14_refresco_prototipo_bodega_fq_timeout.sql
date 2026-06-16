-- Aumenta el tiempo permitido para el refresco que sincroniza las bases
-- operativas con las tablas visibles del prototipo.
--
-- No borra datos. Solo cambia la configuracion de ejecucion de la funcion.
-- Luego de ejecutar este archivo, corre:
-- select public.refrescar_prototipo_bodega_fq();

alter function public.refrescar_prototipo_bodega_fq()
set statement_timeout = '180s';

alter function public.limpiar_bases_operativas_3_0()
set statement_timeout = '180s';

notify pgrst, 'reload schema';
