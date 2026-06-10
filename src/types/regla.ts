export type ReglaNegocio = {
  id: string
  nombre: string
  criterio: string
  efecto: string
  peso: number
  estado: 'activa' | 'inactiva'
}
