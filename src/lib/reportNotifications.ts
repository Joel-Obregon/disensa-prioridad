import type { Alerta } from '../types/alerta'

const STORAGE_KEY = 'disensa_reportes_no_revisados'
export const REPORTES_NO_REVISADOS_EVENT = 'disensa:reportes-no-revisados'

export type ReporteNoRevisado = {
  id: string
  nivel: Alerta['nivel']
}

export function obtenerReportesNoRevisados() {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const reportes = raw ? JSON.parse(raw) : []
    if (!Array.isArray(reportes)) return []

    // Compatibilidad con los identificadores que se guardaron antes de incluir
    // el color de la alerta. Esos avisos se muestran como amarillos.
    return reportes.flatMap((reporte): ReporteNoRevisado[] => {
      if (typeof reporte === 'string') return [{ id: reporte, nivel: 'alta' }]
      if (
        reporte &&
        typeof reporte.id === 'string' &&
        ['informativa', 'media', 'alta', 'critica'].includes(reporte.nivel)
      ) {
        return [{ id: reporte.id, nivel: reporte.nivel as Alerta['nivel'] }]
      }
      return []
    })
  } catch {
    return []
  }
}

export function guardarReportesNoRevisados(reportes: ReporteNoRevisado[]) {
  if (typeof window === 'undefined') return

  const porId = new Map(reportes.map((reporte) => [reporte.id, reporte]))
  const unicos = [...porId.values()].slice(-30)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(unicos))
  window.dispatchEvent(
    new CustomEvent(REPORTES_NO_REVISADOS_EVENT, {
      detail: unicos,
    })
  )
}

export function agregarReporteNoRevisado(reporte: ReporteNoRevisado) {
  guardarReportesNoRevisados([...obtenerReportesNoRevisados(), reporte])
}

// Si la alerta se resuelve desde cualquier sesion, se apaga de inmediato el
// indicador del modulo Reportes en las sesiones que aun no lo habian revisado.
export function quitarReporteNoRevisado(id: string) {
  guardarReportesNoRevisados(obtenerReportesNoRevisados().filter((reporte) => reporte.id !== id))
}

export function limpiarReportesNoRevisados() {
  guardarReportesNoRevisados([])
}

export function escucharReportesNoRevisados(onChange: (reportes: ReporteNoRevisado[]) => void) {
  if (typeof window === 'undefined') return () => undefined

  const manejarCambio = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : null
    onChange(Array.isArray(detail) ? detalleComoReportes(detail) : obtenerReportesNoRevisados())
  }

  const manejarStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange(obtenerReportesNoRevisados())
  }

  window.addEventListener(REPORTES_NO_REVISADOS_EVENT, manejarCambio)
  window.addEventListener('storage', manejarStorage)

  return () => {
    window.removeEventListener(REPORTES_NO_REVISADOS_EVENT, manejarCambio)
    window.removeEventListener('storage', manejarStorage)
  }
}

function detalleComoReportes(detalle: unknown[]): ReporteNoRevisado[] {
  return detalle.flatMap((reporte): ReporteNoRevisado[] => {
    if (typeof reporte === 'string') return [{ id: reporte, nivel: 'alta' }]
    if (
      reporte &&
      typeof reporte === 'object' &&
      'id' in reporte &&
      typeof reporte.id === 'string' &&
      'nivel' in reporte &&
      ['informativa', 'media', 'alta', 'critica'].includes(String(reporte.nivel))
    ) {
      return [{ id: reporte.id, nivel: reporte.nivel as Alerta['nivel'] }]
    }
    return []
  })
}
