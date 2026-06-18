/**
 * Motor de priorizacion de pedidos para el prototipo de tesis:
 * "Plataforma web para la gestion y priorizacion de pedidos de materiales
 *  de construccion mediante reglas de negocio y alertas visuales - DISENSA Ecuador"
 *
 * Implementacion TypeScript alineada con la funcion SQL
 * `public.prioridad_pedido_erp` del archivo supabase/schema_2_0_base_nueva.sql.
 * Ambas deben mantenerse sincronizadas para garantizar coherencia entre
 * la cola operativa ERP y la cola del prototipo (Pedidos priorizados).
 *
 * La prioridad se calcula sobre 100 puntos totales sumando:
 *   - Estado operativo: hasta 40 pts
 *   - STATUS ERP pendiente por despacho: 20 pts
 *   - NC pendientes: peso de la regla "Nota de credito pendiente"
 *   - Cantidad pendiente ERP: hasta el peso de la regla "Cantidad pendiente ERP"
 *   - Valor pendiente: hasta peso + 5 de la regla "Valor pendiente"
 *   - Fecha objetivo vencida: 22 pts
 *   - Fecha objetivo proxima: 14 pts
 *   - Antiguedad del pedido: hasta peso - 2 de la regla "Antiguedad del pedido"
 */

import type { Pedido } from '../types/pedido'
import type { ReglaNegocio } from '../types/regla'

const MILISEGUNDOS_DIA = 86_400_000

// Nombres exactos de las reglas en la tabla reglas_negocio de Supabase.
// Si cambias el nombre de una regla en la BD, actualiza aqui tambien.
const NOMBRE_REGLA = {
  cantidad_pendiente: 'Cantidad pendiente ERP',
  nota_credito: 'Nota de credito pendiente',
  antiguedad: 'Antiguedad del pedido',
  valor_pendiente: 'Valor pendiente',
} as const

// Pesos de respaldo cuando la regla no existe o esta inactiva en BD.
// Coinciden con los pesos definidos en el INSERT de schema_2_0_base_nueva.sql.
const PESO_DEFECTO = {
  cantidad_pendiente: 35,
  nota_credito: 30,
  antiguedad: 20,
  valor_pendiente: 15,
} as const

const PARAMETROS_DEFECTO = {
  cantidad_pendiente: {
    cantidadMinima: 1,
    cantidadAlta: 100,
    cantidadCritica: 500,
  },
  nota_credito: {
    notasMinimas: 1,
    notasCriticas: 2,
  },
  antiguedad: {
    diasSeguimiento: 14,
    diasCriticos: 30,
    diasProximos: 2,
    diasRetrasoCritico: 60,
  },
  valor_pendiente: {
    valorRelevante: 1000,
    valorAlto: 3000,
    valorCritico: 5000,
  },
} as const

function pesoRegla(
  reglas: ReglaNegocio[],
  nombre: keyof typeof NOMBRE_REGLA,
): number {
  const regla = reglas.find((r) => r.nombre === NOMBRE_REGLA[nombre])

  if (!regla) return PESO_DEFECTO[nombre]
  if ((regla.estado ?? 'activa') === 'inactiva' || regla.activo === false) return 0

  return regla.peso
}

/**
 * Calcula el puntaje de prioridad de un pedido (0-100).
 *
 * Para pedidos importados desde Excel, usa las senales ERP sincronizadas en
 * `pedidos`: status_erp, nc_pendientes y tiene_gestion_stock. Para pedidos
 * creados manualmente en el prototipo conserva valores de respaldo desde los
 * campos antiguos.
 */
