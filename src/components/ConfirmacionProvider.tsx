import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import ModalConfirmacion from './ModalConfirmacion'

type OpcionesConfirmacion = {
  titulo?: string
  mensaje: string
  confirmarTexto?: string
  cancelarTexto?: string
  peligro?: boolean
}

type EstadoModal = OpcionesConfirmacion & { abierto: boolean }

const ConfirmacionContext = createContext<(opciones: OpcionesConfirmacion) => Promise<boolean>>(
  () => Promise.resolve(false),
)

export function ConfirmacionProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoModal>({ abierto: false, mensaje: '' })
  const resolverRef = useRef<(valor: boolean) => void>(() => {})

  const confirmar = useCallback((opciones: OpcionesConfirmacion) => {
    setEstado({ ...opciones, abierto: true })
    return new Promise<boolean>((resolver) => {
      resolverRef.current = resolver
    })
  }, [])

  const cerrar = (valor: boolean) => {
    setEstado((actual) => ({ ...actual, abierto: false }))
    resolverRef.current(valor)
  }

  return (
    <ConfirmacionContext.Provider value={confirmar}>
      {children}
      <ModalConfirmacion
        abierto={estado.abierto}
        titulo={estado.titulo}
        mensaje={estado.mensaje}
        confirmarTexto={estado.confirmarTexto}
        cancelarTexto={estado.cancelarTexto}
        peligro={estado.peligro}
        onConfirmar={() => cerrar(true)}
        onCancelar={() => cerrar(false)}
      />
    </ConfirmacionContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirmar() {
  return useContext(ConfirmacionContext)
}
