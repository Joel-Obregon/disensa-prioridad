import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  PackagePlus,
  Plus,
  Search,
  Truck,
  X,
  XCircle,
} from 'lucide-react'
import { useAuth } from '../auth/authState'
import MaterialSearchSelect from '../components/MaterialSearchSelect'
import ModalExito from '../components/ModalExito'
import ModalAlerta from '../components/ModalAlerta'
import { useConfirmar } from '../components/ConfirmacionProvider'
import { registrarAuditoria } from '../services/auditoriaService'
import { obtenerInventarioOperativo } from '../services/inventarioService'
import {
  actualizarEstadoPedido,
  crearPedido,
  marcarReposicionSinStock,
  obtenerPedidos,
  recibirReposicionBodega,
} from '../services/pedidosService'
import { esEnteroPositivo, soloEnteroNoNegativo } from '../lib/validacionesFormulario'
import { describirTiempoPedido } from '../lib/semaforoOperativo'
import type { EstadoPedido, Pedido } from '../types/pedido'
import type { InventarioOperativo } from '../types/material'

type ItemReposicion = { material_id: string; cantidad: string }

function generarCodigoReposicion() {
  const base = Date.now().toString(36).toUpperCase()
  const rnd = Math.floor(1000 + Math.random() * 9000)
  return `REP-${base}-${rnd}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function esUuid(valor: string | null | undefined): valor is string {
  return typeof valor === 'string' && UUID_RE.test(valor)
}

function esAgotarStock(material?: InventarioOperativo | null) {
  return (material?.estado_planificable || '').trim().toLowerCase() === 'agotar stock'
}

const PASOS_REPOSICION = ['Solicitada', 'Enviada', 'En inventario']

function pasoReposicion(estado: EstadoPedido) {
  if (estado === 'entregado') return 2
  if (estado === 'en_despacho') return 1
  return 0
}

function ProcesoReposicion({ estado }: { estado: EstadoPedido }) {
  if (estado === 'rechazado') {
    return (
      <span className="inline-flex rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200">
        Sin stock
      </span>
    )
  }
  if (estado === 'cancelado') {
    return (
      <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
        Cancelada
      </span>
    )
  }
  const paso = pasoReposicion(estado)
  return (
    <div className="flex items-center">
      {PASOS_REPOSICION.map((label, indice) => {
        const cumplido = indice <= paso
        return (
          <div key={label} className="flex items-center">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                cumplido ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-400 ring-1 ring-slate-300'
              }`}
            >
              {indice + 1}
            </span>
            <span className={`ml-1 text-[11px] font-semibold ${cumplido ? 'text-green-800' : 'text-slate-400'}`}>
              {label}
            </span>
            {indice < PASOS_REPOSICION.length - 1 && (
              <span className={`mx-1.5 h-px w-4 ${indice < paso ? 'bg-green-500' : 'bg-slate-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function Reposicion() {
  const { perfil } = useAuth()
  const rol = perfil?.rol || 'administrador'
  const confirmar = useConfirmar()

  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [materiales, setMateriales] = useState<InventarioOperativo[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [modalExito, setModalExito] = useState('')
  const [modalAlerta, setModalAlerta] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const [materialId, setMaterialId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [fecha, setFecha] = useState('')
  const [items, setItems] = useState<ItemReposicion[]>([])

  const puedeCrear = rol === 'administrador'
  const esSuministrador = rol === 'suministrador'

  async function cargar() {
    setCargando(true)
    setError('')
    const [pedidosRes, invRes] = await Promise.all([
      obtenerPedidos(),
      obtenerInventarioOperativo(true),
    ])
    if (pedidosRes.error) setError('No se pudieron cargar las reposiciones.')
    else setPedidos(pedidosRes.data || [])
    if (!invRes.error) setMateriales(invRes.data || [])
    setCargando(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(cargar, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const materialesLookup = useMemo(
    () => new Map(materiales.map((material) => [material.id, material])),
    [materiales],
  )

  // Reposiciones = pedidos de compra (suministrador a bodega).
  const reposiciones = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    return pedidos
      .filter((pedido) => pedido.origen === 'suministrador' || pedido.destino === 'bodega')
      .filter(
        (pedido) =>
          !texto ||
          [pedido.codigo, pedido.material, pedido.solicitante].join(' ').toLowerCase().includes(texto),
      )
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  }, [pedidos, busqueda])

  function agregarMaterial() {
    if (!materialId || !esEnteroPositivo(cantidad)) {
      setError('Elige un material y una cantidad válida.')
      return
    }
    const materialElegido = materialesLookup.get(materialId)
    if (esAgotarStock(materialElegido)) {
      setModalAlerta(
        `"${materialElegido?.nombre}" está en agotar stock: no se puede solicitar reposición.`,
      )
      return
    }
    setItems((lista) => [
      ...lista.filter((item) => item.material_id !== materialId),
      { material_id: materialId, cantidad },
    ])
    setMaterialId('')
    setCantidad('')
    setError('')
  }

  function quitarMaterial(id: string) {
    setItems((lista) => lista.filter((item) => item.material_id !== id))
  }

  async function registrarReposicion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setGuardando(true)
    setError('')

    if (!fecha) {
      setError('Indica la fecha requerida.')
      setGuardando(false)
      return
    }

    const lista = [...items]
    if (materialId && esEnteroPositivo(cantidad)) {
      lista.push({ material_id: materialId, cantidad })
    }

    const resueltos = lista
      .map((item) => ({ material: materialesLookup.get(item.material_id), cantidad: Number(item.cantidad) }))
      .filter((item) => item.material && item.cantidad > 0)

    if (resueltos.length === 0) {
      setError('Agrega al menos un material a la reposición.')
      setGuardando(false)
      return
    }

    const enAgotarStock = resueltos.find((item) => esAgotarStock(item.material))
    if (enAgotarStock) {
      setModalAlerta(
        `"${enAgotarStock.material?.nombre}" está en agotar stock: no se puede solicitar reposición. Quítalo de la lista.`,
      )
      setGuardando(false)
      return
    }

    const codigoBase = generarCodigoReposicion()
    const grupoId = resueltos.length > 1 ? crypto.randomUUID() : null

    for (const [indice, item] of resueltos.entries()) {
      const material = item.material
      if (!material) continue

      const { error: errorCrear } = await crearPedido({
        codigo: indice === 0 ? codigoBase : `${codigoBase}-${indice + 1}`,
        codigo_consulta: codigoBase,
        grupo_id: grupoId,
        codigo_material: material.codigo_material || (esUuid(material.id) ? null : material.id),
        material_id: esUuid(material.id) ? material.id : null,
        material: material.nombre,
        cantidad: item.cantidad,
        cantidad_despacho: item.cantidad,
        unidad_medida: material.unidad_medida,
        stock_disponible: material.stock_disponible_operativo ?? material.stock_actual ?? 0,
        origen: 'suministrador',
        destino: 'bodega',
        solicitante: material.nombre_suministrador || 'Reposición de bodega',
        cedula_solicitante: '0000000000',
        fecha_compromiso: fecha,
        urgencia: 'media',
        tipo_cliente: 'bodega',
        accion_solicitante: 'esperar_pedido',
        condicion_material: 'normal',
        tipo_caso: null,
      })

      if (errorCrear) {
        setModalAlerta(errorCrear.message)
        setGuardando(false)
        return
      }
    }

    setItems([])
    setMaterialId('')
    setCantidad('')
    setFecha('')
    setMostrarFormulario(false)
    setGuardando(false)
    setModalExito(
      resueltos.length > 1
        ? `Reposición con ${resueltos.length} materiales enviada al suministrador.`
        : 'Reposición enviada al suministrador.',
    )
    cargar()
  }


  async function enviarReposicion(pedido: Pedido) {
    const ok = await confirmar({
      titulo: 'Confirmar y enviar',
      mensaje: `¿Confirmas que tienes el stock y envías ${pedido.cantidad} ${pedido.unidad_medida} de ${pedido.material}? Se sumará al inventario de bodega.`,
      confirmarTexto: 'Sí, enviar',
      peligro: false,
    })
    if (!ok) return
    const { error: e } = await recibirReposicionBodega(pedido.id)
    if (e) {
      setError(e.message)
      return
    }
    await registrarAuditoria({
      entidad: 'pedidos',
      entidad_id: pedido.id,
      accion: 'reposicion_enviada',
      detalle: `${pedido.codigo}: enviada y sumada al inventario de bodega.`,
    })
    setModalExito('Material enviado y sumado al inventario de bodega.')
    cargar()
  }

  async function sinStockReposicion(pedido: Pedido) {
    const mensaje = window.prompt(
      `No hay stock para ${pedido.material}. Escribe el mensaje para el administrador:`,
      'No contamos con stock para el envío.',
    )
    if (mensaje === null) return
    const { error: e } = await marcarReposicionSinStock(pedido.id, mensaje.trim() || 'Sin stock disponible.')
    if (e) {
      setError(e.message)
      return
    }
    await registrarAuditoria({
      entidad: 'pedidos',
      entidad_id: pedido.id,
      accion: 'reposicion_sin_stock',
      detalle: `${pedido.codigo}: sin stock. ${mensaje}`,
    })
    setModalExito('Se notificó al administrador que no hay stock para el envío.')
    cargar()
  }

  async function cancelarReposicion(pedido: Pedido) {
    const ok = await confirmar({
      titulo: 'Cancelar reposición',
      mensaje: `¿Cancelar la reposición de ${pedido.cantidad} ${pedido.unidad_medida} de ${pedido.material} (${pedido.codigo})?`,
      confirmarTexto: 'Sí, cancelar',
      peligro: true,
    })
    if (!ok) return
    const { error: e } = await actualizarEstadoPedido(pedido.id, 'cancelado', {
      pedido,
      responsable: 'Administrador',
    })
    if (e) {
      setError(e.message)
      return
    }
    await registrarAuditoria({
      entidad: 'pedidos',
      entidad_id: pedido.id,
      accion: 'reposicion_cancelada',
      detalle: `${pedido.codigo}: reposición cancelada por el administrador.`,
    })
    setModalExito('Reposición cancelada.')
    cargar()
  }

  return (
    <div className="space-y-6">
      <ModalExito mensaje={modalExito} onClose={() => setModalExito('')} />
      <ModalAlerta mensaje={modalAlerta} onClose={() => setModalAlerta('')} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <PackagePlus className="text-[#c8102e]" size={22} />
            <h1 className="text-2xl font-bold text-slate-800">Reposición de materiales</h1>
          </div>
          {puedeCrear && (
            <p className="mt-1 text-slate-500">
              Pide al suministrador el material que necesitas reponer.
            </p>
          )}
        </div>
        {puedeCrear && (
          <button
            type="button"
            onClick={() => {
              setMostrarFormulario((actual) => !actual)
              setError('')
            }}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#c8102e] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#a50d26]"
          >
            <Plus size={17} />
            {mostrarFormulario ? 'Cancelar' : 'Nueva reposición'}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {mostrarFormulario && puedeCrear && (
        <form onSubmit={registrarReposicion} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-800">Nueva reposición al suministrador</h2>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            <MaterialSearchSelect
              label="Material"
              materiales={materiales}
              value={materialId}
              onChange={setMaterialId}
              placeholder="Escribe nombre, código o categoría"
              emptyLabel="No hay materiales con esas letras."
            />
            <label className="block text-sm font-medium text-slate-700">
              Cantidad a reponer
              <input
                type="text"
                inputMode="numeric"
                maxLength={7}
                value={cantidad}
                onChange={(event) => setCantidad(soloEnteroNoNegativo(event.target.value, 7))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Ej. 100"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Fecha requerida
              <input
                type="datetime-local"
                value={fecha}
                onChange={(event) => setFecha(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 outline-none focus:ring-2 focus:ring-orange-500"
              />
            </label>

            <div className="md:col-span-3">
              <span className="block text-sm font-medium text-slate-700">Suministrador</span>
              <div className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600">
                {materialesLookup.get(materialId)?.nombre_suministrador ||
                  'Se toma automaticamente del material seleccionado'}
              </div>
            </div>

            <div className="md:col-span-3">
              <button
                type="button"
                onClick={agregarMaterial}
                className="inline-flex items-center gap-2 rounded-lg border border-[#c8102e] px-4 py-2 text-sm font-semibold text-[#c8102e] transition hover:bg-[#fff1ec]"
              >
                <Plus size={16} /> Agregar material a la reposición
              </button>

              {items.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {items.map((item, indice) => {
                    const material = materialesLookup.get(item.material_id)
                    return (
                      <li key={item.material_id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate text-slate-700">
                          <span className="mr-2 font-semibold text-[#a33e00]">{indice + 1}.</span>
                          {material?.nombre || item.material_id} - {item.cantidad} {material?.unidad_medida || ''}
                          {material?.nombre_suministrador ? ` · ${material.nombre_suministrador}` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => quitarMaterial(item.material_id)}
                          className="text-slate-400 transition hover:text-[#c8102e]"
                          aria-label="Quitar material"
                        >
                          <XCircle size={18} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="submit"
              disabled={guardando}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#c8102e] px-5 py-2 font-semibold text-white transition hover:bg-[#a50d26] disabled:opacity-60"
            >
              <PackagePlus size={16} />
              {guardando ? 'Enviando...' : 'Enviar reposición'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMostrarFormulario(false)
                setItems([])
                setMaterialId('')
                setCantidad('')
                setFecha('')
              }}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-3 py-2 text-slate-700 transition hover:bg-slate-50"
              aria-label="Cerrar formulario"
            >
              <X size={16} />
            </button>
          </div>
        </form>
      )}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <Truck size={18} className="text-[#c8102e]" />
            Reposiciones registradas
          </div>
          <div className="field-shell flex items-center rounded-lg border-2 border-[#c8102e] bg-white px-3">
            <Search size={18} className="text-slate-400" />
            <input
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
              className="w-full border-0 px-3 py-2 outline-none sm:w-72"
              placeholder="Buscar por código, material o suministrador"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-5 py-3 text-left">Código</th>
                <th className="px-5 py-3 text-left">Material</th>
                <th className="px-5 py-3 text-left">Suministrador</th>
                <th className="px-5 py-3 text-left">Cantidad</th>
                <th className="px-5 py-3 text-left">Estado</th>
                {(esSuministrador || puedeCrear) && <th className="px-5 py-3 text-left">Acción</th>}
              </tr>
            </thead>
            <tbody>
              {reposiciones.map((pedido) => {
                return (
                  <tr key={pedido.id} className="border-t border-slate-100 align-top">
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-800">{pedido.codigo}</p>
                      <p className="mt-1 text-xs text-slate-500">{describirTiempoPedido(pedido)}</p>
                    </td>
                    <td className="px-5 py-4 text-slate-700">{pedido.material}</td>
                    <td className="px-5 py-4 text-slate-600">{pedido.solicitante}</td>
                    <td className="px-5 py-4 font-semibold text-slate-800">
                      {pedido.cantidad} {pedido.unidad_medida}
                    </td>
                    <td className="px-5 py-4">
                      <ProcesoReposicion estado={pedido.estado} />
                      {pedido.estado === 'rechazado' && pedido.mensaje_suministrador && (
                        <p className="mt-2 max-w-[240px] text-xs font-medium text-red-600">
                          {pedido.mensaje_suministrador}
                        </p>
                      )}
                    </td>
                    {(esSuministrador || puedeCrear) && (
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-2">
                          {['pendiente', 'en_revision', 'aprobado', 'en_despacho'].includes(pedido.estado) ? (
                            <>
                              {esSuministrador && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => enviarReposicion(pedido)}
                                    className="inline-flex items-center gap-1 rounded border border-green-400 bg-green-50 px-2.5 py-1.5 text-xs font-semibold text-green-800 transition hover:bg-green-100"
                                  >
                                    <Truck size={13} /> Confirmar y enviar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => sinStockReposicion(pedido)}
                                    className="inline-flex items-center gap-1 rounded border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                                  >
                                    <XCircle size={13} /> Sin stock
                                  </button>
                                </>
                              )}
                              {puedeCrear && (
                                <button
                                  type="button"
                                  onClick={() => cancelarReposicion(pedido)}
                                  className="inline-flex items-center gap-1 rounded border border-red-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                                >
                                  <XCircle size={13} /> Cancelar
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}

              {!cargando && reposiciones.length === 0 && (
                <tr>
                  <td colSpan={(esSuministrador || puedeCrear) ? 6 : 5} className="px-5 py-10 text-center text-sm text-slate-500">
                    No hay reposiciones registradas todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
