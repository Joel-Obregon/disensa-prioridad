/**
 * Motor de priorizacion de pedidos para el prototipo de tesis:
 * "Plataforma web para la gestion y priorizacion de pedidos de materiales
 *  de construccion mediante reglas de negocio y alertas visuales - DISENSA Ecuador"
 *
 * Motor PARAMETRIZABLE: lee peso y umbrales de cada regla desde la tabla
 * `reglas_negocio` (columna `condicion` con JSON). Si una regla esta inactiva su
 * peso es 0 y deja de influir. Las reglas se editan en el modulo Reglas.
 *
 * Reglas que afectan la PRIORIDAD del pedido (0-100):
 *   - Material sin existencia: stock disponible = 0
 *   - Stock critico: stock disponible por debajo de la cantidad requerida
 *   - Retraso vs SLA por tramos: amarillo (1-6 d), naranja/reprogramado (7-30 d) y
 *     rojo critico (+30 d), segun los dias de retraso del dia de entrega del SLA
 *   - Franquiciado solicita NC: nota de credito pendiente
 *
 * Las reglas de inventario y de franquiciado (por agotarse, multifranquiciado,
 * alta frecuencia, no planificable) generan ALERTAS desde la BD; aqui solo se
 * usan las que ordenan la cola de pedidos.
 */

import type { Pedido } from '../types/pedido'
import type { ReglaNegocio } from '../types/regla'

const MILISEGUNDOS_DIA = 86_400_000

// Nombres exactos de las reglas en la tabla reglas_negocio de Supabase.
const NOMBRE_REGLA = {
  sin_existencia: 'Material sin existencia',
  stock_critico: 'Stock critico',
  retraso_amarillo: 'Retraso del pedido (amarillo)',
  retraso_naranja: 'Reprogramado por retraso (naranja)',
  retraso_critico: 'Retraso critico (rojo)',
  franquiciado_nc: 'Franquiciado solicita NC',
} as const

// Pesos de respaldo (si la regla no existe en BD). Coinciden con la semilla de
// supabase/24_reglas_negocio_nuevas.sql.
const PESO_DEFECTO = {
  sin_existencia: 40,
  stock_critico: 30,
  retraso_amarillo: 20,
  retraso_naranja: 30,
  retraso_critico: 40,
  franquiciado_nc: 30,
} as const

