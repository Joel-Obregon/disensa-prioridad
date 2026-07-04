import {
  type ReactNode,
  useEffect,
  useState,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from './authState'
import { esRolInterno } from './permisos'
import { obtenerUsuarioPorCorreo } from '../services/usuariosService'
import { latidoSesion, liberarSesion } from '../services/sesionService'
import { supabase } from '../services/supabaseClient'
import type { UsuarioApp } from '../types/usuario'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<UsuarioApp | null>(null)
  const [cargando, setCargando] = useState(true)

  async function cargarPerfil(sessionActual: Session | null) {
    if (!sessionActual?.user.email) {
      setPerfil(null)
      return null
    }

    const { data, error } = await obtenerUsuarioPorCorreo(sessionActual.user.email)

    if (error || !data || !esRolInterno(data.rol)) {
      setPerfil(null)
      return null
    }

    setPerfil(data)
    return data
  }

  async function recargarPerfil() {
    return cargarPerfil(session)
  }

  async function cerrarSesion() {
    const userId = session?.user?.id
    if (userId) await liberarSesion(userId)
    setPerfil(null)
    await supabase.auth.signOut()
  }

  useEffect(() => {
    let activo = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!activo) return
      setSession(data.session)
      await cargarPerfil(data.session)
      setCargando(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nuevaSession) => {
      setSession(nuevaSession)
      cargarPerfil(nuevaSession).finally(() => setCargando(false))
    })

    return () => {
      activo = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) return

    const correo = session?.user?.email || null
    latidoSesion(userId, correo)
    const intervalo = window.setInterval(() => latidoSesion(userId, correo), 30_000)

    return () => window.clearInterval(intervalo)
  }, [session?.user?.id, session?.user?.email])

  const value = {
    cargando,
    cerrarSesion,
    perfil,
    recargarPerfil,
    session,
    user: session?.user || null,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
