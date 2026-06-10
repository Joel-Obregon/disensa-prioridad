import { createContext, useContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { UsuarioApp } from '../types/usuario'

export type AuthContextValue = {
  cargando: boolean
  perfil: UsuarioApp | null
  session: Session | null
  user: User | null
  cerrarSesion: () => Promise<void>
  recargarPerfil: () => Promise<UsuarioApp | null>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth debe usarse dentro de AuthProvider')
  }

  return context
}
