import type { Alerta } from '../types/alerta'

export const ALERTA_VISUAL_LOCAL_EVENT = 'disensa:alerta-visual-local'

export type OpcionesAlertaVisualLocal = {
  forzarNotificacion?: boolean
}

export function emitirAlertaVisualLocal(
  alerta: Alerta | null | undefined,
  opciones: OpcionesAlertaVisualLocal = {}
) {
  if (typeof window === 'undefined' || !alerta) return

  window.dispatchEvent(
    new CustomEvent(ALERTA_VISUAL_LOCAL_EVENT, {
      detail: {
        alerta,
        opciones,
      },
    })
  )
}

export function escucharAlertasVisualesLocales(
  onAlerta: (alerta: Alerta, opciones: OpcionesAlertaVisualLocal) => void
) {
  if (typeof window === 'undefined') return () => undefined

  const manejarAlerta = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : null
    const alerta = detail?.alerta || detail
    const opciones = detail?.opciones || {}

    if (alerta?.id) onAlerta(alerta as Alerta, opciones)
  }

  window.addEventListener(ALERTA_VISUAL_LOCAL_EVENT, manejarAlerta)

  return () => {
    window.removeEventListener(ALERTA_VISUAL_LOCAL_EVENT, manejarAlerta)
  }
}
