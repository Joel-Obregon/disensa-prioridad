import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useConfirmar } from '../components/ConfirmacionProvider'
import { ShieldCheck, UserPlus, X } from 'lucide-react'
import { useAuth } from '../auth/authState'
import { describirRol } from '../auth/permisos'
import { esCorreoValido, soloTextoNombre } from '../lib/validacionesFormulario'
import {
  actualizarEstadoUsuario,
  crearUsuarioApp,
  eliminarUsuarioApp,
  obtenerUsuariosApp,
  registrarUsuarioConAuth,
} from '../services/usuariosService'
import type { RolUsuario, UsuarioApp } from '../types/usuario'

type UsuarioForm = {
  nombre: string
  correo: string
  password: string
  rol: RolUsuario
  crearAccesoAuth: boolean
}

const formularioInicial: UsuarioForm = {
  nombre: '',
  correo: '',
  password: '',
  rol: 'bodega',
  crearAccesoAuth: true,
}

const roles: RolUsuario[] = ['administrador', 'suministrador', 'bodega']

export default function Usuarios() {
  const confirmar = useConfirmar()
  const { perfil } = useAuth()
  const [usuarios, setUsuarios] = useState<UsuarioApp[]>([])
  const [formulario, setFormulario] = useState<UsuarioForm>(formularioInicial)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  async function cargarUsuarios() {
    setCargando(true)
    setError('')

    const { data, error } = await obtenerUsuariosApp()

    if (error) {
      setError('No se pudo leer usuarios_app. Ejecuta el SQL de seguridad.')
      setUsuarios([])
      setCargando(false)
      return
    }

    setUsuarios(data || [])
    setCargando(false)
  }

  async function registrarUsuario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setGuardando(true)
    setError('')
    setMensaje('')

    if (
      !formulario.nombre.trim() ||
      !formulario.correo.trim()
    ) {
      setError('Completa nombre y correo.')
      setGuardando(false)
      return
    }

    if (!esCorreoValido(formulario.correo)) {
      setError('Ingresa un correo valido.')
      setGuardando(false)
      return
    }

    if (formulario.crearAccesoAuth && formulario.password.length < 6) {
      setError('La contrasena debe tener al menos 6 caracteres.')
      setGuardando(false)
      return
    }

    const usuario = {
      nombre: formulario.nombre.trim(),
      correo: formulario.correo.trim().toLowerCase(),
      rol: formulario.rol,
    }

    const { error } = formulario.crearAccesoAuth
      ? await registrarUsuarioConAuth({
          ...usuario,
          password: formulario.password,
        })
      : await crearUsuarioApp(usuario)

    if (error) {
      setError(formatearErrorUsuario(error.message))
      setGuardando(false)
      return
    }

    setFormulario(formularioInicial)
    setMostrarFormulario(false)
    setMensaje(
      formulario.crearAccesoAuth
        ? 'Usuario creado. Ya puede iniciar sesion con ese correo y contrasena.'
        : 'Rol interno actualizado. El correo debe existir en Supabase Auth para poder iniciar sesion.'
    )
    setGuardando(false)
    cargarUsuarios()
  }

  async function cambiarEstado(usuario: UsuarioApp) {
    const estado = usuario.estado === 'activo' ? 'inactivo' : 'activo'

    if (estado === 'inactivo') {
      const confirmado = await confirmar({
        titulo: 'Desactivar usuario',
        mensaje: '¿Seguro que quieres desactivar este usuario? Perderá el acceso al sistema.',
        confirmarTexto: 'Sí, desactivar',
      })
      if (!confirmado) return
    }

    const { error } = await actualizarEstadoUsuario(usuario.id, estado)

    if (error) {
      setError(error.message)
      return
    }

    cargarUsuarios()
  }

  async function eliminarUsuario(usuario: UsuarioApp) {
    const confirmado = await confirmar({
      titulo: 'Eliminar usuario',
      mensaje: `¿Eliminar a ${usuario.nombre} definitivamente? Se borrará de Supabase (rol interno y acceso) y no podrá iniciar sesión.`,
      confirmarTexto: 'Sí, eliminar',
    })
    if (!confirmado) return

    setError('')
    setMensaje('')
    const { error } = await eliminarUsuarioApp(usuario.correo)

    if (error) {
      setError(error.message || 'No se pudo eliminar el usuario.')
      return
    }

    setMensaje('Usuario eliminado de Supabase (rol interno y acceso).')
    cargarUsuarios()
  }

  useEffect(() => {
    const timer = window.setTimeout(cargarUsuarios, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [])

  const resumen = useMemo(() => {
    const activos = usuarios.filter((usuario) => usuario.estado === 'activo').length
    const porRol = roles.map((rol) => ({
      titulo: rol,
      valor: usuarios.filter((usuario) => usuario.rol === rol).length,
    }))

    return [
      { titulo: 'Usuarios', valor: usuarios.length },
      { titulo: 'Activos', valor: activos },
      ...porRol,
    ]
  }, [usuarios])

  if (perfil?.rol !== 'administrador') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
        Solo el administrador puede registrar y administrar usuarios.
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Seguridad y usuarios</h1>
          <p className="mt-1 text-slate-500">
            Registra usuarios autenticados y asigna interfaz por rol.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMostrarFormulario((actual) => !actual)
            setError('')
            setMensaje('')
          }}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          <UserPlus size={17} />
          {mostrarFormulario ? 'Ocultar formulario' : 'Crear usuario'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {mensaje && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {mensaje}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {resumen.map((item) => (
          <article key={item.titulo} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{formatearEtiqueta(item.titulo)}</p>
            <strong className="mt-2 block text-3xl text-slate-900">
              {cargando ? '-' : item.valor}
            </strong>
          </article>
        ))}
      </div>

      {mostrarFormulario && (
      <form
        onSubmit={registrarUsuario}
        className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex items-center gap-2 font-semibold text-slate-800">
          <UserPlus size={18} className="text-red-600" />
          Nuevo usuario autenticado
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-6">
          <Campo
            label="Nombre"
            value={formulario.nombre}
            placeholder="Ej. Bodega Norte"
            onChange={(nombre) =>
              setFormulario({ ...formulario, nombre: soloTextoNombre(nombre, 80) })
            }
          />
          <Campo
            label="Correo"
            type="email"
            value={formulario.correo}
            placeholder="usuario@disensa.local"
            onChange={(correo) =>
              setFormulario({ ...formulario, correo: correo.replace(/\s/g, '').slice(0, 120) })
            }
          />
          <Campo
            label="Contrasena"
            type="password"
            value={formulario.password}
            placeholder="Minimo 6 caracteres"
            onChange={(password) => setFormulario({ ...formulario, password })}
            disabled={!formulario.crearAccesoAuth}
          />
          <label className="text-sm font-medium text-slate-700">
            Rol
            <select
              value={formulario.rol}
              onChange={(event) => setFormulario({ ...formulario, rol: event.target.value as RolUsuario })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 outline-none focus:ring-2 focus:ring-red-500"
            >
              {roles.map((rol) => (
                <option key={rol} value={rol}>
                  {formatearEtiqueta(rol)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={formulario.crearAccesoAuth}
              onChange={(event) =>
                setFormulario({ ...formulario, crearAccesoAuth: event.target.checked })
              }
              className="h-4 w-4 accent-red-600"
            />
            Crear acceso Auth
          </label>
          <div className="flex items-end">
            <div className="flex w-full gap-2">
              <button
                type="submit"
                disabled={guardando}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2 font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                <UserPlus size={16} />
                {guardando ? 'Creando...' : 'Crear'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMostrarFormulario(false)
                  setFormulario(formularioInicial)
                  setError('')
                }}
                className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-3 py-2 text-slate-700 transition hover:bg-slate-50"
                aria-label="Cancelar creacion de usuario"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      </form>
      )}

      <section className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-200 p-4 font-semibold text-slate-800">
          <ShieldCheck size={18} className="text-red-600" />
          Usuarios y permisos
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-5 py-3 text-left">Usuario</th>
                <th className="px-5 py-3 text-left">Rol</th>
                <th className="px-5 py-3 text-left">Interfaz permitida</th>
                <th className="px-5 py-3 text-left">Estado</th>
                <th className="px-5 py-3 text-left">Accion</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((usuario) => (
                <tr key={usuario.id} className="border-t border-slate-100">
                  <td className="px-5 py-4">
                    <p className="font-semibold text-slate-800">{usuario.nombre}</p>
                    <p className="text-xs text-slate-500">{usuario.correo}</p>
                  </td>
                  <td className="px-5 py-4 text-slate-600">{formatearEtiqueta(usuario.rol)}</td>
                  <td className="px-5 py-4 text-slate-600">{describirRol(usuario.rol)}</td>
                  <td className="px-5 py-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${usuario.estado === 'activo' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                      {usuario.estado}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => cambiarEstado(usuario)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        {usuario.estado === 'activo' ? 'Desactivar' : 'Activar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => eliminarUsuario(usuario)}
                        className="rounded-lg border-2 border-[#c8102e] px-3 py-2 text-xs font-semibold text-[#c8102e] transition hover:bg-[#fff0f0]"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Campo({
  disabled,
  label,
  onChange,
  placeholder,
  type = 'text',
  value,
}: {
  disabled?: boolean
  label: string
  onChange: (value: string) => void
  placeholder: string
  type?: string
  value: string
}) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 outline-none focus:ring-2 focus:ring-red-500 disabled:bg-slate-100 disabled:text-slate-400"
      />
    </label>
  )
}

function formatearErrorUsuario(mensaje: string) {
  const normalizado = mensaje.toLowerCase()

  if (normalizado.includes('email rate limit exceeded')) {
    return 'Supabase alcanzo el limite temporal de correos. Espera unos minutos o desmarca "Crear acceso Auth" si el usuario ya existe en Authentication.'
  }

  if (normalizado.includes('user already registered') || normalizado.includes('already registered')) {
    return 'Ese correo ya existe en Supabase Auth. Desmarca "Crear acceso Auth" para actualizar solo el rol interno.'
  }

  return mensaje
}

function formatearEtiqueta(valor: string) {
  return valor.replace(/_/g, ' ')
}
