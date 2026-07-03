import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowRight, Eye, EyeOff, Lock } from 'lucide-react'
import { supabase } from '../services/supabaseClient'

const disensaLogo = '/disensa-holcim-logo-source.png'

export default function RestablecerContrasena() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [mostrar, setMostrar] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [listo, setListo] = useState(false)
  // null = verificando, true = hay sesion de recuperacion, false = enlace invalido
  const [sesionValida, setSesionValida] = useState<boolean | null>(null)

  useEffect(() => {
    // El enlace del correo abre una sesion temporal de recuperacion.
    const { data: sub } = supabase.auth.onAuthStateChange((evento, sesion) => {
      if (evento === 'PASSWORD_RECOVERY' || sesion) setSesionValida(true)
    })

    supabase.auth.getSession().then(({ data }) => {
      setSesionValida((actual) => (actual === null ? Boolean(data.session) : actual))
    })

    // Margen por si el token aun se esta procesando desde la URL.
    const timer = window.setTimeout(() => {
      setSesionValida((actual) => (actual === null ? false : actual))
    }, 2500)

    return () => {
      sub.subscription.unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('La contrasena debe tener al menos 8 caracteres.')
      return
    }
    if (password !== confirmar) {
      setError('Las contrasenas no coinciden.')
      return
    }

    setCargando(true)
    const { error: errorUpdate } = await supabase.auth.updateUser({ password })
    setCargando(false)

    if (errorUpdate) {
      setError('No se pudo cambiar la contrasena. El enlace pudo expirar; solicita uno nuevo desde el inicio de sesion.')
      return
    }

    await supabase.auth.signOut()
    setListo(true)
    window.setTimeout(() => navigate('/login'), 2500)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fff8f6] px-4 py-8 text-[#261812]">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-3">
          <img src={disensaLogo} alt="Disensa" className="h-11 w-auto rounded object-contain" />
          <h1 className="text-2xl font-black tracking-tight text-[#c8102e]">Disensa Prioridad</h1>
        </div>

        <div className="border border-[#e5e1df] bg-white p-8">
          <h2 className="text-xl font-bold text-[#261812]">Nueva contrasena</h2>
          <p className="mt-1 text-sm text-[#5a4136]">Crea una contrasena para tu cuenta.</p>

          {listo ? (
            <div className="mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              Contrasena actualizada. Te llevamos al inicio de sesion...
            </div>
          ) : sesionValida === false ? (
            <div className="mt-6 space-y-4">
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Este enlace no es valido o ya expiro. Solicita uno nuevo desde el inicio de sesion.
              </p>
              <Link
                to="/login"
                className="inline-flex w-full items-center justify-center gap-2 bg-[#ed1c24] py-3 font-semibold text-white transition hover:bg-[#c8102e]"
              >
                Volver a iniciar sesion
              </Link>
            </div>
          ) : (
            <form onSubmit={guardar} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-[#5a4136]">
                  Nueva contrasena
                </label>
                <div className="mt-2 flex items-center border border-[#d7d3d0] px-3 focus-within:border-[#c8102e] focus-within:ring-1 focus-within:ring-[#c8102e]">
                  <Lock size={18} className="text-[#8e7164]" />
                  <input
                    type={mostrar ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full border-0 bg-transparent px-3 py-2.5 outline-none"
                    placeholder="Minimo 8 caracteres"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setMostrar((valor) => !valor)}
                    className="ml-1 shrink-0 rounded p-1 text-[#8e7164] transition hover:bg-[#f4ebe7] hover:text-[#c8102e]"
                    aria-label={mostrar ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                    title={mostrar ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                  >
                    {mostrar ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-[#5a4136]">
                  Confirmar contrasena
                </label>
                <div className="mt-2 flex items-center border border-[#d7d3d0] px-3 focus-within:border-[#c8102e] focus-within:ring-1 focus-within:ring-[#c8102e]">
                  <Lock size={18} className="text-[#8e7164]" />
                  <input
                    type={mostrar ? 'text' : 'password'}
                    value={confirmar}
                    onChange={(event) => setConfirmar(event.target.value)}
                    className="w-full border-0 bg-transparent px-3 py-2.5 outline-none"
                    placeholder="Repite la contrasena"
                    required
                  />
                </div>
              </div>

              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={cargando || sesionValida === null}
                className="inline-flex w-full items-center justify-center gap-2 bg-[#ed1c24] py-3 font-semibold text-white transition hover:bg-[#c8102e] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cargando ? 'Guardando...' : sesionValida === null ? 'Verificando enlace...' : 'Guardar contrasena'}
                <ArrowRight size={18} />
              </button>

              <Link to="/login" className="block text-center text-xs font-semibold text-[#8e7164] hover:text-[#c8102e]">
                Volver a iniciar sesion
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
