type ModalConfirmacionProps = {
  abierto: boolean
  titulo?: string
  mensaje: string
  confirmarTexto?: string
  cancelarTexto?: string
  peligro?: boolean
  onConfirmar: () => void
  onCancelar: () => void
}

export default function ModalConfirmacion({
  abierto,
  titulo = '¿Estás seguro?',
  mensaje,
  confirmarTexto = 'Eliminar',
  cancelarTexto = 'Cancelar',
  peligro = true,
  onConfirmar,
  onCancelar,
}: ModalConfirmacionProps) {
  if (!abierto) return null

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm border border-slate-200 bg-white shadow-2xl">
        <div className="p-6">
          <h2 className="text-lg font-bold text-slate-900">{titulo}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{mensaje}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 p-4">
          <button
            type="button"
            onClick={onCancelar}
            className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            {cancelarTexto}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirmar}
            className={`px-4 py-2 text-sm font-semibold text-white ${
              peligro ? 'bg-[#c8102e] hover:bg-[#a50d26]' : 'bg-[#0f0f11] hover:bg-black'
            }`}
          >
            {confirmarTexto}
          </button>
        </div>
      </div>
    </div>
  )
}
