# Perfil de bases nuevas

## pendientes_bodega_fq
Ruta: `C:\Users\Joel\Downloads\BASE_PENDIENTES_BODEGA_A_FQ_EDITADO.xlsx`

### Hoja: Hoja1
- Filas: 61
- Columnas: 48
- Columnas: `validacion_bodega, lider, observacion_despacho, tipo_de_caso, responsable, resolucion, estado, base, cod_pedido, zona_cliente, cod_cliente, cliente, zona, posicion, cod_proveedor, cod_holcim, descripcion, cantidad, unidad, peso_kg, m3, linea_de_producto, placa, cod_trans, fecha_solicitud, fecha_limite, observaciones_general, validacion_lizbeth_nicola, fecha_reportado, fecha_revision, fecha_de_entrega, dias_entregados, sla, validacion_y_aux, pedidos_dp, fecha_compra, stock_disponible, stock_en_transito, bloqueado, validacion_planning, validado_por, oc, fecha_oc, mes, dia, ano, excluidos, fecha_de_cierre_bodega`
- Roles detectados: `{"bodega": ["validacion_bodega", "fecha_de_cierre_bodega"], "estado": ["estado"], "pedido": ["cod_pedido", "pedidos_dp"], "franquiciado": ["zona_cliente", "cod_cliente", "cliente"], "proveedor": ["cod_proveedor"], "material_nombre": ["descripcion", "linea_de_producto"], "cantidad": ["cantidad", "stock_disponible", "stock_en_transito"], "fecha": ["fecha_solicitud", "fecha_limite", "fecha_reportado", "fecha_revision", "fecha_de_entrega", "fecha_compra", "fecha_oc", "fecha_de_cierre_bodega"], "oc": ["stock_disponible", "stock_en_transito", "oc", "fecha_oc"]}`

