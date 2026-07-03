import { supabase } from './supabaseClient'
import type { CriterioPrioridad } from '../lib/prioridad'

export type PrioridadCriterio = CriterioPrioridad & {
  etiqueta: string
  descripcion?: string | null
}

export async function obtenerPrioridadCriterios() {
  return supabase
    .from('prioridad_criterios')
    .select('clave, etiqueta, descripcion, orden, activo')
    .order('orden', { ascending: true })
    .returns<PrioridadCriterio[]>()
}

export async function guardarOrdenPrioridad(claves: string[]) {
  const resultados = await Promise.all(
    claves.map((clave, indice) =>
      supabase
        .from('prioridad_criterios')
        .update({ orden: indice + 1, updated_at: new Date().toISOString() })
        .eq('clave', clave)
    )
  )

  return { error: resultados.find((resultado) => resultado.error)?.error ?? null }
}

export function suscribirseACriteriosPrioridad(onCambio: () => void) {
  const channel = supabase
    .channel('prioridad-criterios-tiempo-real')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'prioridad_criterios' },
      () => onCambio(),
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
