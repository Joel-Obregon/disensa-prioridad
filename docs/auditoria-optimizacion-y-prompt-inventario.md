# Auditoria de optimizacion y prompt de inventario

## Prompt para completar materiales faltantes en inventario

Usa este prompt con tu herramienta de datos o con la persona que va a editar el Excel:

```txt
Necesito completar el archivo INVENTARIO_03-06-2026_EDITADO.xlsx agregando los materiales que aparecen en pedidos, OC pendientes o transito, pero que no existen todavia en el inventario fisico. La lista de faltantes esta en:

C:\Users\Joel\Documents\Disensa-prioridad 2.0\docs\materiales_no_estan_en_inventario.csv

Objetivo:
Agregar cada material faltante al Excel de inventario manteniendo exactamente la misma estructura de columnas del archivo original.

Reglas:
1. No cambiar nombres de columnas.
2. No cambiar tipos de datos.
3. El campo Material debe conservarse como texto, no como numero.
4. El centro debe ser YDUR / Duran, usando el mismo formato que tienen las filas existentes.
5. El Texto breve de material debe salir del campo nombre_material del CSV.
6. La Unidad medida base debe usar unidad_medida del CSV; si esta vacia, usar UN.
7. Fabricante / marca debe usar marca_material cuando exista; si no existe, usar el nombre del suministrador.
8. Tipo de material puede completarse con catman_nombre o catman_categoria.
9. Stock libre utilizacion debe ser un stock positivo de prueba coherente.
10. Stock Disponible debe ser positivo y nunca menor a la demanda BFQ.
11. Bloqueado debe iniciar en 0 salvo que se quiera simular stock retenido.
12. Compr.Ped.Vta. debe iniciar en 0 salvo que exista demanda comprometida.
13. Stock en curso ped. puede usar la suma de stock_transito + cantidad_oc_pendiente si se quiere reflejar reabastecimiento.

Criterio para asignar stock de prueba:
- Si el material tiene demanda_bodega_fq > 0:
  Stock Disponible = max(demanda_bodega_fq * 3, 20)
- Si el material tiene OC o transito pero no demanda:
  Stock Disponible = max((cantidad_oc_pendiente + stock_transito) * 0.30, 10)
- Si no tiene demanda, OC ni transito:
  Stock Disponible = 10

Campos que deben quedar completos:
- Sociedad
- Nombre de la empresa
- Centro
- Nombre de centro
- Material
- Texto breve de material
- Tipo de material
- Fabricante
- Unidad medida base
- Stock libre utilizacion
- Bloqueado
- Compr.Ped.Vta.
- Compr.Entregas.
- Consig-libre utiliz
- Stock en curso ped.
- Devoluciones
- Stock Disponible
- Observacion prueba

En Observacion prueba colocar:
"Creado para coherencia prototipo: material presente en pedidos/OC/transito sin fila previa de inventario".
```

## Regla de negocio recomendada

Regla: punto de reabastecimiento por cobertura menor al 30%.

Definicion:

```txt
porcentaje_cobertura = stock_disponible / max(demanda_bodega_fq + stock_minimo_operativo, 1)
```

Interpretacion:

- Verde: cobertura >= 70%.
- Amarillo: cobertura entre 30% y 69%.
- Rojo: cobertura < 30% o stock_disponible = 0.

Accion:

- Si cobertura < 30% y no existe OC/transito: crear alerta para Compras.
- Si cobertura < 30% y existe OC/transito: crear alerta de seguimiento para Bodega/Compras.
- Si cobertura >= 70%: sin alerta.

Esta regla es util porque no repite la regla de retraso; cubre el riesgo de quiebre antes de que el material llegue a cero.

## Auditoria de tablas

Tablas activas para la app:

- usuarios_app
- material_catalogo
- materiales
- pedidos
- reglas_negocio
- alertas
- movimientos_inventario
- auditoria
- reportes_operativos
- reportes_franquiciado
- centros_bodega
- clientes_franquiciado
- proveedores_operativos
- inventario_bodega
- pedidos_bodega_fq
- oc_pendientes_bodega
- transito_bodega

Vistas activas:

- materiales_operativos_v
- pedidos_bodega_fq_priorizados_v
- pedido_detalle_operativo_v
- otif_operativo_v
- operacion_bodega_fq_kpis_v

Tablas antiguas del modelo 2.0 que aparecen vacias y no estan en rutas principales:

- proveedores
- solicitantes
- pedidos_erp
- pedido_lineas
- gestiones_pedido
- solicitudes_gestion
- notas_credito
- nota_credito_lineas
- seguimiento_proveedor_fuente
- consolidado_nc_fuente
- import_errores_2_0

Recomendacion:
No eliminarlas directamente desde Supabase hasta revisar dependencias SQL con una consulta de dependencias. Primero deben quedar fuera del modulo Estado del sistema y fuera de los servicios del frontend. Luego se puede preparar un SQL de limpieza con backup.

Consulta sugerida antes de borrar una tabla:

```sql
select
  source_ns.nspname as esquema_origen,
  source.relname as objeto_origen,
  dependent_ns.nspname as esquema_dependiente,
  dependent.relname as objeto_dependiente,
  dependent.relkind as tipo_dependiente
from pg_depend dep
join pg_rewrite rw on rw.oid = dep.objid
join pg_class dependent on dependent.oid = rw.ev_class
join pg_namespace dependent_ns on dependent_ns.oid = dependent.relnamespace
join pg_class source on source.oid = dep.refobjid
join pg_namespace source_ns on source_ns.oid = source.relnamespace
where source_ns.nspname = 'public'
  and source.relname in (
    'proveedores',
    'solicitantes',
    'pedidos_erp',
    'pedido_lineas',
    'gestiones_pedido',
    'solicitudes_gestion',
    'notas_credito',
    'nota_credito_lineas',
    'seguimiento_proveedor_fuente',
    'consolidado_nc_fuente',
    'import_errores_2_0'
  )
order by source.relname, dependent.relname;
```

Si esta consulta devuelve filas, esa tabla aun alimenta alguna vista. Si no devuelve filas y tampoco aparece en el frontend, se puede preparar un `drop table` controlado con respaldo.

## Limpieza realizada en frontend

- Se retiro `src/pages/CargaMasiva.tsx` porque no estaba conectada a rutas ni menu.
- Se retiro `src/pages/Materiales.tsx` porque `/materiales` redirige a `/inventario` y el modulo unico actual es Inventario.
- Se actualizo Estado del sistema para revisar tablas y vistas operativas actuales.
