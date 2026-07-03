import type { RolUsuario } from '../types/usuario'

export type RutaProtegida =
  | '/dashboard'
  | '/inventario'
  | '/pedidos'
  | '/reposicion'
  | '/calendario'
  | '/reglas'
  | '/alertas'
  | '/reportes'
  | '/estado-sistema'
  | '/usuarios'

export const permisosPorRol: Record<RolUsuario, RutaProtegida[]> = {
  administrador: [
    '/dashboard',
    '/pedidos',
    '/reposicion',
    '/inventario',
    '/reglas',
    '/alertas',
    '/reportes',
    '/calendario',
    '/estado-sistema',
    '/usuarios',
  ],
  suministrador: [
    '/reposicion',
  ],
  bodega: [
    '/dashboard',
    '/pedidos',
    '/inventario',
    '/alertas',
    '/reportes',
    '/calendario',
  ],
}

export function esRolInterno(rol: string | undefined): rol is RolUsuario {
  return (
    rol === 'administrador' ||
    rol === 'suministrador' ||
    rol === 'bodega'
  )
}

export function puedeAcceder(rol: string | undefined, ruta: string) {
  if (!esRolInterno(rol)) return false
  return permisosPorRol[rol].some((permitida) => ruta === permitida)
}

export function rutaInicialPorRol(rol: string | undefined) {
  if (!esRolInterno(rol)) return '/login'
  return permisosPorRol[rol][0]
}

export function describirRol(rol: RolUsuario) {
  if (rol === 'administrador') return 'Acceso completo al sistema y usuarios'
  if (rol === 'suministrador') return 'Reposición de materiales hacia bodega'
  return 'Inventario, despacho, pedidos y reportes operativos'
}
