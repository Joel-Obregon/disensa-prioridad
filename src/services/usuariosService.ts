import { createClient } from '@supabase/supabase-js'
import { supabase, supabaseAnonKey, supabaseUrl } from './supabaseClient'
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
  return supabase
    .from('usuarios_app')
    .select('*')
    .order('created_at', { ascending: false })
    .returns<UsuarioApp[]>()
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
  return supabase.from('usuarios_app').upsert(
    {
      ...usuario,
      estado: 'activo',
    },
    { onConflict: 'correo' }
  )
}

export async function registrarUsuarioConAuth(usuario: UsuarioRegistroInput) {
  const authAdminSeguro = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const authResult = await authAdminSeguro.auth.signUp({
    email: usuario.correo,
    password: usuario.password,
    options: {
      data: {
        nombre: usuario.nombre,
        rol: usuario.rol,
      },
    },
  })

  if (authResult.error) {
    const mensaje = authResult.error.message.toLowerCase()

    if (mensaje.includes('user already registered') || mensaje.includes('already registered')) {
      return crearUsuarioApp({
        nombre: usuario.nombre,
        correo: usuario.correo,
        rol: usuario.rol,
      })
    }

    return authResult
  }

  return crearUsuarioApp({
    nombre: usuario.nombre,
    correo: usuario.correo,
    rol: usuario.rol,
  })
}

export async function actualizarEstadoUsuario(id: string, estado: UsuarioApp['estado']) {
  return supabase.from('usuarios_app').update({ estado }).eq('id', id)
}