export function calcularPrioridad(
  pedido: Pedido,
  reglas: ReglaNegocio[] = [],
): number {
  let puntaje = 0

  const estado = pedido.estado ?? 'pendiente'
  puntaje += estadoAPuntaje(estado)

  const statusErp = normalizarTexto(pedido.status_erp)
  if (statusErp.includes('pendiente por despacho')) {
    puntaje += 20
  }

  if (tieneNotaCreditoPendiente(pedido)) {
    const parametros = parametrosRegla(reglas, 'nota_credito')
    const pesoNotaCredito = pesoRegla(reglas, 'nota_credito')
    const notasPendientes = pedido.nc_pendientes ?? 1

    if (pesoNotaCredito > 0 && notasPendientes >= parametros.notasCriticas) {
      puntaje += Math.min(40, pesoNotaCredito + 5)
    } else if (pesoNotaCredito > 0 && notasPendientes >= parametros.notasMinimas) {
      puntaje += pesoNotaCredito
    }
  }

  const cantidadPendiente = cantidadPendientePedido(pedido)
  const parametrosCantidad = parametrosRegla(reglas, 'cantidad_pendiente')
  if (cantidadPendiente >= parametrosCantidad.cantidadMinima) {
    const pesoCantidad = pesoRegla(reglas, 'cantidad_pendiente')
    if (pesoCantidad > 0 && cantidadPendiente >= parametrosCantidad.cantidadCritica) {
      puntaje += pesoCantidad
    } else if (pesoCantidad > 0 && cantidadPendiente >= parametrosCantidad.cantidadAlta) {
      puntaje += Math.round(pesoCantidad * 0.75)
    } else if (pesoCantidad > 0) {
      puntaje += Math.max(5, Math.round(pesoCantidad * 0.35))
    }
  }

  const valorPendiente = pedido.valor_pendiente ?? 0
  const pesoValor = pesoRegla(reglas, 'valor_pendiente')
  const parametrosValor = parametrosRegla(reglas, 'valor_pendiente')
  if (pesoValor > 0 && valorPendiente >= parametrosValor.valorCritico) {
    puntaje += pesoValor + 5
  } else if (pesoValor > 0 && valorPendiente >= parametrosValor.valorAlto) {
    puntaje += pesoValor
  } else if (pesoValor > 0 && valorPendiente >= parametrosValor.valorRelevante) {
    puntaje += Math.round(pesoValor * 0.7)
  } else if (pesoValor > 0 && valorPendiente > 0) {
    puntaje += Math.round(pesoValor * 0.35)
  }

  const parametrosAntiguedad = parametrosRegla(reglas, 'antiguedad')
  const pesoAntiguedad = pesoRegla(reglas, 'antiguedad')
  const diasObjetivo = calcularDiasHasta(pedido.fecha_compromiso)
  const diasPedido = calcularDiasDesde(pedido.fecha_solicitud)

  if (pesoAntiguedad > 0) {
    if (diasObjetivo < -parametrosAntiguedad.diasRetrasoCritico) {
      puntaje += 26
    } else if (diasObjetivo < 0) {
      puntaje += 22
    } else if (diasObjetivo <= parametrosAntiguedad.diasProximos) {
      puntaje += 14
    }

    if (diasPedido >= parametrosAntiguedad.diasCriticos) {
      puntaje += Math.max(0, pesoAntiguedad - 2)
    } else if (diasPedido >= parametrosAntiguedad.diasSeguimiento) {
      puntaje += Math.round(pesoAntiguedad * 0.5)
    }
  }

  return Math.min(100, Math.max(0, puntaje))
}

export function resolverNivelPrioridad(
  puntaje: number,
  pedido?: Pick<Pedido, 'fecha_compromiso' | 'estado'>,
): 'Critica' | 'Alta' | 'Media' | 'Baja' {
  if (pedido && pedidoCerrado(pedido)) return 'Baja'
  if (puntaje >= 80) return 'Critica'
  if (puntaje >= 50) return 'Alta'
  if (puntaje >= 20) return 'Media'
  return 'Baja'
}

