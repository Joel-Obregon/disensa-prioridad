import { supabase } from './supabaseClient'
import { consultarConCache, invalidarCache } from './cacheService'
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

export type ReglaNegocioUpdate = Pick<
  ReglaNegocio,
  'accion' | 'activo' | 'color' | 'condicion' | 'criterio' | 'efecto' | 'estado' | 'peso'
>

export async function actualizarReglaNegocio(
  id: string,
  cambios: ReglaNegocioUpdate,
) {
  const resultado = await supabase
    .from('reglas_negocio')
    .update(cambios)
    .eq('id', id)
    .select('*')
    .single<ReglaNegocio>()

  if (!resultado.error) {
    invalidarCache('reglas:', 'pedidos', 'alertas')
    await recalcularPrioridadesSinRegenerarAlertas()
  }

  return resultado
}

async function recalcularPrioridadesSinRegenerarAlertas() {
  const resultado = await supabase.rpc('recalcular_pedidos_reglas_parametrizables')

  if (esFuncionOpcionalNoDisponible(resultado.error)) return
}

function esFuncionOpcionalNoDisponible(
  error: { code?: string; message?: string } | null | undefined,
) {
  if (!error) return false

  return (
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    error.message?.toLowerCase().includes('could not find the function') ||
    false
  )
}
