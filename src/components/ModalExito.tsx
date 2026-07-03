export default function ModalExito({
  mensaje,
  onClose,
}: {
  mensaje: string
  onClose: () => void
}) {
  if (!mensaje) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <svg
            viewBox="0 0 24 24"
            width="26"
            height="26"
            fill="none"
            stroke="#15803d"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <p className="text-base font-semibold text-slate-900">{mensaje}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-[#c8102e] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#9f0d25]"
          autoFocus
        >
          OK
        </button>
      </div>
    </div>
  )
}
