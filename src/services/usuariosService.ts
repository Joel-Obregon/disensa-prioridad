import { consultarConCache, invalidarCache } from './cacheService'
import { supabase } from './supabaseClient'
import type { RolUsuario, UsuarioApp } from '../types/usuario'

export type UsuarioInput = {
  nombre: string
  correo: string
  rol: RolUsuario
}

export type UsuarioRegistroInput = UsuarioInput & {
  password: string
}

export async function obtenerUsuariosApp() {
  return consultarConCache('usuarios:app', 15_000, () =>
    supabase
      .from('usuarios_app')
      .select('*')
      .order('created_at', { ascending: false })
      .returns<UsuarioApp[]>()
  )
}

export async function obtenerUsuarioPorCorreo(correo: string) {
  const correoNormalizado = correo.trim().toLowerCase()

  return supabase
    .from('usuarios_app')
    .select('*')
    .ilike('correo', correoNormalizado)
    .eq('estado', 'activo')
    .maybeSingle<UsuarioApp>()
}

export async function crearUsuarioApp(usuario: UsuarioInput) {
  const result = await supabase.from('usuarios_app').upsert(
    {
      ...usuario,
      estado: 'activo',
    },
    { onConflict: 'correo' }
  )

  if (!result.error) invalidarCache('usuarios')
  return result
}

// Crea el usuario en Supabase Auth YA CONFIRMADO (via Edge Function admin) para
// que pueda iniciar sesion de inmediato, y registra su rol en usuarios_app.
export async function registrarUsuarioConAuth(usuario: UsuarioRegistroInput) {
  const { data, error } = await supabase.functions.invoke('crear-usuario-app', {
    body: {
      nombre: usuario.nombre,
      correo: usuario.correo,
      password: usuario.password,
      rol: usuario.rol,
    },
  })

  if (error) return { error }
  if (data && data.ok === false) {
    return { error: new Error(data.error || 'No se pudo crear el usuario.') }
  }

  invalidarCache('usuarios')
  return { error: null, data }
}

export async function actualizarEstadoUsuario(id: string, estado: UsuarioApp['estado']) {
  const result = await supabase.from('usuarios_app').update({ estado }).eq('id', id)

  if (!result.error) invalidarCache('usuarios')
  return result
}

// Elimina al usuario de TODOS lados en Supabase (rol interno usuarios_app + Auth)
// mediante una Edge Function con service_role. Solo un administrador puede.
export async function eliminarUsuarioApp(correo: string) {
  const { data, error } = await supabase.functions.invoke('eliminar-usuario-app', {
    body: { correo },
  })

  if (error) return { error }
  if (data && data.ok === false) {
    return { error: new Error(data.error || 'No se pudo eliminar el usuario.') }
  }

  invalidarCache('usuarios')
  return { error: null, data }
}