export function ordenarPorPrioridad(
  pedidos: Pedido[],
  reglas: ReglaNegocio[] = [],
): Pedido[] {
  return [...pedidos].sort((a, b) => {
    const cerradoDiff = Number(pedidoCerrado(a)) - Number(pedidoCerrado(b))
    if (cerradoDiff !== 0) return cerradoDiff

    // La cola operativa debe subir primero los pedidos abiertos con mas dias de retraso.
    const retrasoDiff = calcularDiasRetraso(b.fecha_compromiso) - calcularDiasRetraso(a.fecha_compromiso)
    if (retrasoDiff !== 0) return retrasoDiff

    const diff = calcularPrioridad(b, reglas) - calcularPrioridad(a, reglas)
    if (diff !== 0) return diff

    return calcularDiasDesde(b.fecha_solicitud) - calcularDiasDesde(a.fecha_solicitud)
  })
}

function estadoAPuntaje(estado: string): number {
  switch (estado) {
    case 'sin_stock':
      return 40
    case 'retrasado':
      return 38
    case 'en_revision':
      return 32
    case 'pendiente':
      return 26
    case 'aprobado':
      return 18
    case 'en_despacho':
      return 14
    default:
      return 0
  }
}

function tieneNotaCreditoPendiente(pedido: Pedido): boolean {
  if (typeof pedido.nc_pendientes === 'number') {
    return pedido.nc_pendientes > 0
  }

  return (
    pedido.accion_solicitante === 'nota_credito' &&
    !['entregado', 'cancelado', 'rechazado'].includes(pedido.estado)
  )
}

function cantidadPendientePedido(pedido: Pedido): number {
  if ((pedido.cantidad_despacho ?? 0) > 0) {
    return pedido.cantidad_despacho ?? 0
  }

  return pedido.cantidad ?? 0
}

function parametrosRegla<K extends keyof typeof PARAMETROS_DEFECTO>(
  reglas: ReglaNegocio[],
  nombre: K,
): (typeof PARAMETROS_DEFECTO)[K] {
  const regla = reglas.find((item) => item.nombre === NOMBRE_REGLA[nombre])
  const parametrosDefecto = PARAMETROS_DEFECTO[nombre]

  if (!regla?.condicion?.trim().startsWith('{')) return parametrosDefecto

  try {
    const guardados = JSON.parse(regla.condicion) as Record<string, unknown>
    const parametros = { ...parametrosDefecto } as Record<string, number>

    Object.keys(parametros).forEach((llave) => {
      const valor = Number(guardados[llave])
      if (Number.isFinite(valor) && valor >= 0) parametros[llave] = valor
    })

    return parametros as (typeof PARAMETROS_DEFECTO)[K]
  } catch {
    return parametrosDefecto
  }
}

function normalizarTexto(valor?: string | null): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function calcularDiasDesde(fecha?: string | null): number {
  const fechaBase = fechaADia(fecha)
  if (fechaBase === null) return 0
  return Math.max(0, Math.floor((hoyADia() - fechaBase) / MILISEGUNDOS_DIA))
}

function calcularDiasHasta(fecha?: string | null): number {
  const fechaBase = fechaADia(fecha)
  if (fechaBase === null) return 999
  return Math.ceil((fechaBase - hoyADia()) / MILISEGUNDOS_DIA)
}

function calcularDiasRetraso(fecha?: string | null): number {
  return Math.max(0, -calcularDiasHasta(fecha))
}

function pedidoCerrado(pedido: Pick<Pedido, 'estado'>): boolean {
  return ['entregado', 'cancelado', 'rechazado'].includes(pedido.estado)
}

function fechaADia(fecha?: string | null): number | null {
  if (!fecha) return null
  const valor = new Date(fecha)
  if (Number.isNaN(valor.getTime())) return null
  return new Date(valor.getFullYear(), valor.getMonth(), valor.getDate()).getTime()
}

function hoyADia(): number {
  const hoy = new Date()
  return new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime()
}
