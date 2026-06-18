import { supabase } from './supabaseClient'
import type { Auditoria } from '../types/auditoria'

export type AuditoriaInput = {
  entidad: string
  entidad_id?: string | null
  accion: string
  detalle: string
  responsable?: string
}

export async function obtenerAuditoria() {
  return supabase
    .from('auditoria')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<Auditoria[]>()
}

export async function obtenerAuditoriaPorEntidad(entidad: string, limite = 20) {
  return supabase
    .from('auditoria')
    .select('*')
    .eq('entidad', entidad)
    .order('created_at', { ascending: false })
    .limit(limite)
    .returns<Auditoria[]>()
}

export async function registrarAuditoria(input: AuditoriaInput) {
  return supabase.from('auditoria').insert({
    entidad: input.entidad,
    entidad_id: input.entidad_id || null,
    accion: input.accion,
    detalle: input.detalle,
    responsable: input.responsable || 'Administrador',
  })
}
