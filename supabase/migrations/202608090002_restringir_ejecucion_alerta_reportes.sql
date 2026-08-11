-- La funcion solo debe ejecutarse desde los triggers de reportes, nunca como RPC.
revoke execute on function public.crear_alerta_reporte_tiempo_real_trg()
from public, anon, authenticated;
