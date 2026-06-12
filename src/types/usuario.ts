export type RolUsuario = 'administrador' | 'suministrador' | 'bodega' | 'observador'

export type UsuarioApp = {
  id: string
  nombre: string
  correo: string
  rol: RolUsuario
  estado: 'activo' | 'inactivo'
  created_at: string
}
