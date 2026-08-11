import type { ReglaNegocio } from '../types/regla'
import type { Alerta } from '../types/alerta'

// Lee las dos reglas de control de alertas (visibilidad y recordatorio) desde
// la tabla reglas_negocio.
//  - Visibilidad: si la regla NO existe se usa el comportamiento por defecto
//    (mostrar todo). Si la regla existe pero esta INACTIVA se ocultan TODAS
//    las alertas, aunque el recordatorio siga activo. Si esta activa, solo se
//    muestran las alertas marcadas en su configuracion.
//  - Recordatorio: solo tiene efecto mientras haya alertas visibles.

export type VisibilidadAlertas = {
  rojas: boolean
  amarillas: boolean
  pedidos: boolean
  materiales: boolean
  reportes: boolean
}

const VISIBLE_TODO: VisibilidadAlertas = {
  rojas: true,
  amarillas: true,
  pedidos: true,
  materiales: true,
  reportes: true,
}

const VISIBLE_NADA: VisibilidadAlertas = {
  rojas: false,
  amarillas: false,
  pedidos: false,
  materiales: false,
  reportes: false,
}

function reglaActiva(regla?: ReglaNegocio) {
  return !!regla && (regla.estado ?? 'activa') !== 'inactiva' && regla.activo !== false
}

function condicionRegla(regla?: ReglaNegocio): Record<string, unknown> {
  try {
    return regla?.condicion ? (JSON.parse(regla.condicion) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function activada(valor: unknown, porDefecto = true) {
  if (valor === undefined || valor === null || valor === '') return porDefecto
  if (typeof valor === 'boolean') return valor
  return Number(valor) !== 0
}

function buscarRegla(reglas: ReglaNegocio[], clave: string, nombre: string) {
  return reglas.find((regla) => regla.clave === clave || regla.nombre === nombre)
}

export function leerVisibilidadAlertas(reglas: ReglaNegocio[]): VisibilidadAlertas {
  const regla = buscarRegla(reglas, 'visibilidad_alertas', 'Visibilidad de alertas')
  if (!regla) return { ...VISIBLE_TODO, reportes: leerAlertasReportesHabilitadas(reglas) }
  // Regla inactivada: se ocultan todas las alertas, incluso si el recordatorio
  // sigue activo. La unica forma de mostrar alertas es con la regla activa.
  if (!reglaActiva(regla)) return VISIBLE_NADA
  const condicion = condicionRegla(regla)
  return {
    rojas: activada(condicion.rojas),
    amarillas: activada(condicion.amarillas),
    pedidos: activada(condicion.pedidos),
    materiales: activada(condicion.materiales),
    reportes: leerAlertasReportesHabilitadas(reglas),
  }
}

// Esta regla controla la generacion y la visualizacion de alertas de reportes.
// Si aun no existe (instalaciones anteriores), se conserva el comportamiento
// anterior y los reportes permanecen habilitados.
export function leerAlertasReportesHabilitadas(reglas: ReglaNegocio[]) {
  const regla = buscarRegla(reglas, 'alertas_reportes', 'Alertas de reportes')
  return !regla || reglaActiva(regla)
}

export function hayAlertaVisible(visibilidad: VisibilidadAlertas) {
  return (
    visibilidad.rojas ||
    visibilidad.amarillas ||
    visibilidad.pedidos ||
    visibilidad.materiales ||
    visibilidad.reportes
  )
}

// Evalua si una alerta cumple la configuracion de visibilidad (por color y por
// categoria: materiales/stock o pedidos). La misma regla aplica en el centro
// de alertas, los avisos flotantes, el recordatorio y el dashboard.
export function alertaVisiblePorVisibilidad(alerta: Alerta, visibilidad: VisibilidadAlertas) {
  if (esAlertaDeReporte(alerta)) return visibilidad.reportes

  const colorOk = alerta.nivel === 'critica' ? visibilidad.rojas : visibilidad.amarillas
  const categoriaOk = esAlertaDeMateriales(alerta) ? visibilidad.materiales : visibilidad.pedidos
  return colorOk && categoriaOk
}

export function esAlertaDeReporte(alerta: Pick<Alerta, 'tipo_alerta' | 'mensaje'>) {
  const texto = normalizarTexto(`${alerta.tipo_alerta || ''} ${alerta.mensaje || ''}`)
  return (
    texto.includes('reporte') ||
    texto.includes('nota_credito') ||
    texto.includes('nota credito')
  )
}

function esAlertaDeMateriales(alerta: Alerta) {
  const tipo = normalizarTexto(alerta.tipo_alerta || '')

  return (
    tipo.includes('stock') ||
    tipo.includes('inventario') ||
    tipo.includes('material') ||
    tipo.includes('falta') ||
    tipo.includes('agotar') ||
    tipo.includes('reabastecimiento')
  )
}

function normalizarTexto(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

export type RecordatorioConfig = {
  activo: boolean
  minutos: number
  // Claves de reglas DESmarcadas (no se recuerdan). Si esta vacio, se recuerdan todas.
  deseleccionadas: string[]
}

// Configuracion completa del recordatorio: si esta activo, cada cuantos minutos y
// que reglas quedaron sin marcar (para no repetir sus alertas).
export function leerRecordatorioConfig(reglas: ReglaNegocio[]): RecordatorioConfig {
  const regla = buscarRegla(reglas, 'recordatorio_alertas', 'Recordatorio de alertas')
  if (!reglaActiva(regla)) return { activo: false, minutos: 0, deseleccionadas: [] }
  // Sin alertas visibles (visibilidad inactiva o todo desmarcado) el
  // recordatorio no tiene nada que repetir ni que recordar.
  if (!hayAlertaVisible(leerVisibilidadAlertas(reglas))) {
    return { activo: false, minutos: 0, deseleccionadas: [] }
  }
  const condicion = condicionRegla(regla)
  const deseleccionadas = Object.keys(condicion)
    .filter((clave) => clave.startsWith('sel_') && Number(condicion[clave]) === 0)
    .map((clave) => clave.slice(4))
  return { activo: true, minutos: leerRecordatorioMinutos(reglas), deseleccionadas }
}

// Minutos del recordatorio. 0 = recordatorio desactivado (no parpadea por tiempo).
export function leerRecordatorioMinutos(reglas: ReglaNegocio[]): number {
  const regla = buscarRegla(reglas, 'recordatorio_alertas', 'Recordatorio de alertas')
  if (!reglaActiva(regla)) return 0
  if (!hayAlertaVisible(leerVisibilidadAlertas(reglas))) return 0
  const condicion = condicionRegla(regla)
  const valor = Number(condicion.valor)
  if (Number.isFinite(valor) && valor > 0) {
    const factor = Number(condicion.factor)
    const factorValido = Number.isFinite(factor) && factor > 0 ? factor : 1
    return valor * factorValido
  }
  // Compatibilidad con el formato anterior ({"minutos":N}).
  const minutos = Number(condicion.minutos)
  return Number.isFinite(minutos) && minutos > 0 ? minutos : 30
}
