export type ReglaNegocio = {
  id: string
  nombre: string
  descripcion?: string
  condicion?: string
  accion?: string
  color?: string
  activo?: boolean
  criterio: string
  efecto: string
  peso: number
  estado: 'activa' | 'inactiva'
  clave?: string
}
