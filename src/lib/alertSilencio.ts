// Silencia (solo el toast en tiempo real) las alertas de un pedido/material
// durante unos segundos, para que gestionar un pedido (revisar/aprobar/despachar)
// no dispare el aviso emergente de ese mismo material. La alerta sigue existiendo
// y aparece en el centro de alertas; solo se evita el toast repetido.

const silenciados = new Map<string, number>()

function activo(clave: string): boolean {
  const expira = silenciados.get(clave)
  if (!expira) return false
  if (Date.now() > expira) {
    silenciados.delete(clave)
    return false
  }
  return true
}

export function silenciarAlertasPedido(
  pedidoId?: string | null,
  materialId?: string | null,
  ms = 10000,
) {
  const expira = Date.now() + ms
  if (pedidoId) silenciados.set(`p:${pedidoId}`, expira)
  if (materialId) silenciados.set(`m:${materialId}`, expira)
}

export function alertaSilenciada(alerta: {
  pedido_id?: string | null
  material_id?: string | null
}): boolean {
  return activo(`p:${alerta.pedido_id ?? ''}`) || activo(`m:${alerta.material_id ?? ''}`)
}
