# Integracion de bases operativas 3.0

Esta integracion reemplaza la carga de prueba anterior por cuatro fuentes operativas reales:

- `BASE_PENDIENTES_BODEGA_A_FQ_EDITADO.xlsx`
- `INVENTARIO_03-06-2026_EDITADO.xlsx`
- `TRANSITO_ejemplo_EDITADO.xlsx`
- `OC_PENDIENTES_SUM_A_BOG_EDITADO.xlsx`

## Relacion principal entre archivos

El campo central es el codigo de material:

| Archivo | Campo usado | Destino |
|---|---|---|
| Pendientes Bodega-FQ | `cod_holcim` | `material_catalogo.codigo_material`, `pedidos_bodega_fq.codigo_material` |
| Inventario | `material` | `inventario_bodega.codigo_material` |
| Transito | `material` | `transito_bodega.codigo_material` |
| OC pendientes | `material` | `oc_pendientes_bodega.codigo_material` |

La segunda relacion fuerte es la orden de compra:

| Archivo | Campo usado | Relacion |
|---|---|---|
| Pendientes Bodega-FQ | `oc` | Se cruza contra `documento_compras` |
| Transito | `documento_compras` | Orden en transito |
| OC pendientes | `documento_compras` | Orden pendiente del proveedor |

La bodega se normaliza asi:

- Inventario, transito y OC usan `centro = YDUR`.
- Pendientes usa `base = Duran`, que se transforma a `centro_codigo = YDUR`.

Los clientes salen de `cod_cliente`, `cliente`, `zona_cliente` y `zona`.
Los proveedores salen de `nombre_del_proveedor`; el importador separa el codigo y el nombre, por ejemplo `1603646 MEXICHEM ECUADOR S.A.`.

## Tablas nuevas

El archivo SQL `supabase/schema_bases_operativas_3_0.sql` crea estas tablas:

| Tabla | Uso |
|---|---|
| `centros_bodega` | Centros/bodegas, por ahora `YDUR` |
| `clientes_franquiciado` | Clientes franquiciados de la base de pendientes |
| `proveedores_operativos` | Proveedores de transito, OC e inventario |
| `inventario_bodega` | Stock real por centro y material |
| `pedidos_bodega_fq` | Casos pendientes Bodega -> Franquiciado |
| `transito_bodega` | Lineas de compra en transito |
| `oc_pendientes_bodega` | Ordenes de compra pendientes |

Tambien crea estas vistas:

| Vista | Uso |
|---|---|
| `materiales_operativos_v` | Cruza demanda, stock, transito y OC por material |
| `pedidos_bodega_fq_priorizados_v` | Calcula estado, faltante y prioridad por pedido |
| `operacion_bodega_fq_kpis_v` | KPIs generales para validar la importacion |

## Como se conecta con la pagina

Despues de importar, la funcion `refrescar_prototipo_bodega_fq()` sincroniza la informacion hacia las tablas que ya usa el prototipo:

| Modulo de la pagina | Tabla visible actual | Alimentacion nueva |
|---|---|---|
| Dashboard | `pedidos`, `materiales`, `alertas` | Resumen de casos Bodega-FQ, faltantes y prioridad |
| Pedidos | `pedidos` | Casos `BFQ-*` generados desde pendientes |
| Inventario / Materiales | `materiales` | Stock actual desde `stock_libre_utilizacion` y demanda desde pendientes |
| Alertas | `alertas` | Alertas por prioridad alta, faltantes, transito suficiente y notas de credito |

## Reglas de negocio aplicadas

La prioridad operativa considera:

- Faltante total: cantidad solicitada menos `stock_disponible` menos transito.
- Caso con nota de credito o revision.
- Tipo de caso: caducidad, stock, espacio camion.
- Antiguedad desde `fecha_reportado` o `fecha_solicitud`.
- Existencia o falta de OC asociada.
- Volumen solicitado.

