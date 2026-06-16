import type { Alerta } from '../types/alerta'

export const ALERTA_VISUAL_LOCAL_EVENT = 'disensa:alerta-visual-local'

export function emitirAlertaVisualLocal(alerta: Alerta | null | undefined) {
  if (typeof window === 'undefined' || !alerta) return

  window.dispatchEvent(
    new CustomEvent(ALERTA_VISUAL_LOCAL_EVENT, {
      detail: alerta,
    })
  )
}

export function escucharAlertasVisualesLocales(onAlerta: (alerta: Alerta) => void) {
  if (typeof window === 'undefined') return () => undefined

  const manejarAlerta = (event: Event) => {
    const alerta = event instanceof CustomEvent ? event.detail : null
    if (alerta?.id) onAlerta(alerta as Alerta)
  }

  window.addEventListener(ALERTA_VISUAL_LOCAL_EVENT, manejarAlerta)

  return () => {
    window.removeEventListener(ALERTA_VISUAL_LOCAL_EVENT, manejarAlerta)
  }
}
