const STORAGE_KEY = 'disensa_alertas_no_revisadas'
export const ALERTAS_NO_REVISADAS_EVENT = 'disensa:alertas-no-revisadas'

export function obtenerAlertasNoRevisadas() {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const ids = raw ? JSON.parse(raw) : []
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function guardarAlertasNoRevisadas(ids: string[]) {
  if (typeof window === 'undefined') return

  const unicas = [...new Set(ids)].slice(-30)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(unicas))
  window.dispatchEvent(
    new CustomEvent(ALERTAS_NO_REVISADAS_EVENT, {
      detail: unicas,
    })
  )
}

export function agregarAlertaNoRevisada(id: string) {
  guardarAlertasNoRevisadas([...obtenerAlertasNoRevisadas(), id])
}

export function limpiarAlertasNoRevisadas() {
  guardarAlertasNoRevisadas([])
}

export function escucharAlertasNoRevisadas(onChange: (ids: string[]) => void) {
  if (typeof window === 'undefined') return () => undefined

  const manejarCambio = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : null
    onChange(Array.isArray(detail) ? detail : obtenerAlertasNoRevisadas())
  }

  const manejarStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange(obtenerAlertasNoRevisadas())
  }

  window.addEventListener(ALERTAS_NO_REVISADAS_EVENT, manejarCambio)
  window.addEventListener('storage', manejarStorage)

  return () => {
    window.removeEventListener(ALERTAS_NO_REVISADAS_EVENT, manejarCambio)
    window.removeEventListener('storage', manejarStorage)
  }
}