| Columna | Tipo | No nulos | Unicos | Ejemplos |
|---|---:|---:|---:|---|
| validacion_bodega | str | 61 | 2 | Revisado, Revisado, Revisado |
| lider | str | 10 | 4 | CDORADO, EGASTON, EGASTON |
| observacion_despacho | str | 10 | 10 | En el inventario realizado el 11/01/2026 se contaron 217 unidades de la tuberia, si se contaba con stock y no se despachó, No se cuenta con stock del material, diferencia de inventario, se contaron solo 2 unidades |
| tipo_de_caso | str | 61 | 13 | CADUCIDAD, CADUCIDAD, ESPACIO CAMION |
| responsable | str | 61 | 4 | DESPACHO, DESPACHO, TRANSPORTE |
| resolucion | str | 61 | 3 | NC confirmada, NC confirmada, Entregado |
| estado | str | 61 | 2 | Cerrado, Cerrado, Cerrado |
| base | str | 61 | 2 | Durán, Durán, Durán |
| cod_pedido | int64 | 61 | 30 | 509458262, 509458262, 509456873 |
| zona_cliente | str | 61 | 4 | ZONA 1, ZONA 1, ZONA 1 |
| cod_cliente | int64 | 61 | 23 | 6321212, 6321212, 6134752 |
| cliente | str | 61 | 23 | ANCHUNDIA CALVA DENISSE GABRIE, ANCHUNDIA CALVA DENISSE GABRIE, MEGANOA S.A. |
| zona | str | 61 | 22 | EC GUAYAQUIL NORTE, EC GUAYAQUIL NORTE, EC NARANJITO |
| posicion | str | 31 | 29 | 1-8-C-P2, 3-12-A-P2, 4-9-B-P1/4-9-A-P1 |
| cod_proveedor | object | 61 | 55 | PVPT223, PVPT040, 925480 |
| cod_holcim | int64 | 61 | 55 | 91032041, 91029894, 91003008 |
| descripcion | str | 61 | 55 | Toke Pegatanke Ultra G, Pegatanke Transparente, Tanque Botella 01100 Lt C/Kit ¾ PGM |
| cantidad | int64 | 61 | 23 | 10, 10, 5 |
| unidad | str | 61 | 2 | UN, UN, UN |
| peso_kg | float64 | 61 | 49 | 0.2, 0.87, 108.56 |
| m3 | float64 | 60 | 31 | 0.0, 0.0, 4.0 |
| linea_de_producto | str | 61 | 14 | PTKDELECUADOR S.A., PTKDELECUADOR S.A., PLASTIGAMA (TANQUE) |
| placa | str | 51 | 6 | PAE3078, PAE3078, GTT8251 |
| cod_trans | float64 | 0 | 0 |  |
| fecha_solicitud | datetime64[us] | 61 | 3 | 2026-01-05T00:00:00, 2026-01-05T00:00:00, 2026-01-05T00:00:00 |
| fecha_limite | float64 | 0 | 0 |  |
| observaciones_general | str | 61 | 43 | PENDIENTE 10 UN POR CADUCIDAD, PENDIENTE 10 UN POR CADUCIDAD, PENDIENTE 5 UN POR ESPACIO CAMION |
| validacion_lizbeth_nicola | str | 53 | 15 | PLANIFICACION, Cliente cerrado, retorna toda la carga, Cliente cerrado, retorna toda la carga |
| fecha_reportado | datetime64[us] | 61 | 7 | 2026-01-09T00:00:00, 2026-01-09T00:00:00, 2026-01-08T00:00:00 |
| fecha_revision | datetime64[us] | 61 | 9 | 2026-01-09T00:00:00, 2026-01-09T00:00:00, 2026-01-08T00:00:00 |
| fecha_de_entrega | datetime64[us] | 47 | 12 | 2026-01-09T00:00:00, 2026-01-09T00:00:00, 2026-04-09T00:00:00 |
| dias_entregados | float64 | 47 | 12 | 0.0, 0.0, 91.0 |
| sla | str | 61 | 11 | CADA 24 HORAS, CADA 24 HORAS, CADA 48 HORAS |
| validacion_y_aux | str | 61 | 61 | 509458262 | 91032041, 509458262 | 91029894, 509456873 | 91003008 |
| pedidos_dp | float64 | 60 | 60 | 632121291032041.0, 632121291029894.0, 613475291003008.0 |
| fecha_compra | datetime64[us] | 24 | 2 | 2025-07-29T00:00:00, 2025-05-26T00:00:00, 2025-05-26T00:00:00 |
| stock_disponible | int64 | 61 | 40 | 41, 50, 0 |
| stock_en_transito | int64 | 61 | 32 | 0, 0, 0 |
| bloqueado | float64 | 46 | 1 | 0.0, 0.0, 0.0 |
| validacion_planning | float64 | 0 | 0 |  |
| validado_por | float64 | 0 | 0 |  |
| oc | float64 | 37 | 11 | 4583482021.0, 4583482015.0, 4583482015.0 |
| fecha_oc | datetime64[us] | 37 | 9 | 2026-05-29T00:00:00, 2026-05-29T00:00:00, 2026-05-29T00:00:00 |
| mes | int64 | 61 | 1 | 1, 1, 1 |
| dia | int64 | 61 | 3 | 5, 5, 5 |
| ano | int64 | 61 | 1 | 2026, 2026, 2026 |
| excluidos | str | 61 | 2 | Planificable, Planificable, Hasta agotar stock |
| fecha_de_cierre_bodega | float64 | 0 | 0 |  |

## inventario
Ruta: `C:\Users\Joel\Downloads\INVENTARIO_03-06-2026_EDITADO.xlsx`

### Hoja: Sheet1
- Filas: 2618
- Columnas: 17
- Columnas: `sociedad, nombre_de_la_empresa, centro, nombre_de_centro, material, texto_breve_de_material, tipo_de_material, fabricante, unidad_medida_base, stock_libre_utilizacion, bloqueado, compr_ped_vta, compr_entregas, consig_libre_utiliz, stock_en_curso_ped, devoluciones, stock_disponible`
- Roles detectados: `{"oc": ["sociedad", "stock_libre_utilizacion", "stock_en_curso_ped", "stock_disponible"], "material_nombre": ["nombre_de_la_empresa", "nombre_de_centro", "material", "texto_breve_de_material", "tipo_de_material"], "bodega": ["centro", "nombre_de_centro"], "cantidad": ["fabricante", "stock_libre_utilizacion", "stock_en_curso_ped", "stock_disponible"]}`

