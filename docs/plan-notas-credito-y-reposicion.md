# Plan — Notas de crédito y reorganización de módulos

## 1. Roles definitivos (a quién le toca cada módulo)

| Módulo | Administrador | Bodega | Suministrador |
|---|---|---|---|
| **Pedidos** (bodega → franquiciado) | ve todo | **crea y gestiona** | — |
| **Reposición** (admin → suministrador) | **crea (reabastece bodega)** | — | **valida y envía** |
| Inventario | sí | sí | — |
| Alertas | sí | sí | sí |
| Reportes | sí | sí | — |
| Dashboard / Calendario | sí | sí | — |
| Reglas / Usuarios / Estado del sistema | sí | — | — |

Cambio respecto a hoy: **se le quita Reposición a bodega** (bodega solo trabaja Pedidos hacia franquiciados).

## 2. Módulo Pedidos (Bodega → Franquiciado)

- Bodega crea el pedido (uno o varios materiales, mismo código de pedido) y lo despacha.
- El franquiciado, desde la consulta de invitado, ve su pedido: **lista de materiales (o uno solo) con el código de pedido**, y puede:
  - Confirmar entrega.
  - Hacer un **reporte**: retraso, material defectuoso o **nota de crédito** (reembolso), eligiendo **por cuál material**.

## 3. Nota de crédito (reembolso) — flujo nuevo

**Quién la pide:** el franquiciado, en cualquier momento (típicamente cuando el pedido tiene muchos días de retraso).

**Cómo:** en su consulta elige el pedido → ve la lista de materiales → marca **uno o varios materiales** → "Solicitar nota de crédito" (con motivo). Cada material marcado queda con NC en estado *Solicitada*.

**Aprobación (en el módulo Pedidos, lo hace bodega):** por cada material con NC aparece un panel/acciones con el **proceso visible**:

`Solicitada → En revisión → Aprobada → Efectiva (reembolsada)` — o **Rechazada** con motivo.

- Al hacerse **Efectiva**, la nota de crédito queda como reembolso realizado para ese material.

**Técnico:** columna nueva `estado_nc` en `pedidos` (por fila = por material): `null | solicitada | en_revision | aprobada | efectiva | rechazada`, + motivo/fecha. La consulta invitada la pone en *solicitada*; Pedidos la avanza.

## 4. Módulo Reposición (Admin → Suministrador) — flujo nuevo

- **Admin** crea la reposición: pide material(es) y cantidad al suministrador (reabastece bodega). Estado inicial: *Solicitada*.
- **Suministrador** ve las solicitudes y valida si tiene el stock:
  - **Sí → "Confirmar y enviar"**: la cantidad **se suma al inventario de bodega** y la reposición pasa a *Enviada / Recibida*.
  - **No → "Sin stock"**: manda un **mensaje** (no cuentan con stock para el envío) y la reposición pasa a *Rechazada*; el admin lo ve.

## 5. Fases de implementación

1. **Roles**: quitar Reposición a bodega (admin + suministrador).
2. **Reposición nuevo flujo**: admin crea; suministrador "Confirmar y enviar" (suma a inventario) o "Sin stock" (mensaje). Estados y proceso visibles.
3. **Nota de crédito**: columna `estado_nc`; el franquiciado la solicita por material en la consulta; en Pedidos se aprueba/hace efectiva/rechaza con proceso visible.
