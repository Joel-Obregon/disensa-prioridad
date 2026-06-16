export type RolUsuario = 'administrador' | 'suministrador' | 'bodega'

export type UsuarioApp = {
  id: string
  nombre: string
  correo: string
  rol: RolUsuario
  estado: 'activo' | 'inactivo'
  created_at: string
}
