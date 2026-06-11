-- Quita la regla antigua "Condicion de material" del modulo Reglas.
-- No elimina columnas operativas de pedidos; solo retira esta regla del motor visible.

update public.reglas_negocio
set
  estado = 'inactiva',
  activo = false
where nombre = 'Condicion de material';

delete from public.reglas_negocio
where nombre = 'Condicion de material';