En la pantalla de Inventario, `Stock actual` representa el stock fisico libre del Excel (`stock_libre_utilizacion`). En las reglas de prioridad se usa `stock_disponible`, porque ese campo ya descuenta compromisos comerciales y muestra si realmente alcanza para cubrir pedidos.

Alertas visuales generadas:

| Tipo | Cuando aparece | Nivel |
|---|---|---|
| `priorizacion_bodega_fq` | Pedido activo con prioridad calculada desde 60 | Alta o critica |
| `faltante_bodega_fq` | Material con demanda no cubierta por stock ni transito | Critica |
| `transito_cubre_pedido` | Stock actual insuficiente, pero transito cubre la demanda | Media |
| `nota_credito_bodega_fq` | Resolucion asociada a nota de credito o revision | Alta |

Los estados se calculan asi:

| Condicion | Estado |
|---|---|
| Resolucion contiene `Entregado` | `entregado` |
| Resolucion contiene `NC` | `en_revision` |
| Estado fuente contiene cancelacion | `cancelado` |
| Stock disponible cubre cantidad | `aprobado` |
| Sin stock ni transito | `sin_stock` |
| Caso restante | `pendiente` |

## Paso a paso en Supabase

1. En Supabase, entra a SQL Editor.

2. Si quieres borrar la data importada anterior de prueba, ejecuta completo:

```sql
-- archivo local:
-- C:\Users\Joel\Documents\Disensa-prioridad 2.0\supabase\limpiar_datos_importados.sql
```

3. Si la base esta totalmente nueva, ejecuta primero el modelo base:

```sql
-- archivo local:
-- C:\Users\Joel\Documents\Disensa-prioridad 2.0\supabase\schema_2_0_base_nueva.sql
```

4. Ejecuta el modelo operativo nuevo:

```sql
-- archivo local:
-- C:\Users\Joel\Documents\Disensa-prioridad 2.0\supabase\schema_bases_operativas_3_0.sql
```

5. En PowerShell, desde el proyecto:

```powershell
cd "C:\Users\Joel\Documents\Disensa-prioridad 2.0"
$env:SUPABASE_URL="https://TU-PROYECTO.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="sb_secret_TU_CLAVE_SECRETA"
```

6. Prueba primero sin escribir:

```powershell
& "C:\Users\Joel\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\importar_bases_operativas_3_0.py --dry-run
```

7. Si el dry run muestra conteos correctos, importa de verdad:

```powershell
& "C:\Users\Joel\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\importar_bases_operativas_3_0.py
```

El importador limpia automaticamente la importacion operativa anterior antes de subir la nueva. Esto es lo recomendado porque estos archivos son snapshots completos, no movimientos incrementales.

Si en el futuro quieres importar con nombres/rutas diferentes:

```powershell
& "C:\Users\Joel\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\importar_bases_operativas_3_0.py `
  --pendientes "C:\ruta\BASE_PENDIENTES.xlsx" `
  --inventario "C:\ruta\INVENTARIO.xlsx" `
  --transito "C:\ruta\TRANSITO.xlsx" `
  --oc-pendientes "C:\ruta\OC_PENDIENTES.xlsx"
```

## Validaciones despues de importar

En Supabase SQL Editor ejecuta:

```sql
select * from public.operacion_bodega_fq_kpis_v;
```

```sql
select estado_cobertura, count(*)
from public.materiales_operativos_v
group by estado_cobertura
order by estado_cobertura;
```

```sql
select cod_pedido, codigo_material, nombre_material, cantidad,
       stock_disponible_real, stock_transito_real, faltante_total,
       estado_prototipo, prioridad_operativa
from public.pedidos_bodega_fq_priorizados_v
order by prioridad_operativa desc, faltante_total desc
limit 20;
```

Con los archivos revisados, el dry run preparo:

- 1 centro.
- 23 clientes.
- 42 proveedores.
- 2.732 materiales de catalogo.
- 2.618 filas de inventario.
- 61 casos Bodega-FQ.
- 5.000 lineas de transito.
- 5.000 lineas de OC pendientes.
