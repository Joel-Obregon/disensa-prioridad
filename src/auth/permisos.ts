import type { RolUsuario } from '../types/usuario'

export type RutaProtegida =
  | '/dashboard'
  | '/inventario'
  | '/pedidos'
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
    '/inventario',
    '/reglas',
    '/alertas',
    '/reportes',
    '/calendario',
    '/estado-sistema',
    '/usuarios',
  ],
  suministrador: [
    '/dashboard',
    '/pedidos',
    '/reglas',
    '/alertas',
    '/reportes',
    '/estado-sistema',
  ],
  bodega: [
    '/dashboard',
    '/pedidos',
    '/inventario',
    '/alertas',
    '/calendario',
    '/estado-sistema',
  ],
}

export function esRolInterno(rol: string | undefined): rol is RolUsuario {
  return rol === 'administrador' || rol === 'suministrador' || rol === 'bodega'
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
  if (rol === 'suministrador') return 'Pedidos de abastecimiento, materiales y alertas'
  return 'Inventario, despacho, pedidos y reportes operativos'
}
