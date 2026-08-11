import type { EstadoPedido, Pedido } from '../types/pedido'

export type SemaforoOperativo = 'critico' | 'riesgo' | 'a_tiempo' | 'cerrado'

type PedidoSemaforo = Pick<
  Pedido,
  | 'estado'
  | 'fecha_compromiso'
  | 'prioridad_calculada'
>

const estadosCerrados: EstadoPedido[] = ['entregado', 'cancelado', 'rechazado']

export function resolverSemaforoPedido(pedido: PedidoSemaforo): SemaforoOperativo {
  if (pedido.estado === 'entregado') return 'a_tiempo'
  if (estadosCerrados.includes(pedido.estado)) return 'cerrado'

  return resolverSemaforoPorRangoEntrega(pedido.fecha_compromiso)
}

// Al reabrir una entrega por reporte, el pedido vuelve a mostrar el rango de
// su fecha compromiso aun si antes estaba marcado como entregado. El motivo del
// reporte no cambia la regla: verde a tiempo, amarillo 1-7 dias y rojo desde 8.
export function resolverSemaforoPedidoReabierto(pedido: PedidoSemaforo): SemaforoOperativo {
  return resolverSemaforoPorRangoEntrega(pedido.fecha_compromiso)
}

function resolverSemaforoPorRangoEntrega(fechaCompromiso: string): SemaforoOperativo {
  // Semaforo segun el SLA del cliente (fecha_compromiso = dia de entrega del SLA):
  //  - verde hasta el dia planificado
  //  - amarillo de 1 a 7 dias de retraso
  //  - rojo desde los 8 dias de retraso
  const diasCompromiso = diasHasta(fechaCompromiso)

  if (diasCompromiso >= 0) return 'a_tiempo'
  if (diasCompromiso >= -7) return 'riesgo'
  return 'critico'
}

export function obtenerRangoSemaforoPedido(pedido: PedidoSemaforo) {
  const semaforo = resolverSemaforoPedido(pedido)
  const horasRetraso = calcularHorasRetraso(pedido.fecha_compromiso)
  const diasCompromiso = diasHasta(pedido.fecha_compromiso)

  return {
    diasCompromiso,
    horasRetraso,
    semaforo,
    tiempo: describirTiempoPedido(pedido),
  }
}

export function describirTiempoPedido(
  pedido: Pick<Pedido, 'fecha_compromiso' | 'estado' | 'fecha_reprogramada'>,
  opciones?: { reabiertoPorReporte?: boolean },
) {
  if (opciones?.reabiertoPorReporte) {
    return 'Gestion abierta por reporte'
  }

  if (['entregado', 'cancelado', 'rechazado'].includes(pedido.estado)) {
    return 'Gestion cerrada'
  }

  const dias = diasHasta(pedido.fecha_compromiso)

  if (dias >= 0) {
    if (dias === 0) return 'Vence hoy'
    if (dias <= 2) return `Vence en ${dias} d`
    return `A tiempo: ${dias} d disponibles`
  }

  const retraso = Math.abs(dias)

  if (retraso <= 7) return `${retraso} d de retraso`

  const fecha = formatearFechaCorta(pedido.fecha_reprogramada)
  return fecha
    ? `Retraso critico: ${retraso} d (reprogramado al ${fecha})`
    : `Retraso critico: ${retraso} d`
}

export function etiquetaSemaforo(semaforo: SemaforoOperativo) {
  if (semaforo === 'critico') return 'Prioridad critica'
  if (semaforo === 'riesgo') return 'En riesgo'
  if (semaforo === 'a_tiempo') return 'A tiempo'
  return 'Cerrado'
}

export function claseSemaforoBadge(semaforo: SemaforoOperativo) {
  if (semaforo === 'critico') return 'bg-red-600 text-white ring-1 ring-red-700'
  if (semaforo === 'riesgo') return 'bg-yellow-100 text-yellow-900 ring-1 ring-yellow-200'
  if (semaforo === 'a_tiempo') return 'bg-green-100 text-green-700 ring-1 ring-green-200'
  return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
}

export function claseSemaforoBorde(semaforo: SemaforoOperativo) {
  if (semaforo === 'critico') return 'border-red-300 ring-1 ring-red-100'
  if (semaforo === 'riesgo') return 'border-yellow-300 ring-1 ring-yellow-100'
  if (semaforo === 'a_tiempo') return 'border-green-200'
  return 'border-slate-200'
}

export function claseSemaforoBarra(semaforo: SemaforoOperativo) {
  if (semaforo === 'critico') return 'bg-red-600'
  if (semaforo === 'riesgo') return 'bg-yellow-500'
  if (semaforo === 'a_tiempo') return 'bg-green-500'
  return 'bg-slate-400'
}

export function clasePrioridadBadge(nivel: string) {
  if (nivel === 'Critica') return claseSemaforoBadge('critico')
  if (nivel === 'Alta') return claseSemaforoBadge('riesgo')
  if (nivel === 'Media') return 'bg-yellow-50 text-yellow-800 ring-1 ring-yellow-200'
  return claseSemaforoBadge('a_tiempo')
}

export function clasePrioridadBarra(nivel: string) {
  if (nivel === 'Critica') return claseSemaforoBarra('critico')
  if (nivel === 'Alta' || nivel === 'Media') return claseSemaforoBarra('riesgo')
  return claseSemaforoBarra('a_tiempo')
}

export function claseEstadoInventario(estado: 'disponible' | 'bajo_minimo' | 'sin_stock') {
  if (estado === 'sin_stock') return claseSemaforoBadge('critico')
  if (estado === 'bajo_minimo') return claseSemaforoBadge('riesgo')
  return claseSemaforoBadge('a_tiempo')
}

// Dias de retraso de un pedido calculados EXACTAMENTE igual que en el modulo
// de Pedidos (hora local del navegador). 0 = sin retraso; null = sin fecha.
export function diasRetrasoPedido(fecha?: string | null): number | null {
  if (!fecha) return null
  const dias = diasHasta(fecha)
  if (dias === 999) return null
  return dias < 0 ? Math.abs(dias) : 0
}

function diasHasta(fecha: string) {
  const fechaDestino = fechaLocal(fecha)
  if (Number.isNaN(fechaDestino.getTime())) return 999

  const hoy = inicioDia(new Date()).getTime()
  const destino = inicioDia(fechaDestino).getTime()

  return Math.ceil((destino - hoy) / 86_400_000)
}

function fechaLocal(fecha: string) {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha)
  if (coincidencia) {
    return new Date(
      Number(coincidencia[1]),
      Number(coincidencia[2]) - 1,
      Number(coincidencia[3]),
    )
  }

  return new Date(fecha)
}

export function calcularHorasRetraso(fecha: string) {
  const fechaDestino = new Date(fecha)
  if (Number.isNaN(fechaDestino.getTime())) return 0

  const diferencia = Date.now() - fechaDestino.getTime()

  if (diferencia <= 0) return 0
  return Math.max(1, Math.ceil(diferencia / 36e5))
}

function inicioDia(fecha: Date) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate())
}

function formatearFechaCorta(fecha?: string | null) {
  if (!fecha) return null
  const valor = new Date(fecha)
  if (Number.isNaN(valor.getTime())) return null
  return valor.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' })
}
