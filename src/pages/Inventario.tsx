import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  Edit3,
  PackageCheck,
  PackagePlus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { claseSemaforoBadge, claseSemaforoBarra } from '../lib/semaforoOperativo'
import {
  escucharInventarioOperativo,
  obtenerInventarioOperativo,
} from '../services/inventarioService'
import {
  actualizarMaterial,
  crearMaterial,
  eliminarMaterial,
  escucharMateriales,
  type MaterialInput,
} from '../services/materialesService'
import type { InventarioOperativo } from '../types/material'

type MaterialForm = {
  nombre: string
  categoria: string
  stock_actual: string
  unidad_medida: string
}

type EstadoPlanificableFiltro = 'todos' | 'planificable' | 'no planificable' | 'agotar stock'
type EstadoStockFiltro =
  | 'todos'
  | 'stock_negativo'
  | 'sin_stock'
  | 'bajo_minimo'
  | 'cobertura_media'
  | 'disponible'
  | 'reabastecimiento'

const formularioInicial: MaterialForm = {
  nombre: '',
  categoria: '',
  stock_actual: '',
  unidad_medida: 'UND',
}

const MATERIALES_INVENTARIO_POR_PAGINA = 100

export default function Inventario() {
  const [materiales, setMateriales] = useState<InventarioOperativo[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const [catmanFiltro, setCatmanFiltro] = useState('todos')
  const [estadoPlanificableFiltro, setEstadoPlanificableFiltro] =
    useState<EstadoPlanificableFiltro>('todos')
  const [estadoStockFiltro, setEstadoStockFiltro] = useState<EstadoStockFiltro>('todos')
  const [suministradorFiltro, setSuministradorFiltro] = useState('todos')
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [eliminando, setEliminando] = useState('')
  const [editandoId, setEditandoId] = useState('')
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [formulario, setFormulario] = useState<MaterialForm>(formularioInicial)
  const [edicion, setEdicion] = useState<MaterialForm>(formularioInicial)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  async function cargarDatos() {
    setCargando(true)
    setError('')

    const { data, error } = await obtenerInventarioOperativo()

    if (error) {
      setError(mensajeErrorMateriales(error))
      setMateriales([])
      setCargando(false)
      return
    }

    setMateriales(data || [])
    setCargando(false)
  }

  async function registrarMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setGuardando(true)
    setError('')
    setAviso('')

    const payload = prepararPayload(formulario, 0)

    if (!payload) {
      setError('Completa nombre, catman, stock disponible y UMB.')
      setGuardando(false)
      return
    }

    const resultado = await crearMaterial(payload)

    if (resultado.error) {
      setError(resultado.error.message)
      setGuardando(false)
      return
    }

    setFormulario(formularioInicial)
    setMostrarFormulario(false)
    setGuardando(false)
    setAviso('Material agregado y sincronizado con inventario, pedidos y alertas.')
    cargarDatos()
  }

  function iniciarEdicion(material: InventarioOperativo) {
    setError('')
    setAviso('')
    setEditandoId(material.id)
    setEdicion({
      nombre: material.nombre,
      categoria: material.catman_categoria || material.categoria,
      stock_actual: String(material.stock_disponible_operativo),
      unidad_medida: normalizarUmb(material.unidad_medida),
    })
  }

  async function guardarEdicion(material: InventarioOperativo) {
    setGuardando(true)
    setError('')
    setAviso('')

    const payload = prepararPayload(edicion, material.stock_minimo)

    if (!payload) {
      setError('Revisa los campos del material antes de guardar.')
      setGuardando(false)
      return
    }

    const resultado = await actualizarMaterial(material.id, payload)

    if (resultado.error) {
      setError(resultado.error.message)
      setGuardando(false)
      return
    }

    setEditandoId('')
    setEdicion(formularioInicial)
    setGuardando(false)
    setAviso('Material actualizado y coordinado con inventario, pedidos y alertas.')
    cargarDatos()
  }

  async function eliminarMaterialSeleccionado(material: InventarioOperativo) {
    const confirmado = window.confirm(
      `Eliminar ${material.nombre}? Se quitara del inventario y se cerraran sus alertas relacionadas.`
    )

    if (!confirmado) return

    setEliminando(material.id)
    setError('')
    setAviso('')

    const { error } = await eliminarMaterial(material.id)

    if (error) {
      setError(error.message)
      setEliminando('')
      return
    }

    setEliminando('')
    setAviso('Material eliminado correctamente.')
    cargarDatos()
  }

  useEffect(() => {
    const timer = window.setTimeout(cargarDatos, 0)
    const dejarDeEscucharMateriales = escucharMateriales(cargarDatos)
    const dejarDeEscucharInventario = escucharInventarioOperativo(cargarDatos)

    return () => {
      window.clearTimeout(timer)
      dejarDeEscucharMateriales()
      dejarDeEscucharInventario()
    }
  }, [])

  const resumen = useMemo(() => {
    const stockDisponible = materiales.reduce(
      (total, material) => total + material.stock_disponible_operativo,
      0
    )
    const suministradores = new Set(
      materiales
        .map((material) => material.codigo_suministrador)
        .filter((codigo): codigo is string => Boolean(codigo))
    )
    const reabastecimiento = materiales.reduce(
      (total, material) => total + reabastecimientoPendiente(material),
      0
    )

    return [
      {
        titulo: 'Materiales',
        valor: materiales.length,
        detalle: 'Registros activos en inventario',
        icono: Boxes,
        tono: 'text-blue-600',
      },
      {
        titulo: 'Stock disponible',
        valor: formatearNumero(stockDisponible),
        detalle: 'Disponible operativo acumulado',
        icono: PackageCheck,
        tono: 'text-green-600',
      },
      {
        titulo: 'Suministradores',
        valor: suministradores.size,
        detalle: 'Proveedores relacionados',
        icono: Users,
        tono: 'text-orange-600',
      },
      {
        titulo: 'Reabastecimiento',
        valor: formatearNumero(reabastecimiento),
        detalle: 'Transito y OC pendientes',
        icono: AlertTriangle,
        tono: 'text-yellow-600',
      },
    ]
  }, [materiales])

  const catmanOpciones = useMemo(() => {
    return [
      ...new Set(
        materiales
          .map((material) => material.catman_categoria || material.categoria)
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b))
  }, [materiales])

  const suministradorOpciones = useMemo(() => {
    return [
      ...new Set(
        materiales
          .map((material) => material.nombre_suministrador)
          .filter((suministrador): suministrador is string => Boolean(suministrador))
      ),
    ].sort((a, b) => a.localeCompare(b))
  }, [materiales])

  const inventarioFiltrado = useMemo(() => {
    const texto = normalizarTexto(busqueda)

    return materiales
      .filter((material) => {
        const catman = material.catman_categoria || material.categoria
        const estadoStock = resolverEstadoStock(material)
        const estadoPlanificable = normalizarEstadoPlanificable(material.estado_planificable)
        const coincideTexto = texto
          ? [
              material.codigo_material,
              material.nombre,
              catman,
              material.catman_nombre,
              material.nombre_suministrador,
              material.codigo_suministrador,
              material.marca_material,
              material.unidad_medida,
            ]
              .join(' ')
              .toLowerCase()
              .includes(texto)
          : true
        const coincideCatman = catmanFiltro === 'todos' || catman === catmanFiltro
        const coincidePlanificable =
          estadoPlanificableFiltro === 'todos' ||
          estadoPlanificable === estadoPlanificableFiltro
        const coincideEstadoStock =
          estadoStockFiltro === 'todos' || estadoStock === estadoStockFiltro
        const coincideSuministrador =
          suministradorFiltro === 'todos' ||
          material.nombre_suministrador === suministradorFiltro

        return (
          coincideTexto &&
          coincideCatman &&
          coincidePlanificable &&
          coincideEstadoStock &&
          coincideSuministrador
        )
      })
      .sort((a, b) => prioridadEstadoStock(a) - prioridadEstadoStock(b) || a.nombre.localeCompare(b.nombre))
  }, [
    busqueda,
    catmanFiltro,
    estadoPlanificableFiltro,
    estadoStockFiltro,
    materiales,
    suministradorFiltro,
  ])

  const totalPaginas = Math.max(1, Math.ceil(inventarioFiltrado.length / MATERIALES_INVENTARIO_POR_PAGINA))
  const paginaActual = Math.min(pagina, totalPaginas)
  const inventarioVisible = useMemo(() => {
    const inicio = (paginaActual - 1) * MATERIALES_INVENTARIO_POR_PAGINA
    return inventarioFiltrado.slice(inicio, inicio + MATERIALES_INVENTARIO_POR_PAGINA)
  }, [inventarioFiltrado, paginaActual])

  return (
    <div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Inventario y materiales</h1>
          <p className="mt-1 text-slate-500">
            Catalogo operativo con stock, suministradores, catman y estado planificable.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => setMostrarFormulario((actual) => !actual)}
            className="inline-flex items-center justify-center gap-2 bg-[#a33e00] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#842f00]"
            aria-expanded={mostrarFormulario}
          >
            <PackagePlus size={16} />
            {mostrarFormulario ? 'Ocultar' : 'Agregar'}
          </button>
          <button
            type="button"
            onClick={cargarDatos}
            className="inline-flex items-center justify-center gap-2 border border-[#cfc4c5] bg-white px-4 py-2 text-sm font-semibold text-[#1a1a1a] transition hover:bg-[#f4f2fd]"
          >
            <RefreshCw size={16} />
            Actualizar materiales
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      {aviso && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {aviso}
        </div>
      )}

      {mostrarFormulario && (
        <form
          onSubmit={registrarMaterial}
          className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-semibold text-slate-800">Agregar material</h2>
            <button
              type="button"
              onClick={() => {
                setFormulario(formularioInicial)
                setMostrarFormulario(false)
              }}
              className="inline-flex items-center justify-center gap-2 border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <X size={16} />
              Cancelar
            </button>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-5">
            <CampoTexto
              label="Material"
              value={formulario.nombre}
              onChange={(nombre) => setFormulario({ ...formulario, nombre })}
              placeholder="Nombre del material"
            />
            <CampoTexto
              label="Catman"
              value={formulario.categoria}
              onChange={(categoria) => setFormulario({ ...formulario, categoria })}
              placeholder="Catman / categoria"
            />
            <CampoTexto
              label="Stock disponible"
              type="number"
              value={formulario.stock_actual}
              onChange={(stock_actual) => setFormulario({ ...formulario, stock_actual })}
              placeholder="Ej. 100"
            />
            <FiltroSelect
              label="UMB"
              value={formulario.unidad_medida}
              onChange={(unidad_medida) => setFormulario({ ...formulario, unidad_medida })}
              opciones={['UND', 'SAC', 'T']}
            />
            <div className="flex items-end">
              <button
                type="submit"
                disabled={guardando}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2 font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                <Save size={16} />
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
        {resumen.map((item) => {
          const Icono = item.icono

          return (
            <article key={item.titulo} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">{item.titulo}</p>
                <Icono className={item.tono} size={22} />
              </div>
              <strong className="mt-2 block text-3xl text-slate-900">
                {cargando ? '-' : item.valor}
              </strong>
              <p className="mt-3 text-sm text-slate-500">{item.detalle}</p>
            </article>
          )
        })}
      </div>

      <section className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Inventario completo</h2>
              <p className="mt-1 text-sm text-slate-500">
                {inventarioFiltrado.length} de {materiales.length} materiales visibles.
              </p>
            </div>
            <div className="field-shell flex items-center rounded-lg border border-slate-300 bg-white px-3">
              <Search size={18} className="text-slate-400" />
              <input
                value={busqueda}
                onChange={(event) => {
                  setBusqueda(event.target.value)
                  setPagina(1)
                }}
                className="w-full border-0 px-3 py-2 outline-none sm:w-80"
                placeholder="Buscar material, codigo, catman o suministrador"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
            <FiltroSelect
              label="Catman"
              value={catmanFiltro}
              onChange={(value) => {
                setCatmanFiltro(value)
                setPagina(1)
              }}
              opciones={['todos', ...catmanOpciones]}
            />
            <FiltroSelect
              label="Estado planificable"
              value={estadoPlanificableFiltro}
              onChange={(value) => {
                setEstadoPlanificableFiltro(value as EstadoPlanificableFiltro)
                setPagina(1)
              }}
              opciones={['todos', 'planificable', 'no planificable', 'agotar stock']}
            />
            <FiltroSelect
              label="Estado de stock"
              value={estadoStockFiltro}
              onChange={(value) => {
                setEstadoStockFiltro(value as EstadoStockFiltro)
                setPagina(1)
              }}
              opciones={[
                'todos',
                'stock_negativo',
                'sin_stock',
                'bajo_minimo',
                'cobertura_media',
                'disponible',
                'reabastecimiento',
              ]}
            />
            <FiltroSelect
              label="Suministrador"
              value={suministradorFiltro}
              onChange={(value) => {
                setSuministradorFiltro(value)
                setPagina(1)
              }}
              opciones={['todos', ...suministradorOpciones]}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-5 py-3 text-left">Material</th>
                <th className="px-5 py-3 text-left">Suministrador</th>
                <th className="px-5 py-3 text-left">Catman</th>
                <th className="px-5 py-3 text-left">Stock disponible</th>
                <th className="px-5 py-3 text-left">Stock LU</th>
                <th className="px-5 py-3 text-left">Stock bloqueado</th>
                <th className="px-5 py-3 text-left">Stock transito</th>
                <th className="px-5 py-3 text-left">UMB</th>
                <th className="px-5 py-3 text-left">Estado planificable</th>
                <th className="px-5 py-3 text-left">Compra/Venta</th>
                <th className="px-5 py-3 text-left">Estado stock</th>
                <th className="px-5 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {inventarioVisible.map((material) => {
                const estadoStock = resolverEstadoStock(material)
                const porcentaje = porcentajeStock(material)
                const editando = editandoId === material.id

                return (
                  <tr key={material.id} className="border-t border-slate-100 align-top">
                    <td className={`border-l-4 px-5 py-4 ${bordeEstadoStock(estadoStock)}`}>
                      {editando ? (
                        <CampoInline
                          value={edicion.nombre}
                          onChange={(nombre) => setEdicion({ ...edicion, nombre })}
                        />
                      ) : (
                        <>
                          <p className="font-semibold text-slate-800">{material.nombre}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {material.codigo_material || 'Sin codigo'}
                          </p>
                        </>
                      )}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      <p className="font-semibold text-slate-700">
                        {material.nombre_suministrador || 'Sin suministrador'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {material.codigo_suministrador || 'Sin codigo'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Marca: {material.marca_material || 'Sin marca'}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {editando ? (
                        <CampoInline
                          value={edicion.categoria}
                          onChange={(categoria) => setEdicion({ ...edicion, categoria })}
                        />
                      ) : (
                        <>
                          <p className="font-semibold text-slate-700">{material.catman_nombre}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {material.catman_categoria}
                          </p>
                        </>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {editando ? (
                        <CampoInline
                          type="number"
                          value={edicion.stock_actual}
                          onChange={(stock_actual) => setEdicion({ ...edicion, stock_actual })}
                        />
                      ) : (
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${colorEstadoStock(estadoStock)}`}>
                          {formatearNumero(material.stock_disponible_operativo)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-slate-600">{formatearNumero(material.stock_libre)}</td>
                    <td className="px-5 py-4 text-slate-600">{formatearNumero(material.stock_bloqueado)}</td>
                    <td className="px-5 py-4 text-slate-600">
                      {formatearNumero(stockTransitoOperativo(material))}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {editando ? (
                        <select
                          value={edicion.unidad_medida}
                          onChange={(event) => setEdicion({ ...edicion, unidad_medida: event.target.value })}
                          className="w-24 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500"
                        >
                          <option value="UND">UND</option>
                          <option value="SAC">SAC</option>
                          <option value="T">T</option>
                        </select>
                      ) : (
                        normalizarUmb(material.unidad_medida)
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        {formatearEtiqueta(normalizarEstadoPlanificable(material.estado_planificable))}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      <p>Min compra {formatearNumero(material.min_compra)}</p>
                      <p>Mult compra {formatearNumero(material.mult_compra)}</p>
                      <p>Min vta {formatearNumero(material.min_venta)}</p>
                      <p>Mult vta {formatearNumero(material.mult_venta)}</p>
                    </td>
                    <td className="min-w-44 px-5 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${colorEstadoStock(estadoStock)}`}>
                        {formatearEtiqueta(estadoStock)}
                      </span>
                      <div className="mt-3 flex items-center gap-3">
                        <div className="h-2 flex-1 rounded-full bg-slate-100">
                          <div
                            className={`h-2 rounded-full ${colorBarraStock(estadoStock)}`}
                            style={{ width: `${porcentaje}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-xs font-semibold text-slate-600">
                          {porcentaje}%
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        {editando ? (
                          <>
                            <button
                              type="button"
                              onClick={() => guardarEdicion(material)}
                              disabled={guardando}
                              className="inline-flex items-center gap-1 rounded-lg border border-green-200 px-3 py-1.5 text-xs font-semibold text-green-700 transition hover:bg-green-50 disabled:opacity-60"
                            >
                              <Save size={14} />
                              Guardar
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditandoId('')}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              <X size={14} />
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => iniciarEdicion(material)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              <Edit3 size={14} />
                              Editar
                            </button>
                            <button
                              type="button"
                              disabled={eliminando === material.id}
                              onClick={() => eliminarMaterialSeleccionado(material)}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                            >
                              <Trash2 size={14} />
                              Eliminar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}

              {!cargando && inventarioFiltrado.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-5 py-10 text-center text-slate-500">
                    No hay materiales que coincidan con los filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {inventarioFiltrado.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Pagina {paginaActual} de {totalPaginas}. Mostrando {inventarioVisible.length} de {inventarioFiltrado.length} materiales.
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
      </section>
    </div>
  )
}

function CampoTexto({
  label,
  onChange,
  placeholder,
  type = 'text',
  value,
}: {
  label: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  value: string
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

function CampoInline({
  onChange,
  type = 'text',
  value,
}: {
  onChange: (value: string) => void
  type?: string
  value: string
}) {
  return (
    <input
      type={type}
      min={type === 'number' ? 0 : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full min-w-32 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500"
    />
  )
}

function FiltroSelect({
  label,
  onChange,
  opciones,
  value,
}: {
  label: string
  onChange: (value: string) => void
  opciones: string[]
  value: string
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 outline-none focus:ring-2 focus:ring-orange-500"
      >
        {opciones.map((opcion) => (
          <option key={opcion} value={opcion}>
            {formatearEtiqueta(opcion)}
          </option>
        ))}
      </select>
    </label>
  )
}

function prepararPayload(form: MaterialForm, stockMinimo: number): MaterialInput | null {
  const stockActual = Number(form.stock_actual)

  if (
    !form.nombre.trim() ||
    !form.categoria.trim() ||
    !form.unidad_medida.trim() ||
    Number.isNaN(stockActual) ||
    stockActual < 0
  ) {
    return null
  }

  return {
    nombre: form.nombre.trim(),
    categoria: form.categoria.trim(),
    stock_actual: stockActual,
    stock_minimo: stockMinimo,
    unidad_medida: normalizarUmb(form.unidad_medida),
    es_critico: false,
  }
}

function resolverEstadoStock(material: InventarioOperativo): EstadoStockFiltro {
  const stock = material.stock_disponible_operativo
  const minimo = umbralMinimoMaterial(material)
  const amarillo = umbralAmarilloMaterial(material)
  const verde = umbralVerdeMaterial(material)

  if (material.stock_disponible_operativo < 0) return 'stock_negativo'
  if (stock <= 0) return 'sin_stock'
  if (stock < minimo) return 'bajo_minimo'
  if (stock < amarillo && reabastecimientoPendiente(material) > 0) {
    return 'reabastecimiento'
  }
  if (stock < verde) return 'cobertura_media'
  return 'disponible'
}

function prioridadEstadoStock(material: InventarioOperativo) {
  const estado = resolverEstadoStock(material)
  if (estado === 'stock_negativo') return 0
  if (estado === 'sin_stock') return 1
  if (estado === 'bajo_minimo') return 2
  if (estado === 'cobertura_media') return 3
  if (estado === 'reabastecimiento') return 4
  return 5
}

function porcentajeStock(material: InventarioOperativo) {
  const base = Math.max(umbralVerdeMaterial(material), 1)
  const cobertura =
    Math.max(0, material.stock_disponible_operativo) + Math.max(0, reabastecimientoPendiente(material))
  const porcentaje = Math.round((cobertura / base) * 100)

  return Math.max(0, Math.min(porcentaje, 100))
}

function colorEstadoStock(estado: EstadoStockFiltro) {
  if (estado === 'stock_negativo') return claseSemaforoBadge('critico')
  if (estado === 'sin_stock') return claseSemaforoBadge('critico')
  if (estado === 'bajo_minimo') return claseSemaforoBadge('critico')
  if (estado === 'cobertura_media') return claseSemaforoBadge('riesgo')
  if (estado === 'reabastecimiento') return claseSemaforoBadge('riesgo')
  if (estado === 'disponible') return claseSemaforoBadge('a_tiempo')
  return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
}

function bordeEstadoStock(estado: EstadoStockFiltro) {
  if (estado === 'stock_negativo') return 'border-l-red-700'
  if (estado === 'sin_stock') return 'border-l-red-600'
  if (estado === 'bajo_minimo') return 'border-l-red-600'
  if (estado === 'cobertura_media') return 'border-l-yellow-500'
  if (estado === 'reabastecimiento') return 'border-l-yellow-500'
  if (estado === 'disponible') return 'border-l-green-600'
  return 'border-l-slate-400'
}

function colorBarraStock(estado: EstadoStockFiltro) {
  if (estado === 'stock_negativo') return claseSemaforoBarra('critico')
  if (estado === 'sin_stock') return claseSemaforoBarra('critico')
  if (estado === 'bajo_minimo') return claseSemaforoBarra('critico')
  if (estado === 'cobertura_media') return claseSemaforoBarra('riesgo')
  if (estado === 'reabastecimiento') return claseSemaforoBarra('riesgo')
  return claseSemaforoBarra('a_tiempo')
}

function umbralMinimoMaterial(material: InventarioOperativo) {
  return Math.max(1, material.pedido_maximo_material || material.stock_minimo || material.demanda_bodega_fq || 1)
}

function umbralAmarilloMaterial(material: InventarioOperativo) {
  return umbralMinimoMaterial(material) * 2
}

function umbralVerdeMaterial(material: InventarioOperativo) {
  return Math.max(umbralMinimoMaterial(material) * 3, material.stock_objetivo_material || 0)
}

function stockTransitoOperativo(material: InventarioOperativo) {
  return Math.max(0, material.stock_transito) + Math.max(0, material.stock_en_curso_pedido)
}

function reabastecimientoPendiente(material: InventarioOperativo) {
  return stockTransitoOperativo(material) + Math.max(0, material.cantidad_oc_pendiente)
}

function normalizarEstadoPlanificable(valor?: string | null): EstadoPlanificableFiltro {
  const texto = normalizarTexto(valor || '')
  if (texto.includes('agotar')) return 'agotar stock'
  if (texto.includes('no plan') || texto.includes('exclu')) return 'no planificable'
  return 'planificable'
}

function normalizarUmb(valor?: string | null) {
  const texto = normalizarTexto(valor || '')
  if (['sac', 'saco', 'bag'].includes(texto)) return 'SAC'
  if (['t', 'ton', 'tona', 'tonelada', 'tm'].includes(texto)) return 'T'
  return 'UND'
}

function formatearNumero(valor: number) {
  return new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 }).format(valor)
}

function formatearEtiqueta(valor: string) {
  return valor.replace(/_/g, ' ')
}

function normalizarTexto(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function mensajeErrorMateriales(error: { code?: string; message: string }) {
  if (error.code === '42P01' || error.message.includes('materiales')) {
    return 'Falta activar la tabla materiales en Supabase.'
  }

  return error.message
}
