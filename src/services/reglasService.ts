import { supabase } from './supabaseClient'
import type { ReglaNegocio } from '../types/regla'

export async function obtenerReglas() {
  return supabase
    .from('reglas_negocio')
    .select('*')
    .order('peso', { ascending: false })
    .returns<ReglaNegocio[]>()
}
