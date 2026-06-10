# Instalacion del sistema nuevo en Supabase

Este flujo crea una Supabase nueva para el sistema basado en `Seguimiento de Pedidos Ecuador.xlsx`.

## 1. Crear proyecto nuevo

1. Crea un proyecto nuevo en Supabase.
2. Copia `Project URL`.
3. Copia una `anon public key` para la app.
4. Copia la `service_role key` solo para la importacion local.

La `service_role key` no debe ir al frontend ni al repositorio.

## 2. Crear schema

En Supabase SQL Editor, ejecuta completo:

`supabase/schema_2_0_base_nueva.sql`

Este archivo crea:

- usuarios internos (`usuarios_app`)
- tablas del prototipo original (`materiales`, `pedidos`, `reglas_negocio`, `alertas`, `movimientos_inventario`, `auditoria`)
- proveedores
- solicitantes
- catalogo de materiales
- pedidos ERP
- lineas de pedido
- gestiones de proveedor
- solicitudes internas
- notas de credito y sus lineas
- bitacora de sincronizacion
- vistas KPI para la pantalla `Seguimiento 2.0`
- vista de demanda por material
- resumen de observaciones de importacion
- funcion `refrescar_prototipo_desde_erp_2_0()` para sincronizar el Dashboard, Inventario, Pedidos, Reglas y Alertas con el Excel

## 3. Crear usuarios Auth

El SQL crea perfiles en `usuarios_app`, pero los usuarios de login deben existir tambien en Supabase Auth.

Crea en Supabase Auth al menos un usuario con el mismo correo que el perfil:

- `admin@disensa.local`

Puedes cambiar el correo en `usuarios_app` si prefieres usar uno real. Lo importante es que el correo de Auth y el correo de `usuarios_app` coincidan.

## 4. Configurar la app

En `.env.local`, apunta la app a la nueva Supabase:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_ANON_KEY
```

Reinicia Vite despues de cambiar estas variables.

## 5. Importar el Excel

Abre PowerShell en la carpeta del proyecto:

```powershell
cd "C:\Users\Joel\Documents\Disensa-prioridad 2.0"
```

Ejecuta primero un ensayo local. Esto lee todas las hojas, transforma datos y valida relaciones, pero no sube nada:

```powershell
& "C:\Users\Joel\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\importar_excel_2_0.py "C:\Users\Joel\Downloads\Seguimiento de Pedidos Ecuador.xlsx" --dry-run
```

El ensayo debe terminar con `"ok": true`. Con el archivo actual deberias ver, aproximadamente:

- 55 proveedores
- 654 solicitantes
- 11.134 materiales
- 30.346 pedidos
- 96.414 lineas de pedido
- 663 gestiones
- 415 notas de credito
- 2.323 observaciones de coherencia

Si el ensayo sale correcto, prepara las credenciales de tu Supabase nueva. En Supabase:

1. Ve a `Project Settings`.
2. En `API`, copia `Project URL`.
3. Copia `service_role key`. Solo se usa localmente para importar, no va en `.env.local`.
4. En PowerShell pega estos comandos cambiando los valores:

```powershell
$env:SUPABASE_URL="https://TU-PROYECTO.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="TU_SERVICE_ROLE_KEY"
```

Ahora importa el Excel:

```powershell
& "C:\Users\Joel\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\importar_excel_2_0.py "C:\Users\Joel\Downloads\Seguimiento de Pedidos Ecuador.xlsx"
```

Durante la importacion el script llena las tablas normalizadas 2.0 y al final ejecuta automaticamente:

```sql
select public.refrescar_prototipo_desde_erp_2_0();
```

Esa sincronizacion es la que alimenta el prototipo de tesis:

- `materiales`: catalogo adaptado a inventario/demanda pendiente.
- `pedidos`: cola priorizada visible en Dashboard, Pedidos, Calendario y consulta invitada.
- `reglas_negocio`: reglas de negocio precargadas.
- `alertas`: alertas visuales de prioridad, stock/demanda, NC y sincronizacion.
- `movimientos_inventario` y `auditoria`: historial operativo.

El importador omite contrasenas del Excel. Usa contactos de proveedores cuando existen, pero no sube `ContrasenaUsada` ni las claves del formulario.

Si ya importaste y solo quieres reconstruir las pantallas del prototipo, ejecuta en Supabase SQL Editor:

```sql
select public.refrescar_prototipo_desde_erp_2_0();
```

## 6. Entrar al sistema

La app conserva la estructura de `disensa-prioridad` y agrega seguimiento ERP:

- Login
- Dashboard
- Pedidos priorizados
- Inventario
- Materiales
- Reglas de negocio
- Alertas visuales
- Reportes
- Calendario
- Seguimiento 2.0
- Estado sistema
- Usuarios

La ruta principal despues de login es `/dashboard`.

## Ensayo validado

Con el Excel actual, el importador transformo:

- 55 proveedores
- 654 solicitantes
- 11.134 materiales
- 30.346 pedidos
- 96.414 lineas de pedido
- 663 gestiones
- 95 solicitudes
- 415 notas de credito
- 367 lineas de nota de credito
- 50 eventos de sincronizacion
- 491 filas de consolidado NC

Tambien registro 2.323 observaciones de coherencia, principalmente pedidos sin detalle y materiales/relaciones que requieren revision.
