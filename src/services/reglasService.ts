import { supabase } from './supabaseClient'
import { consultarConCache } from './cacheService'
import type { ReglaNegocio } from '../types/regla'

export async function obtenerReglas() {
  return consultarConCache('reglas:activas', 60_000, () =>
    supabase
      .from('reglas_negocio')
      .select('*')
      .neq('nombre', 'Condicion de material')
      .order('peso', { ascending: false })
      .returns<ReglaNegocio[]>()
  )
}
