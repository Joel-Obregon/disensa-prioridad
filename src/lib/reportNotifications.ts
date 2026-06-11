const STORAGE_KEY = 'disensa_reportes_no_revisados'
export const REPORTES_NO_REVISADOS_EVENT = 'disensa:reportes-no-revisados'

export function obtenerReportesNoRevisados() {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const ids = raw ? JSON.parse(raw) : []
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function guardarReportesNoRevisados(ids: string[]) {
  if (typeof window === 'undefined') return

  const unicos = [...new Set(ids)].slice(-30)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(unicos))
  window.dispatchEvent(
    new CustomEvent(REPORTES_NO_REVISADOS_EVENT, {
      detail: unicos,
    })
  )
}

export function agregarReporteNoRevisado(id: string) {
  guardarReportesNoRevisados([...obtenerReportesNoRevisados(), id])
}

export function limpiarReportesNoRevisados() {
  guardarReportesNoRevisados([])
}

export function escucharReportesNoRevisados(onChange: (ids: string[]) => void) {
  if (typeof window === 'undefined') return () => undefined

  const manejarCambio = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : null
    onChange(Array.isArray(detail) ? detail : obtenerReportesNoRevisados())
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
