import { type FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ArrowRight, Lock, Mail, Search } from 'lucide-react'
import { esRolInterno, rutaInicialPorRol } from '../auth/permisos'
import disensaLogo from '../assets/disensa-logo.svg'
import ThemeToggle from '../components/ThemeToggle'
import { esCorreoValido } from '../lib/validacionesFormulario'
import { obtenerUsuarioPorCorreo } from '../services/usuariosService'
import { supabase } from '../services/supabaseClient'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  async function iniciarSesion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCargando(true)
    setError('')

    const correoNormalizado = email.trim().toLowerCase()

    if (!esCorreoValido(correoNormalizado)) {
      setError('Ingresa un correo valido.')
      setCargando(false)
      return
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: correoNormalizado,
      password,
    })

    if (error) {
      setError('No se pudo iniciar sesion. Revisa el correo y la contrasena.')
      setCargando(false)
      return
    }

    const { data: perfil, error: perfilError } = await obtenerUsuarioPorCorreo(correoNormalizado)

    if (perfilError || !perfil || !esRolInterno(perfil.rol)) {
      await supabase.auth.signOut()
      setError('El usuario no tiene un rol interno activo. Usa consulta de invitado si eres franquiciado.')
      setCargando(false)
      return
    }

    navigate(rutaInicialPorRol(perfil.rol))
  }

  return (
    <div className="login-page relative min-h-screen bg-[#fff8f6] text-[#261812] lg:grid lg:grid-cols-2">
      <div className="absolute right-5 top-5 z-40">
        <ThemeToggle />
      </div>
      <section
        className="relative hidden min-h-screen overflow-hidden bg-[#ed1c24] lg:flex"
      >
        <div className="absolute -left-52 -top-32 h-[560px] w-[560px] rounded-full bg-[#94121c]/70" />
        <div className="absolute -right-52 bottom-[-220px] h-[560px] w-[560px] rounded-full bg-[#9f1720]/65" />
        <div className="absolute left-16 top-0 h-[720px] w-[360px] rotate-[18deg] rounded-full bg-[#ff3044]/65 blur-[1px]" />
        <div className="absolute left-20 top-12 h-[430px] w-[430px] opacity-35 [background-image:radial-gradient(#bd1624_4px,transparent_5px)] [background-size:28px_28px]" />
        <div className="absolute bottom-0 right-20 h-[430px] w-[430px] opacity-35 [background-image:radial-gradient(#bd1624_4px,transparent_5px)] [background-size:28px_28px]" />
        <div className="absolute inset-0 bg-[#ed1c24]/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#7f0f18]/75 via-[#ed1c24]/30 to-[#ed1c24]/20" />
        <div
          aria-label="Disensa, un miembro de Holcim"
          className="absolute left-1/2 top-[34%] z-20 w-[66%] max-w-[640px] -translate-x-1/2 -translate-y-1/2"
        >
          <img
            src="/disensa-holcim-logo.png"
            alt="Disensa, un miembro de Holcim"
            className="h-auto w-full object-contain drop-shadow-[0_8px_28px_rgba(0,0,0,0.08)]"
          />
        </div>
        <div className="relative z-20 mt-auto max-w-xl p-12 text-white">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/80">
            Plataforma operativa
          </p>
          <h2 className="mt-4 text-4xl font-bold tracking-tight">
            Eficiencia a escala para pedidos, stock y abastecimiento.
          </h2>
          <p className="mt-5 text-lg leading-8 text-white/90">
            Tus pedidos siempre en orden, tus materiales siempre a tiempo.
          </p>
        </div>
      </section>

      <main className="login-main flex min-h-screen items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">
        <div className="mb-10 text-center lg:text-left">
          <div className="flex items-center justify-center gap-3 lg:justify-start">
            <img src={disensaLogo} alt="Disensa" className="h-12 w-12 object-contain" />
            <h1 className="login-title text-3xl font-black tracking-tight text-[#c8102e]">Disensa Prioridad</h1>
          </div>
          <div className="lg:pl-[60px]">
            <p className="login-muted mt-2 text-sm text-[#5a4136]">
              Portal de operaciones.
            </p>
          </div>
        </div>

        <form
          onSubmit={iniciarSesion}
          className="login-card border border-[#e5e1df] bg-white p-8"
        >
          {location.state?.error === 'sin_perfil' && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Tu cuenta no tiene rol activo. Pide al administrador que te registre en Seguridad.
            </p>
          )}

          <div>
            <label className="login-label block text-xs font-semibold uppercase tracking-[0.12em] text-[#5a4136]">
              Correo electronico
            </label>
            <div className="login-field mt-2 flex items-center border border-[#d7d3d0] px-3 focus-within:border-[#c8102e] focus-within:ring-1 focus-within:ring-[#c8102e]">
              <Mail size={18} className="text-[#8e7164]" />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value.replace(/\s/g, '').slice(0, 120))}
                className="login-clean-input w-full border-0 bg-transparent px-3 py-2.5 outline-none"
                placeholder="usuario@disensa.com"
                required
              />
            </div>
          </div>

          <div>
            <label className="login-label block text-xs font-semibold uppercase tracking-[0.12em] text-[#5a4136]">
              Contrasena
            </label>
            <div className="login-field mt-2 flex items-center border border-[#d7d3d0] px-3 focus-within:border-[#c8102e] focus-within:ring-1 focus-within:ring-[#c8102e]">
              <Lock size={18} className="text-[#8e7164]" />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="login-clean-input w-full border-0 bg-transparent px-3 py-2.5 outline-none"
                placeholder="********"
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
            disabled={cargando}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 bg-[#ed1c24] py-3 font-semibold text-white transition hover:bg-[#c8102e] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cargando ? 'Ingresando...' : 'Iniciar sesion'}
            <ArrowRight size={18} />
          </button>

          <div className="mt-7 border-t border-[#e5e1df] pt-6">
          <Link
            to="/consulta-pedido"
            className="inline-flex w-full items-center justify-center gap-2 border border-[#d7d3d0] px-4 py-2.5 text-sm font-semibold text-[#565e74] transition hover:bg-[#f7f4f2]"
          >
            <Search size={17} />
            Consultar como invitado
          </Link>
          </div>
        </form>

        <p className="login-muted mt-8 text-sm text-[#8e7164]">Uso restringido para operaciones Disensa.</p>
        </div>
      </main>
    </div>
  )
}
