import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Edit3,
  PackagePlus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { registrarAuditoria } from '../services/auditoriaService'
import type { Material } from '../types/material'
import {
  actualizarMaterial,
  crearMaterial,
  eliminarMaterial,
  escucharMateriales,
  obtenerMateriales,
} from '../services/materialesService'

type MaterialForm = {
  nombre: string
  categoria: string
  stock_actual: string
  stock_minimo: string
  unidad_medida: string
}

const estadoInicial: MaterialForm = {
  nombre: '',
  categoria: '',
  stock_actual: '',
  stock_minimo: '',
  unidad_medida: '',
}

const MATERIALES_POR_PAGINA = 100

export default function Materiales() {
  const [materiales, setMateriales] = useState<Material[]>([])
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [eliminando, setEliminando] = useState('')
  const [editandoId, setEditandoId] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState<{ texto: string; tono: 'exito' | 'advertencia' } | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [formulario, setFormulario] = useState<MaterialForm>(estadoInicial)
  const [edicion, setEdicion] = useState<MaterialForm>(estadoInicial)
  const recargaTimerRef = useRef<number | null>(null)

  async function cargarMateriales(materialPreservado?: Material) {
    setCargando(true)
    setError('')

    const { data, error } = await obtenerMateriales()

    if (error) {
      setError(mensajeErrorMateriales(error))
      setCargando(false)
      return
    }

    const lista = data || []

    if (materialPreservado && !lista.some((material) => material.id === materialPreservado.id)) {
      setMateriales([materialPreservado, ...lista])
    } else {
      setMateriales(lista)
    }

    setCargando(false)
  }

  async function registrarMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setGuardando(true)
    setError('')
    setAviso(null)

    const payload = prepararPayload(formulario)

    if (!payload) {
      setError('Completa todos los campos y usa valores de stock validos.')
      setGuardando(false)
      return
    }

    const resultado = await crearMaterial(payload)
    const { data, error } = resultado

    if (error) {
      setError(error.message)
      setGuardando(false)
      return
    }

    await registrarAuditoria({
      entidad: 'materiales',
      accion: 'crear_material',
      detalle: `Se registro el material ${payload.nombre}.`,
    })

    setFormulario(estadoInicial)
    setMostrarFormulario(false)
    setGuardando(false)

    if (data) {
      setMateriales((actuales) => [data, ...actuales.filter((item) => item.id !== data.id)])
    }

    setAviso(mensajeSincronizacion(resultado, 'Material registrado y coordinado con inventario, pedidos y alertas.'))
  }

  function iniciarEdicion(material: Material) {
    setError('')
    setAviso(null)
    setEditandoId(material.id)
    setEdicion({
      nombre: material.nombre,
      categoria: material.categoria,
      stock_actual: String(material.stock_actual),
      stock_minimo: String(material.stock_minimo),
      unidad_medida: material.unidad_medida,
    })
  }

  async function guardarEdicion(material: Material) {
    setGuardando(true)
    setError('')
    setAviso(null)

    const payload = prepararPayload(edicion)

    if (!payload) {
      setError('Revisa los campos del material antes de guardar.')
      setGuardando(false)
      return
    }

    const resultado = await actualizarMaterial(material.id, payload)
    const { data, error } = resultado

    if (error) {
      setError(error.message)
      setGuardando(false)
      return
    }

    await registrarAuditoria({
      entidad: 'materiales',
      entidad_id: material.id,
      accion: 'editar_material',
      detalle: `${material.nombre} actualizado. Stock ${material.stock_actual} -> ${payload.stock_actual}.`,
    })

    setEditandoId('')
    setEdicion(estadoInicial)
    setGuardando(false)

    if (data) {
      setMateriales((actuales) =>
        actuales.map((item) => (item.id === data.id ? data : item))
      )
    }

    setAviso(mensajeSincronizacion(resultado, 'Material actualizado y coordinado con inventario, pedidos y alertas.'))
  }

  async function eliminarMaterialSeleccionado(material: Material) {
    const confirmado = window.confirm(
      `Eliminar ${material.nombre}? Se quitara del inventario y tambien de Supabase.`
    )

    if (!confirmado) return

    setEliminando(material.id)
    setError('')
    setAviso(null)

    const { error } = await eliminarMaterial(material.id)

    if (error) {
      setError(error.message)
      setEliminando('')
      return
    }

    await registrarAuditoria({
      entidad: 'materiales',
      entidad_id: material.id,
      accion: 'eliminar_material',
      detalle: `Se elimino el material ${material.nombre}.`,
    })

    setEliminando('')
    setMateriales((actuales) => actuales.filter((item) => item.id !== material.id))
    setAviso({ texto: 'Material eliminado y referencias cerradas correctamente.', tono: 'exito' })
  }

  useEffect(() => {
    const timer = window.setTimeout(() => cargarMateriales(), 0)
    const dejarDeEscuchar = escucharMateriales(() => {
      if (recargaTimerRef.current) {
        window.clearTimeout(recargaTimerRef.current)
      }

      recargaTimerRef.current = window.setTimeout(() => cargarMateriales(), 800)
    })

    return () => {
      window.clearTimeout(timer)
      if (recargaTimerRef.current) {
        window.clearTimeout(recargaTimerRef.current)
      }
      dejarDeEscuchar()
    }
  }, [])

  const materialesFiltrados = useMemo(() => {
    const texto = busqueda.toLowerCase().trim()

    if (!texto) return materiales

    return materiales.filter((material) =>
      [material.nombre, material.categoria, material.unidad_medida]
        .join(' ')
        .toLowerCase()
        .includes(texto)
    )
  }, [busqueda, materiales])

  const resumen = useMemo(() => {
    const bajoStock = materiales.filter(
      (material) => material.stock_actual < material.stock_minimo
    ).length
    return [
      { titulo: 'Registrados', valor: materiales.length },
      { titulo: 'Bajo stock', valor: bajoStock },
    ]
  }, [materiales])

  const totalPaginas = Math.max(1, Math.ceil(materialesFiltrados.length / MATERIALES_POR_PAGINA))
  const paginaActual = Math.min(pagina, totalPaginas)
  const materialesVisibles = useMemo(() => {
    const inicio = (paginaActual - 1) * MATERIALES_POR_PAGINA
    return materialesFiltrados.slice(inicio, inicio + MATERIALES_POR_PAGINA)
  }, [materialesFiltrados, paginaActual])

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Materiales</h1>
          <p className="mt-1 text-slate-500">
            Crea, edita y elimina materiales. Si registras el mismo nombre y unidad,
            se fusiona en un solo material y se suma el stock.
          </p>
        </div>

        <button
          onClick={() => setMostrarFormulario(!mostrarFormulario)}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white transition hover:bg-orange-700"
        >
          <PackagePlus size={18} />
          {mostrarFormulario ? 'Cancelar' : 'Nuevo material'}
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {resumen.map((item) => (
          <div key={item.titulo} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{item.titulo}</p>
            <strong className="mt-2 block text-3xl text-slate-900">{item.valor}</strong>
          </div>
        ))}
      </div>

      {mostrarFormulario && (
        <form
          onSubmit={registrarMaterial}
          className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-slate-800">
            Registrar nuevo material
          </h2>

          <MaterialFormFields form={formulario} onChange={setFormulario} />

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={guardando}
              className="rounded-lg bg-slate-900 px-5 py-2 font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {guardando ? 'Guardando...' : 'Guardar material'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {aviso && (
        <p
          className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
            aviso.tono === 'exito'
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          {aviso.texto}
        </p>
      )}

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-slate-800">Inventario activo</h2>
            <p className="mt-1 text-xs text-slate-500">
              {materialesFiltrados.length} materiales encontrados, mostrando {materialesVisibles.length} por pagina.
            </p>
          </div>
          <div className="field-shell flex items-center rounded-lg border border-slate-300 px-3">
            <Search size={18} className="text-slate-400" />
            <input
              value={busqueda}
              onChange={(event) => {
                setBusqueda(event.target.value)
                setPagina(1)
              }}
              className="w-full border-0 px-3 py-2 outline-none sm:w-72"
              placeholder="Buscar material"
            />
          </div>
        </div>

        {cargando && <p className="p-6 text-slate-500">Cargando materiales...</p>}

        {!cargando && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-5 py-3 text-left">Material</th>
                  <th className="px-5 py-3 text-left">Categoria</th>
                  <th className="px-5 py-3 text-left">Stock actual</th>
                  <th className="px-5 py-3 text-left">Stock minimo</th>
                  <th className="px-5 py-3 text-left">Unidad</th>
                  <th className="px-5 py-3 text-left">Estado</th>
                  <th className="px-5 py-3 text-left">Acciones</th>
                </tr>
              </thead>

              <tbody>
                {materialesVisibles.map((material) => {
                  const bajoStock = material.stock_actual < material.stock_minimo
                  const editando = editandoId === material.id

                  return (
                    <tr key={material.id} className="border-t border-slate-100 align-top">
                      {editando ? (
                        <>
                          <td colSpan={6} className="px-5 py-4">
                            <MaterialFormFields form={edicion} onChange={setEdicion} compacto />
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap gap-2">
                              <BotonAccion
                                label="Guardar"
                                icono={<Save size={15} />}
                                onClick={() => guardarEdicion(material)}
                                disabled={guardando}
                              />
                              <BotonAccion
                                label="Cancelar"
                                icono={<X size={15} />}
                                onClick={() => setEditandoId('')}
                              />
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-5 py-4 font-medium text-slate-800">
                            {material.nombre}
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            {material.categoria}
                          </td>
                          <td className="px-5 py-4">
                            <Estado
                              texto={String(material.stock_actual)}
                              tono={bajoStock ? 'red' : 'green'}
                            />
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            {material.stock_minimo}
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            {material.unidad_medida}
                          </td>
                          <td className="px-5 py-4">
                            <Estado
                              texto={bajoStock ? 'Bajo stock' : 'Disponible'}
                              tono={bajoStock ? 'red' : 'green'}
                            />
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap gap-2">
                              <BotonAccion
                                label="Editar"
                                icono={<Edit3 size={15} />}
                                onClick={() => iniciarEdicion(material)}
                              />
                              <BotonAccion
                                label={eliminando === material.id ? 'Eliminando...' : 'Eliminar'}
                                icono={<Trash2 size={15} />}
                                peligro
                                disabled={eliminando === material.id}
                                onClick={() => eliminarMaterialSeleccionado(material)}
                              />
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}

                {materialesFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-slate-500">
                      <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                        <AlertTriangle size={22} className="text-slate-400" />
                        No hay materiales que coincidan con la busqueda.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!cargando && materialesFiltrados.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Pagina {paginaActual} de {totalPaginas}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={paginaActual === 1}
                onClick={() => setPagina((actual) => Math.max(1, actual - 1))}
                className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={paginaActual === totalPaginas}
                onClick={() => setPagina((actual) => Math.min(totalPaginas, actual + 1))}
                className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MaterialFormFields({
  compacto,
  form,
  onChange,
}: {
  compacto?: boolean
  form: MaterialForm
  onChange: (form: MaterialForm) => void
}) {
  return (
    <div className={`grid grid-cols-1 gap-4 ${compacto ? 'lg:grid-cols-5' : 'mt-5 md:grid-cols-3'}`}>
      <CampoTexto
        label="Nombre"
        value={form.nombre}
        placeholder="Ej. Cemento Holcim 50kg"
        onChange={(nombre) => onChange({ ...form, nombre })}
      />
      <CampoTexto
        label="Categoria"
        value={form.categoria}
        placeholder="Ej. Cemento"
        onChange={(categoria) => onChange({ ...form, categoria })}
      />
      <CampoTexto
        label="Unidad"
        value={form.unidad_medida}
        placeholder="Ej. saco"
        onChange={(unidad_medida) => onChange({ ...form, unidad_medida })}
      />
      <CampoTexto
        label="Stock actual"
        type="number"
        value={form.stock_actual}
        placeholder="Ej. 35"
        onChange={(stock_actual) => onChange({ ...form, stock_actual })}
      />
      <CampoTexto
        label="Stock minimo"
        type="number"
        value={form.stock_minimo}
        placeholder="Ej. 50"
        onChange={(stock_minimo) => onChange({ ...form, stock_minimo })}
      />
    </div>
  )
}

function CampoTexto({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  type?: string
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        type={type}
        min={type === 'number' ? 0 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 outline-none focus:ring-2 focus:ring-orange-500"
        placeholder={placeholder}
      />
    </label>
  )
}

function BotonAccion({
  disabled,
  icono,
  label,
  peligro,
  onClick,
}: {
  disabled?: boolean
  icono: ReactNode
  label: string
  peligro?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
        peligro
          ? 'border-red-200 text-red-700 hover:bg-red-50'
          : 'border-slate-300 text-slate-700 hover:bg-slate-50'
      }`}
    >
      {icono}
      {label}
    </button>
  )
}

function Estado({ texto, tono }: { texto: string; tono: 'green' | 'red' | 'slate' }) {
  const clases = {
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-600 text-white ring-1 ring-red-700',
    slate: 'bg-slate-100 text-slate-600',
  }

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${clases[tono]}`}>
      {texto}
    </span>
  )
}

function mensajeSincronizacion(
  resultado: unknown,
  textoExito: string
) {
  const syncError = obtenerSyncError(resultado)

  if (syncError) {
    return {
      texto: `Material guardado. Revisa la sincronizacion secundaria: ${syncError.message || 'no se pudieron actualizar todos los modulos.'}`,
      tono: 'advertencia' as const,
    }
  }

  return { texto: textoExito, tono: 'exito' as const }
}

function obtenerSyncError(resultado: unknown): { message?: string } | null {
  if (!resultado || typeof resultado !== 'object' || !('syncError' in resultado)) {
    return null
  }

  const syncError = (resultado as { syncError?: { message?: string } }).syncError
  return syncError || null
}

function prepararPayload(form: MaterialForm) {
  const stockActual = Number(form.stock_actual)
  const stockMinimo = Number(form.stock_minimo)

  if (
    !form.nombre.trim() ||
    !form.categoria.trim() ||
    !form.unidad_medida.trim() ||
    Number.isNaN(stockActual) ||
    Number.isNaN(stockMinimo) ||
    stockActual < 0 ||
    stockMinimo < 0
  ) {
    return null
  }

  return {
    nombre: form.nombre.trim(),
    categoria: form.categoria.trim(),
    stock_actual: stockActual,
    stock_minimo: stockMinimo,
    unidad_medida: form.unidad_medida.trim(),
    es_critico: false,
  }
}

function mensajeErrorMateriales(error: { code?: string; message: string }) {
  if (error.code === '42P01') {
    return 'No existe la tabla materiales en Supabase. Ejecuta primero supabase/schema_2_0_base_nueva.sql.'
  }

  if (error.code === '42703') {
    return 'La tabla materiales no tiene todas las columnas requeridas. Ejecuta supabase/schema_2_0_base_nueva.sql.'
  }

  return error.message
}
