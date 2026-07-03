# Motor de reglas de negocio parametrizable

Prototipo de tesis: *Plataforma web para la gestion y priorizacion de pedidos de
materiales de construccion mediante reglas de negocio y alertas visuales — DISENSA
Ecuador.*

Este documento describe el motor que ordena la cola de pedidos. Es **parametrizable**
(el administrador cambia pesos y umbrales sin tocar codigo) y **coherente** (el mismo
calculo se ejecuta en la base de datos y en la aplicacion).

## 1. Que hace

A cada pedido le asigna un **puntaje de prioridad de 0 a 100** sumando seis factores.
El puntaje define el orden de la cola y el nivel de atencion (Critica / Alta / Media /
Baja). Los pesos y umbrales de cada factor se leen de la tabla `reglas_negocio`, por lo
que se pueden ajustar desde el modulo **Reglas** de la aplicacion.

## 2. Fuente unica de verdad (archivos)

| Capa | Archivo | Rol |
|------|---------|-----|
| Base de datos | `supabase/18_motor_reglas_coherente.sql` | Funcion `prioridad_pedido_erp` + helpers `peso_regla_activa` y `parametro_regla_numero`. **Canonico.** Supersede a la version de `16_motor_reglas_parametrizables.sql`. |
| Aplicacion | `src/lib/prioridad.ts` | `calcularPrioridad()` reproduce 1:1 la funcion SQL para priorizar en pantalla. |
| Configuracion | `src/pages/Reglas.tsx` + `src/services/reglasService.ts` | UI para editar pesos y parametros; los guarda en `reglas_negocio`. |
| Datos | tabla `reglas_negocio` | Guarda `peso` y los parametros como JSON en la columna `condicion`. |

Regla de oro: si cambias una formula en `prioridad.ts`, replicala en la migracion 18
y viceversa. Ambas leen los mismos pesos y parametros, asi que la cola del ERP
(calculada en la BD) y la del prototipo (calculada en el navegador) coinciden.

## 3. Las cuatro reglas parametrizables

Se editan desde el modulo Reglas. El peso sale del **nivel de atencion** elegido
(Critica=40, Alta=30, Media=20, Seguimiento=10) y los parametros se guardan como JSON.

| Regla | Peso por defecto | Parametros (JSON en `condicion`) |
|-------|------------------|----------------------------------|
| Cantidad pendiente ERP | 35 | `cantidadMinima` 1, `cantidadAlta` 100, `cantidadCritica` 500 |
| Nota de credito pendiente | 30 | `notasMinimas` 1, `notasCriticas` 2 |
| Antiguedad del pedido | 20 | `diasSeguimiento` 14, `diasCriticos` 30, `diasProximos` 2, `diasRetrasoCritico` 60 |
| Valor pendiente | 15 | `valorRelevante` 1000, `valorAlto` 3000, `valorCritico` 5000 |

Si una regla se desactiva, su peso pasa a 0 y deja de influir en la prioridad.

## 4. Los seis factores del puntaje

1. **Estado operativo** (escala fija, hasta 40): sin_stock 40, retrasado 38,
   en_revision 32, pendiente 26, aprobado 18, en_despacho 14.
2. **STATUS ERP "pendiente por despacho"**: +20.
3. **Nota de credito pendiente**: si NC >= `notasCriticas` suma `min(40, peso+5)`;
   si NC >= `notasMinimas` suma `peso`.
4. **Cantidad pendiente ERP**: si cantidad >= `cantidadCritica` suma el `peso`;
   si >= `cantidadAlta` suma `round(peso*0.75)`; si >= `cantidadMinima` suma
   `max(5, round(peso*0.35))`.
5. **Valor pendiente**: >= `valorCritico` suma `peso+5`; >= `valorAlto` suma `peso`;
   >= `valorRelevante` suma `round(peso*0.7)`; > 0 suma `round(peso*0.35)`.
6. **Antiguedad / fecha objetivo**: vencido mas de `diasRetrasoCritico` dias +26;
   vencido +22; por vencer en <= `diasProximos` dias +14. Ademas, por edad del
   pedido: >= `diasCriticos` suma `max(0, peso-2)`; >= `diasSeguimiento` suma
   `round(peso*0.5)`.

El total se recorta al rango 0–100.

### Niveles de prioridad y semaforo

- Puntaje >= 80 → **Critica**; >= 50 → **Alta**; >= 20 → **Media**; resto → **Baja**.
- El **semaforo** del pedido (`src/lib/semaforoOperativo.ts`) es independiente y se basa
  en el retraso: rojo si supera ~2 meses de retraso (> 60 dias), amarillo si hay
  cualquier retraso o esta marcado retrasado, verde si esta dentro de plazo.

## 5. Como se parametriza (flujo)

1. El administrador abre **Reglas**, elige una regla y ajusta nivel de atencion y
   parametros numericos.
2. `reglasService.actualizarReglaNegocio()` guarda `peso`, `estado` y los parametros
   (`condicion` JSON) en `reglas_negocio` y registra auditoria.
3. Llama a la funcion `recalcular_pedidos_reglas_parametrizables()` y la app vuelve a
   calcular la prioridad en pantalla. La BD usa los mismos valores en su funcion.

## 6. Coherencia garantizada (verificacion)

El motor TypeScript y la funcion SQL se compararon en **31.500 combinaciones** de
estado, status ERP, notas de credito, cantidad, valor y fechas: **0 discrepancias**.
Con las reglas sembradas por la migracion 18 presentes, ambos motores devuelven el
mismo puntaje para cualquier pedido.

## 7. Despliegue en Supabase

En el editor SQL de Supabase, ejecutar **en orden**:

1. `schema_2_0_base_nueva.sql` (esquema base, si es instalacion nueva).
2. Migraciones `01` … `17` ya existentes.
3. **`18_motor_reglas_coherente.sql`** (este motor; es idempotente y no destructivo:
   no sobrescribe los pesos que el administrador ya haya personalizado).

La migracion 18 termina con `notify pgrst, 'reload schema'` para refrescar la API.

## 8. Como agregar una regla nueva

1. En la BD: `insert into reglas_negocio (...)` con su `peso`, `criterio`, `efecto` y,
   si tiene umbrales, su JSON en `condicion`.
2. En el motor SQL (`prioridad_pedido_erp`): leer su peso con `peso_regla_activa('<nombre>')`
   y sus umbrales con `parametro_regla_numero('<nombre>', '<clave>', <defecto>)`, y sumar
   su factor al `puntaje`.
3. En `src/lib/prioridad.ts`: anadir el nombre a `NOMBRE_REGLA`, el peso a `PESO_DEFECTO`,
   los umbrales a `PARAMETROS_DEFECTO` y la misma formula en `calcularPrioridad()`.
4. En `src/pages/Reglas.tsx`: anadir el bloque de parametros si debe editarse desde la UI.

## 9. Notas

- La antigua regla **"Condicion de material"** se retiro del modelo en
  `06_quitar_regla_condicion_material.sql`. La migracion 18 elimina el codigo muerto que
  todavia la leia, de modo que SQL y TypeScript quedan identicos. El campo
  `pedido.tiene_gestion_stock` se conserva como dato informativo del ERP pero **no**
  participa en el puntaje.
- **Pendiente (fuera de este motor):** el envio de correo al departamento cuando cae el
  stock. Hoy las alertas son visuales/in-app (nucleo del titulo del proyecto). El correo
  requeriria una Edge Function de Supabase y un proveedor de email (p. ej. Resend) con su
  clave configurada en los secretos del proyecto.