| Columna | Tipo | No nulos | Unicos | Ejemplos |
|---|---:|---:|---:|---|
| sociedad | str | 2618 | 1 | EC83, EC83, EC83 |
| nombre_de_la_empresa | str | 2618 | 1 | Construmercado S.A., Construmercado S.A., Construmercado S.A. |
| centro | str | 2618 | 1 | YDUR, YDUR, YDUR |
| nombre_de_centro | str | 2618 | 1 | Duran, Duran, Duran |
| material | int64 | 2618 | 2618 | 91000761, 91000767, 91000768 |
| texto_breve_de_material | str | 2618 | 2613 | Codo Flex ½x90 PGM, Neplo Flex ½ PGM, Neplo Flex ¾ PGM |
| tipo_de_material | str | 2618 | 1 | ZMER, ZMER, ZMER |
| fabricante | str | 2618 | 42 | 1603646, 1603646, 1603646 |
| unidad_medida_base | str | 2618 | 8 | UN, UN, UN |
| stock_libre_utilizacion | float64 | 2618 | 468 | 1847.0, 90.0, 175.0 |
| bloqueado | int64 | 2618 | 1 | 0, 0, 0 |
| compr_ped_vta | float64 | 2618 | 105 | 0.0, 200.0, 0.0 |
| compr_entregas | float64 | 2618 | 60 | 0.0, 0.0, 0.0 |
| consig_libre_utiliz | int64 | 2618 | 1 | 0, 0, 0 |
| stock_en_curso_ped | float64 | 2618 | 424 | 0.0, 8200.0, 3000.0 |
| devoluciones | float64 | 2618 | 21 | 0.0, 0.0, 0.0 |
| stock_disponible | float64 | 2618 | 471 | 1847.0, -110.0, 175.0 |

## transito
Ruta: `C:\Users\Joel\Downloads\TRANSITO_ejemplo_EDITADO.xlsx`

### Hoja: Hoja1
- Filas: 5000
- Columnas: 9
- Columnas: `centro, documento_compras, fecha_documento, material, texto_breve, cantidad_de_pedido, por_entregar_cantidad, valor_neto_de_orden, nombre_del_proveedor`
- Roles detectados: `{"bodega": ["centro"], "oc": ["documento_compras", "fecha_documento"], "fecha": ["fecha_documento"], "material_nombre": ["material", "nombre_del_proveedor"], "pedido": ["cantidad_de_pedido"], "cantidad": ["cantidad_de_pedido", "por_entregar_cantidad"], "valor": ["valor_neto_de_orden"], "proveedor": ["nombre_del_proveedor"]}`

| Columna | Tipo | No nulos | Unicos | Ejemplos |
|---|---:|---:|---:|---|
| centro | str | 5000 | 1 | YDUR, YDUR, YDUR |
| documento_compras | int64 | 5000 | 161 | 4583482015, 4583482021, 4583481317 |
| fecha_documento | datetime64[us] | 5000 | 58 | 2026-05-29T00:00:00, 2026-05-29T00:00:00, 2026-05-28T00:00:00 |
| material | int64 | 5000 | 1242 | 91001485, 91031479, 91036529 |
| texto_breve | str | 5000 | 1243 | Tubo PVC Roscable AA Fria ½x6 420psi PGM, Tubo Desague T-B 110 mm x 3 m PDR, Funda Disensa Blan 20"+FL 4"x27"x0.0 |
| cantidad_de_pedido | int64 | 5000 | 291 | 12000, 1000, 10000 |
| por_entregar_cantidad | int64 | 5000 | 121 | 12000, 1000, 10000 |
| valor_neto_de_orden | float64 | 5000 | 2919 | 52200.0, 4970.0, 700.0 |
| nombre_del_proveedor | str | 5000 | 29 | 1603646    MEXICHEM ECUADOR S.A., 1603646    MEXICHEM ECUADOR S.A., 1610278    PLASTICONSUMO S. A. |

## oc_pendientes_sum_bog
Ruta: `C:\Users\Joel\Downloads\OC_PENDIENTES_SUM_A_BOG_EDITADO.xlsx`

### Hoja: Sheet1
- Filas: 5000
- Columnas: 12
- Columnas: `centro, documento_compras, fecha_documento, material, texto_breve, cantidad_de_pedido, por_entregar_cantidad, valor_neto_de_orden, nombre_del_proveedor, tipo_de_posicion, tipo_de_posicion_1, tipo_de_imputacion`
- Roles detectados: `{"bodega": ["centro"], "oc": ["documento_compras", "fecha_documento"], "fecha": ["fecha_documento"], "material_nombre": ["material", "nombre_del_proveedor"], "pedido": ["cantidad_de_pedido"], "cantidad": ["cantidad_de_pedido", "por_entregar_cantidad"], "valor": ["valor_neto_de_orden"], "proveedor": ["nombre_del_proveedor"]}`

