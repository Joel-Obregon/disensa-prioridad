// Silencia (solo el toast en tiempo real) las alertas de un pedido/material
// durante unos segundos, para que gestionar un pedido (revisar/aprobar/despachar)
// no dispare el aviso emergente de ese mismo pedido. La alerta sigue existiendo
// y aparece en el centro de alertas; solo se evita el toast repetido.
// Las alertas de stock del material NO se silencian por gestion de pedido:
// si el stock bajo tras un despacho, el aviso en tiempo real debe saltar.

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
  tipo_alerta?: string | null
}): boolean {
  const tipo = (alerta.tipo_alerta || '').toLowerCase()
  const esAlertaStock =
    tipo.includes('stock') ||
    tipo.includes('material') ||
    tipo.includes('inventario') ||
    tipo.includes('existencia') ||
    tipo.includes('falta')

  const silenciadoPorPedido = activo(`p:${alerta.pedido_id ?? ''}`)
  const silenciadoPorMaterial = activo(`m:${alerta.material_id ?? ''}`)

  if (esAlertaStock) return silenciadoPorMaterial

  return silenciadoPorPedido || silenciadoPorMaterial
}
