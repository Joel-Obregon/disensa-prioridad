# Integracion de BASE.xlsx como catalogo maestro

## Rol de la nueva base

`BASE.xlsx` se incorpora como catalogo maestro de materiales. No reemplaza al inventario, porque no contiene stock fisico; completa la informacion maestra que usan Inventario, Pedidos y Detalle de pedido.

Fuente nueva:

- Archivo: `C:\Users\Joel\Downloads\BASE.xlsx`
- Hoja: `Hoja1`
- Filas utiles: 2625
- Codigo de cruce: `Cdisensa mat`

## Campos usados

| Campo en BASE.xlsx | Uso en Supabase / prototipo |
|---|---|
| `Cdisensa mat` | `material_catalogo.codigo_material` |
| `N_Materiales` | `material_catalogo.nombre_material` |
| `CodNuestro Mat` | `material_catalogo.numero_fb` y `codigo_nuestro_material` |
| `CodFab Nuestro` | `material_catalogo.codigo_fabricante_nuestro` |
| `C_Fabricante` | `material_catalogo.codigo_suministrador` y `proveedores_operativos.codigo_proveedor` |
| `N._Fabricante` | `material_catalogo.nombre_suministrador` y `proveedores_operativos.nombre_proveedor` |
| `Marca` | `material_catalogo.marca_material` |
| `Catman` | `material_catalogo.catman_nombre` |
| `Catman nuestro` | `material_catalogo.catman_nuestro` |
| `Categoria` | `material_catalogo.catman_categoria` |
| `UMB (Unidad de Medida Base)` | `material_catalogo.unidad_medida_base` |
| `Estado de planificacion` | `material_catalogo.estado_planificacion` |
| `Min Vta` | `material_catalogo.min_venta` |
| `Mult Vta` | `material_catalogo.mult_venta` |
| `Min cmpr` | `material_catalogo.min_compra` |
| `Mult cmpr` | `material_catalogo.mult_compra` |

## Cruce con las bases existentes

- `BASE_PENDIENTES_BODEGA_A_FQ_EDITADO.xlsx`: se cruza por `Cod_Holcim` contra `Cdisensa mat`.
- `INVENTARIO_03-06-2026_EDITADO.xlsx`: se cruza por `Material` contra `Cdisensa mat`.
- `TRANSITO_ejemplo_EDITADO.xlsx`: se cruza por `Material` contra `Cdisensa mat`.
- `OC_PENDIENTES_SUM_A_BOG_EDITADO.xlsx`: se cruza por `Material` contra `Cdisensa mat`.

## Reglas de coherencia

- El stock disponible sigue viniendo de `INVENTARIO_03-06-2026_EDITADO.xlsx`.
- `BASE.xlsx` no inventa stock ni crea reabastecimientos.
- Si un material aparece en pedidos pero no aparece en `BASE.xlsx`, se conserva porque viene de la operacion real.
- Si un material aparece en `BASE.xlsx` pero no aparece en inventario, puede mostrarse con stock 0 hasta que exista stock real o se registre manualmente.
- Los datos de proveedor, marca, catman, unidad y minimos/multiplos se toman primero desde `BASE.xlsx`; si no existen, el prototipo usa la mejor informacion disponible de inventario, OC, transito o pedidos.

## Orden correcto de carga

1. Ejecutar en Supabase SQL Editor:

```sql
-- Archivo del proyecto:
-- supabase/13_catalogo_maestro_base_materiales.sql
```

2. Correr el importador con la quinta base:

```powershell
$env:SUPABASE_URL="https://TU-PROYECTO.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="TU_SECRET_KEY"

& "C:\Users\Joel\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\importar_bases_operativas_3_0.py `
  --pendientes "C:\Users\Joel\Downloads\BASE_PENDIENTES_BODEGA_A_FQ_EDITADO.xlsx" `
  --inventario "C:\Users\Joel\Downloads\INVENTARIO_03-06-2026_EDITADO.xlsx" `
  --transito "C:\Users\Joel\Downloads\TRANSITO_ejemplo_EDITADO.xlsx" `
  --oc-pendientes "C:\Users\Joel\Downloads\OC_PENDIENTES_SUM_A_BOG_EDITADO.xlsx" `
  --catalogo-materiales "C:\Users\Joel\Downloads\BASE.xlsx"
```

## Resultado esperado del dry-run

Con los archivos actuales, el importador prepara:

- Centros: 1
- Clientes: 23
- Proveedores: 56
- Materiales catalogo operativo: 2739
- Filas de `BASE.xlsx`: 2625
- Inventario bodega: 2732
- Pedidos Bodega-FQ: 61
- Transito bodega: 5000
- OC pendientes bodega: 5000

