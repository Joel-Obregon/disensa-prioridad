import type { ReglaNegocio } from '../types/regla'

// Lee las dos reglas de control de alertas (visibilidad y recordatorio) desde
// la tabla reglas_negocio. Si la regla no existe o esta inactiva se usa el
// comportamiento por defecto (mostrar todo / recordatorio de 30 min).

export type VisibilidadAlertas = {
  rojas: boolean
  amarillas: boolean
  pedidos: boolean
  materiales: boolean
}

const VISIBLE_TODO: VisibilidadAlertas = {
  rojas: true,
  amarillas: true,
  pedidos: true,
  materiales: true,
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
  if (!reglaActiva(regla)) return VISIBLE_TODO
  const condicion = condicionRegla(regla)
  return {
    rojas: activada(condicion.rojas),
    amarillas: activada(condicion.amarillas),
    pedidos: activada(condicion.pedidos),
    materiales: activada(condicion.materiales),
  }
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
