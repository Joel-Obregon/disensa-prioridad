type ModalAlertaProps = {
  mensaje: string
  titulo?: string
  onClose: () => void
}

export default function ModalAlerta({
  mensaje,
  titulo = 'Operación no permitida',
  onClose,
}: ModalAlertaProps) {
  if (!mensaje) return null

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4"
      role="alertdialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm border-2 border-[#c8102e] bg-white shadow-2xl">
        <div className="flex flex-col items-center p-6 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#fdecea]">
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#c8102e"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <h2 className="text-lg font-bold text-[#c8102e]">{titulo}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">{mensaje}</p>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="mt-5 w-full bg-[#c8102e] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#a50d26]"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  )
}
