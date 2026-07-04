import { supabase } from './supabaseClient'

// Control de sesion unica por usuario. Distintos usuarios (mismo o diferente rol)
// pueden entrar a la vez; el mismo usuario no puede tener dos sesiones activas.
// Una sesion se considera "activa" mientras su ultimo latido este dentro de la ventana.
const VENTANA_SESION_MS = 90_000
const CLAVE_SESION = 'disensa_session_id'

// Id estable por navegador: al recargar la misma pestana/navegador se conserva,
// asi que una recarga no cuenta como una segunda sesion. Otro equipo o navegador
// genera un id distinto y por eso queda bloqueado si ya hay una sesion activa.
export function obtenerSessionId() {
  try {
    let id = window.localStorage.getItem(CLAVE_SESION)
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `sid-${Date.now()}-${Math.random().toString(16).slice(2)}`
      window.localStorage.setItem(CLAVE_SESION, id)
    }
    return id
  } catch {
    return `sid-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

// Intenta reservar la sesion para este usuario. Devuelve { ok: false } si ya hay
// otra sesion activa (otro dispositivo/navegador) dentro de la ventana de tiempo.
// Ante cualquier error de base de datos falla en abierto (permite entrar) para no
// bloquear el acceso por un problema puntual de conexion.
export async function intentarRegistrarSesion(userId: string, correo?: string | null) {
  const sessionId = obtenerSessionId()

  try {
    const { data, error } = await supabase
      .from('sesiones_activas')
      .select('session_id, ultima_actividad')
      .eq('user_id', userId)
      .maybeSingle<{ session_id: string; ultima_actividad: string }>()

    if (error) return { ok: true, forzado: true }

    if (data && data.session_id !== sessionId) {
      const ultima = new Date(data.ultima_actividad).getTime()
      const activa = Number.isFinite(ultima) && Date.now() - ultima < VENTANA_SESION_MS
      if (activa) return { ok: false }
    }

    const { error: upsertError } = await supabase.from('sesiones_activas').upsert(
      {
        user_id: userId,
        session_id: sessionId,
        correo: correo || null,
        ultima_actividad: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )

    if (upsertError) return { ok: true, forzado: true }
    return { ok: true }
  } catch {
    return { ok: true, forzado: true }
  }
}

// Mantiene viva la sesion propia. Reafirma la propiedad de la fila para este
// usuario/navegador (se ejecuta periodicamente mientras hay sesion abierta).
export async function latidoSesion(userId: string, correo?: string | null) {
  const sessionId = obtenerSessionId()
  try {
    await supabase.from('sesiones_activas').upsert(
      {
        user_id: userId,
        session_id: sessionId,
        correo: correo || null,
        ultima_actividad: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
  } catch {
    // Silencioso: un fallo de latido no debe interrumpir el uso normal.
  }
}

// Libera la sesion al cerrar. Solo borra la fila si sigue siendo la sesion propia.
export async function liberarSesion(userId: string) {
  const sessionId = obtenerSessionId()
  try {
    await supabase
      .from('sesiones_activas')
      .delete()
      .eq('user_id', userId)
      .eq('session_id', sessionId)
  } catch {
    // Silencioso.
  }
}
