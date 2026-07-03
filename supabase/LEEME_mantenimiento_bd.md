# Scripts de mantenimiento de la base (revisados contra tu Supabase en vivo)

Generados tras auditar el proyecto `Disensa-Prioridad`. Cada script es para que
**tú lo ejecutes** en el editor SQL de Supabase. Ninguno se aplicó automáticamente.

> **Antes de empezar:** haz un respaldo en *Supabase > Database > Backups*.

## Orden recomendado

| # | Archivo | Qué hace | Riesgo |
|---|---------|----------|--------|
| 1 | `19_limpiar_capa_2_0_muerta.sql` | Borra 11 tablas vacías + 5 vistas + 2 funciones de la capa "2.0 ERP" sin uso. | Bajo (verificado: el front no depende de nada de eso). Reversible re-ejecutando `schema_2_0_base_nueva.sql`. |
| 2 | `22_reglas_condicion_json.sql` | Pasa los parámetros de las 4 reglas a JSON en `condicion`. No pisa reglas ya personalizadas. | Bajo. |
| 3 | `21_correos_pendientes.sql` | Parte 1: índices (segura). Luego eliges A (descartar 153 correos viejos) o B (activar correo real). | Bajo (Parte 1). La opción A borra la cola vieja. |
| 4 | `20_seguridad_rls_hardening.sql` | Activa RLS en 16 tablas + políticas + fija `search_path`. | **Medio: pruébalo y revisa que la app siga funcionando.** Córrelo al final. |

## Detalle

**1. Limpieza 2.0** — Quita la capa ERP que quedó muerta (tablas en 0 filas que
el frontend no usa). Verifiqué con `pg_depend` que solo dependían de ella 5 vistas
internas, ninguna usada por la app. Las funciones vivas (`limpiar_bases_operativas_3_0`,
`reaplicar_motor_reglas`) no se tocan.

**2. Reglas a JSON** — Hace que los parámetros de las reglas sean coherentes desde
la semilla (hoy el motor usa los valores por defecto hasta que editas cada regla).

**3. Correos** — Hay 153 correos en `notificaciones_correo` (estado `pendiente`) que
nadie envía. Dos caminos:
- **Opción A (sin correo):** descarta la cola vieja (una línea, descoméntala).
- **Opción B (con correo):** despliega la Edge Function
  `edge-functions/enviar-notificaciones-correo/` (Resend) y activa el trigger de
  encolado. Pasos y secretos están comentados en el `.ts` y en el `.sql`.

**4. Seguridad** — Tu Supabase reporta 16 tablas con RLS desactivado (la `anon key`
puede leer/escribir todo). El script activa RLS con políticas permisivas para no
romper la app (que usa login propio + anon key), y deja la base lista para
restringir de verdad si migras a Supabase Auth. **Corre este último y prueba la app.**

## No incluido a propósito
Quitar las columnas legacy de `pedidos` (`tipo_pedido`, `fecha_pedido`,
`fecha_requerida`, `prioridad`, `observaciones`): la función viva
`refrescar_prototipo_bodega_fq()` todavía las escribe, así que hay que editarla
primero. Lo dejo documentado al final de `22_...sql` y lo preparo aparte si quieres.