const PARAMETROS_DEFECTO = {
  retraso_amarillo: { diasDesde: 1, diasHasta: 6 },
  retraso_naranja: { diasDesde: 7, diasHasta: 30 },
  retraso_critico: { diasDesde: 31 },
  stock_critico: { factorMinimo: 1 },
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
 * Calcula el puntaje de prioridad de un pedido (0-100) con las reglas activas.
 */
export function calcularPrioridad(
  pedido: Pedido,
  reglas: ReglaNegocio[] = [],
): number {
  let puntaje = 0

  const stock = pedido.stock_disponible ?? 0
  const cantidad = cantidadPendientePedido(pedido)

  // R4 Material sin existencia / R1 Stock critico (excluyentes)
  const pesoSinExistencia = pesoRegla(reglas, 'sin_existencia')
  const pesoStockCritico = pesoRegla(reglas, 'stock_critico')
  const factorMinimo = parametrosRegla(reglas, 'stock_critico').factorMinimo
  if (pesoSinExistencia > 0 && stock <= 0) {
    puntaje += pesoSinExistencia
  } else if (pesoStockCritico > 0 && cantidad > 0 && stock < cantidad * factorMinimo) {
    puntaje += pesoStockCritico
  }

  // Retraso vs SLA por tramos (excluyentes): amarillo 1-6 d, naranja/reprogramado
  // 7-30 d, rojo critico +30 d. Solo aplica a pedidos abiertos.
  if (!pedidoCerrado(pedido)) {
    const retraso = calcularDiasRetraso(pedido.fecha_compromiso)
    const pesoRojo = pesoRegla(reglas, 'retraso_critico')
    const paramRojo = parametrosRegla(reglas, 'retraso_critico')
    const pesoNaranja = pesoRegla(reglas, 'retraso_naranja')
    const paramNaranja = parametrosRegla(reglas, 'retraso_naranja')
    const pesoAmarillo = pesoRegla(reglas, 'retraso_amarillo')
    const paramAmarillo = parametrosRegla(reglas, 'retraso_amarillo')

    if (pesoRojo > 0 && retraso >= paramRojo.diasDesde) {
      puntaje += pesoRojo
    } else if (
      pesoNaranja > 0 &&
      retraso >= paramNaranja.diasDesde &&
      retraso <= paramNaranja.diasHasta
    ) {
      puntaje += pesoNaranja
    } else if (
      pesoAmarillo > 0 &&
      retraso >= paramAmarillo.diasDesde &&
      retraso <= paramAmarillo.diasHasta
    ) {
      puntaje += pesoAmarillo
    }
  }

  // R9 Franquiciado solicita NC
  const pesoNc = pesoRegla(reglas, 'franquiciado_nc')
  if (pesoNc > 0 && tieneNotaCreditoPendiente(pedido)) {
    puntaje += pesoNc
  }

  return Math.min(100, Math.max(0, puntaje))
}

export function resolverNivelPrioridad(
  puntaje: number,
  pedido?: Pick<Pedido, 'fecha_compromiso' | 'estado'>,
): 'Critica' | 'Alta' | 'Media' | 'Baja' {
  if (pedido && pedidoCerrado(pedido)) return 'Baja'

  // El retraso vs SLA define el nivel (coherente con el semaforo):
  // rojo (+30 d) = critica, naranja (7-30 d) = alta.
  if (pedido) {
    const retraso = calcularDiasRetraso(pedido.fecha_compromiso)
    if (retraso > 30) return 'Critica'
    if (retraso >= 7) return 'Alta'
  }

  if (puntaje >= 70) return 'Critica'
  if (puntaje >= 40) return 'Alta'
  if (puntaje >= 20) return 'Media'
  return 'Baja'
}

export type ClavePrioridad = 'retraso' | 'valor_venta' | 'franquiciado_frecuente'

export type CriterioPrioridad = {
  clave: ClavePrioridad
  orden: number
  activo?: boolean
}

const CRITERIOS_PRIORIDAD_DEFECTO: CriterioPrioridad[] = [
  { clave: 'retraso', orden: 1 },
  { clave: 'valor_venta', orden: 2 },
  { clave: 'franquiciado_frecuente', orden: 3 },
]

/**
 * Ordena la cola de pedidos por una LISTA de criterios en orden estricto (1, 2,
 * 3...). Decide el primer criterio; si dos pedidos empatan, decide el siguiente.
 * Criterios: retraso (dias), valor de venta y frecuencia del franquiciado.
 */
export function ordenarPorPrioridad(
  pedidos: Pedido[],
  criterios: CriterioPrioridad[] = [],
  frecuenciaPorCliente?: Map<string, number>,
): Pedido[] {
  const orden = (criterios.length ? criterios : CRITERIOS_PRIORIDAD_DEFECTO)
    .filter((criterio) => criterio.activo !== false)
    .slice()
    .sort((a, b) => a.orden - b.orden)
    .map((criterio) => criterio.clave)

  // Frecuencia = total de compras (pedidos) que ha hecho cada franquiciado.
  // Lo ideal es recibir un mapa calculado sobre TODOS los pedidos (historico);
  // si no se pasa, se calcula sobre la lista recibida.
  const frecuencia = frecuenciaPorCliente ?? construirFrecuenciaClientes(pedidos)

  const valorCriterio = (pedido: Pedido, clave: ClavePrioridad): number => {
    // Pedidos atrasados: mas dias de retraso = mas prioridad.
    if (clave === 'retraso') return calcularDiasRetraso(pedido.fecha_compromiso)
    // Alto valor de venta: valor monetario del pedido (precio x materiales);
    // si no hay valor, usa la cantidad de materiales como referencia.
    if (clave === 'valor_venta') {
      return Number(pedido.valor_pendiente) || Number(pedido.cantidad) || 0
    }
    // Franquiciado frecuente: total de compras del franquiciado.
    return frecuencia.get(pedido.cedula_solicitante || '') ?? 0
  }

  return [...pedidos].sort((a, b) => {
    const cerradoDiff = Number(pedidoCerrado(a)) - Number(pedidoCerrado(b))
    if (cerradoDiff !== 0) return cerradoDiff

    // Orden estricto por los criterios configurados (1o, 2o, 3o...).
    for (const clave of orden) {
      const diff = valorCriterio(b, clave) - valorCriterio(a, clave)
      if (diff !== 0) return diff
    }

    return calcularDiasDesde(b.fecha_solicitud) - calcularDiasDesde(a.fecha_solicitud)
  })
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

/**
 * Cuenta el total de compras (pedidos) por franquiciado (cedula_solicitante).
 * Se usa para el criterio "franquiciado frecuente": quien mas ha comprado pesa mas.
 */
export function construirFrecuenciaClientes(pedidos: Pedido[]): Map<string, number> {
  const frecuencia = new Map<string, number>()
  pedidos.forEach((pedido) => {
    const cliente = pedido.cedula_solicitante || ''
    if (cliente) frecuencia.set(cliente, (frecuencia.get(cliente) || 0) + 1)
  })
  return frecuencia
}