| Columna | Tipo | No nulos | Unicos | Ejemplos |
|---|---:|---:|---:|---|
| centro | str | 5000 | 1 | YDUR, YDUR, YDUR |
| documento_compras | int64 | 5000 | 161 | 4583482015, 4583482021, 4583481317 |
| fecha_documento | datetime64[us] | 5000 | 58 | 2026-05-29T00:00:00, 2026-05-29T00:00:00, 2026-05-28T00:00:00 |
| material | int64 | 5000 | 1242 | 91001485, 91031479, 91036529 |
| texto_breve | str | 5000 | 1243 | Tubo PVC Roscable AA Fria ½x6 420psi PGM, Tubo Desague T-B 110 mm x 3 m PDR, Funda Disensa Blan 20"+FL 4"x27"x0.0 |
| cantidad_de_pedido | int64 | 5000 | 291 | 12000, 1000, 10000 |
| por_entregar_cantidad | int64 | 5000 | 125 | 12000, 1000, 10000 |
| valor_neto_de_orden | float64 | 5000 | 2919 | 52200.0, 4970.0, 700.0 |
| nombre_del_proveedor | str | 5000 | 29 | 1603646    MEXICHEM ECUADOR S.A., 1603646    MEXICHEM ECUADOR S.A., 1610278    PLASTICONSUMO S. A. |
| tipo_de_posicion | int64 | 5000 | 1 | 0, 0, 0 |
| tipo_de_posicion_1 | float64 | 0 | 0 |  |
| tipo_de_imputacion | float64 | 0 | 0 |  |

## Coincidencias entre fuentes
| Rol | Fuente A | Fuente B | Coincidencias | % A | % B | Ejemplos |
|---|---|---|---:|---:|---:|---|
| bodega | `inventario.Sheet1.centro` | `transito.Hoja1.centro` | 1 | 100.0 | 100.0 | YDUR |
| bodega | `inventario.Sheet1.centro` | `oc_pendientes_sum_bog.Sheet1.centro` | 1 | 100.0 | 100.0 | YDUR |
| bodega | `transito.Hoja1.centro` | `oc_pendientes_sum_bog.Sheet1.centro` | 1 | 100.0 | 100.0 | YDUR |
| oc | `inventario.Sheet1.stock_libre_utilizacion` | `inventario.Sheet1.stock_disponible` | 339 | 72.44 | 71.97 | 0.0, 0.04, 1.0, 1.8, 10.0 |
| oc | `inventario.Sheet1.stock_libre_utilizacion` | `inventario.Sheet1.stock_en_curso_ped` | 199 | 42.52 | 46.93 | 0.0, 1.0, 10.0, 100.0, 1000.0 |
| oc | `inventario.Sheet1.stock_en_curso_ped` | `inventario.Sheet1.stock_disponible` | 189 | 44.58 | 40.13 | 0.0, 1.0, 10.0, 100.0, 1000.0 |
| oc | `transito.Hoja1.documento_compras` | `oc_pendientes_sum_bog.Sheet1.documento_compras` | 161 | 100.0 | 100.0 | 4583409274, 4583411959, 4583412002, 4583412731, 4583418003 |
| oc | `transito.Hoja1.fecha_documento` | `oc_pendientes_sum_bog.Sheet1.fecha_documento` | 58 | 100.0 | 100.0 | 2025-12-05, 2025-12-11, 2025-12-12, 2025-12-26, 2025-12-30 |
| oc | `pendientes_bodega_fq.Hoja1.fecha_oc` | `transito.Hoja1.fecha_documento` | 9 | 100.0 | 15.52 | 2026-03-26, 2026-05-04, 2026-05-05, 2026-05-06, 2026-05-20 |
| oc | `pendientes_bodega_fq.Hoja1.fecha_oc` | `oc_pendientes_sum_bog.Sheet1.fecha_documento` | 9 | 100.0 | 15.52 | 2026-03-26, 2026-05-04, 2026-05-05, 2026-05-06, 2026-05-20 |
| oc | `pendientes_bodega_fq.Hoja1.stock_disponible` | `pendientes_bodega_fq.Hoja1.stock_en_transito` | 2 | 5.0 | 6.25 | 0, 1 |
| pedido | `transito.Hoja1.cantidad_de_pedido` | `oc_pendientes_sum_bog.Sheet1.cantidad_de_pedido` | 291 | 100.0 | 100.0 | 1, 10, 100, 1000, 10000 |
| proveedor | `transito.Hoja1.nombre_del_proveedor` | `oc_pendientes_sum_bog.Sheet1.nombre_del_proveedor` | 29 | 100.0 | 100.0 | 1600072    LINDE ECUADOR S.A., 1600118    SIKA ECUATORIANA S.A, 1600448    INDURA ECUADOR S.A., 1601701    L. HENRIQUES Y CIA. S.A., 1601791    PINTURAS UNIDAS S. A. |