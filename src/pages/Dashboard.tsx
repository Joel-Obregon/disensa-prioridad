import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Package,
  PackageX,
  Timer,
  Truck,
  Warehouse,
} from 'lucide-react'
import { useAuth } from '../auth/authState'
import { calcularPrioridad, ordenarPorPrioridad, resolverNivelPrioridad } from '../lib/prioridad'
import {
  clasePrioridadBadge,
  clasePrioridadBarra,
  claseSemaforoBadge,
  claseSemaforoBarra,
  describirTiempoPedido,
  resolverSemaforoPedido,
  type SemaforoOperativo,
} from '../lib/semaforoOperativo'
import { escucharCambiosAlertas, obtenerAlertas } from '../services/alertasService'
import {
  escucharInventarioOperativo,
  obtenerInventarioOperativo,
} from '../services/inventarioService'
import { escucharMateriales } from '../services/materialesService'
import { obtenerOtifOperativo, type OtifOperativo } from '../services/operacionService'
import { escucharPedidos, obtenerPedidos } from '../services/pedidosService'
import { obtenerReglas } from '../services/reglasService'
import type { Alerta } from '../types/alerta'
import type { InventarioOperativo } from '../types/material'
import type { Pedido } from '../types/pedido'
import type { ReglaNegocio } from '../types/regla'
import type { RolUsuario } from '../types/usuario'

type TarjetaDashboard = {
  titulo: string
  valor: number
  detalle: string
  icono: typeof ClipboardList
  tono: 'amber' | 'blue' | 'green' | 'red'
}

type DashboardMetricas = {
  entregados: number
  enDespacho: number
  ncOEspera: number
  pedidosCriticos: number
  porDespachar: number
  retrasados: number
  sinStock: number
  totalPedidos: number
}

export default function Dashboard() {
  const { perfil } = useAuth()
  const rol = perfil?.rol || 'administrador'
  const [materiales, setMateriales] = useState<InventarioOperativo[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [reglas, setReglas] = useState<ReglaNegocio[]>([])
  const [otif, setOtif] = useState<OtifOperativo>(otifInicial())
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    async function cargarResumen() {
      const [materialesResult, alertasResult, pedidosResult, reglasResult, otifResult] = await Promise.all([
        obtenerInventarioOperativo(),
        obtenerAlertas(),
        obtenerPedidos(),
        obtenerReglas(),
        obtenerOtifOperativo(),
      ])

      setMateriales(materialesResult.data || [])
      setAlertas(alertasResult.data || [])
      setPedidos(pedidosResult.error ? [] : pedidosResult.data || [])
      setReglas(reglasResult.error ? [] : reglasResult.data || [])
      setOtif(otifResult.data || otifInicial())
      setCargando(false)
    }

    const timer = window.setTimeout(cargarResumen, 0)
    const dejarDeEscucharPedidos = escucharPedidos(cargarResumen)
    const dejarDeEscucharMateriales = escucharMateriales(cargarResumen)
    const dejarDeEscucharInventario = escucharInventarioOperativo(cargarResumen)
    const dejarDeEscucharAlertas = escucharCambiosAlertas(cargarResumen)

    return () => {
      window.clearTimeout(timer)
      dejarDeEscucharPedidos()
      dejarDeEscucharMateriales()
      dejarDeEscucharInventario()
      dejarDeEscucharAlertas()
    }
  }, [])

  const materialesUnicos = useMemo(() => {
    const mapa = new Map<string, InventarioOperativo>()

    materiales.forEach((material) => {
      const llave = normalizarTexto(material.nombre)
      const actual = mapa.get(llave)

      if (!actual || stockDisponibleMaterial(material) < stockDisponibleMaterial(actual)) {
        mapa.set(llave, material)
      }
    })

    return Array.from(mapa.values())
  }, [materiales])

  const materialesLookup = useMemo(() => {
    const porId = new Map<string, InventarioOperativo>()
    const porNombre = new Map<string, InventarioOperativo>()

    materialesUnicos.forEach((material) => {
      porId.set(material.id, material)
      porNombre.set(normalizarTexto(material.nombre), material)
    })

    return { porId, porNombre }
  }, [materialesUnicos])

  const pedidosConStockReal = useMemo(() => {
    return pedidos.map((pedido) => {
      const material =
        (pedido.material_id ? materialesLookup.porId.get(pedido.material_id) : null) ||
        materialesLookup.porNombre.get(normalizarTexto(pedido.material))

      if (!material) return pedido

      return {
        ...pedido,
        material: material.nombre,
        stock_disponible: Math.round(stockDisponibleMaterial(material)),
        unidad_medida: material.unidad_medida || pedido.unidad_medida,
      }
    })
  }, [materialesLookup, pedidos])

  const materialesFiltrados = materialesUnicos
  const pedidosVisibles = pedidosConStockReal
  const alertasVisibles = alertas

  const colaPriorizada = useMemo(
    () => ordenarPorPrioridad(pedidosVisibles, reglas),
    [pedidosVisibles, reglas]
  )

  const materialesEnRiesgo = useMemo(() => {
    return [...materialesFiltrados]
      .filter((material) => stockDisponibleMaterial(material) < material.stock_minimo)
      .sort((a, b) => ratioStock(a) - ratioStock(b))
      .slice(0, 5)
  }, [materialesFiltrados])

  const alertasActivas = useMemo(() => {
    const mapa = new Map<string, Alerta>()

    alertasVisibles
      .filter((alerta) => alerta.estado === 'activa')
      .forEach((alerta) => {
        const llave = `${alerta.tipo_alerta}-${alerta.mensaje}`
        if (!mapa.has(llave)) mapa.set(llave, alerta)
      })

    return Array.from(mapa.values())
  }, [alertasVisibles])

  const metricas = useMemo(() => {
    const pedidosCriticos = pedidosVisibles.filter(
      (pedido) => resolverNivelPrioridad(calcularPrioridad(pedido, reglas), pedido) === 'Critica'
    ).length
    const retrasados = pedidosVisibles.filter(
      (pedido) => pedido.estado === 'retrasado'
    ).length
    const entregados = pedidosVisibles.filter(
      (pedido) => pedido.estado === 'entregado'
    ).length
    const porDespachar = pedidosVisibles.filter(
      (pedido) => pedidoPendienteDespacho(pedido) && cantidadParaDespacho(pedido) > 0
    ).length
    const sinStock = pedidosVisibles.filter(
      (pedido) =>
        pedidoPendienteDespacho(pedido) &&
        pedido.stock_disponible < cantidadParaDespacho(pedido)
    ).length
    const enDespacho = pedidosVisibles.filter(
      (pedido) => pedido.estado === 'en_despacho'
    ).length
    const ncOEspera = pedidosVisibles.filter(
      (pedido) =>
        pedido.accion_solicitante === 'nota_credito' ||
        pedido.accion_solicitante === 'esperar_pedido'
    ).length

    return {
      entregados,
      enDespacho,
      ncOEspera,
      pedidosCriticos,
      porDespachar,
      retrasados,
      sinStock,
      totalPedidos: pedidosVisibles.length,
    }
  }, [pedidosVisibles, reglas])

  const tarjetas = useMemo(
    () => crearTarjetasPorRol(rol, metricas, materialesEnRiesgo.length, alertasActivas.length),
    [alertasActivas.length, materialesEnRiesgo.length, metricas, rol]
  )

  const siguientePedido = colaPriorizada[0]
  const puntajeSiguiente = siguientePedido ? calcularPrioridad(siguientePedido, reglas) : 0
  const nivelSiguiente = resolverNivelPrioridad(puntajeSiguiente, siguientePedido)
  const configuracionRol = obtenerConfiguracionRol(rol)
  const colaOperativa = useMemo(
    () => colaPriorizada.filter((pedido) => !pedidoCerrado(pedido)),
    [colaPriorizada]
  )
  const pedidosAbastecimiento = useMemo(
    () =>
      colaPriorizada.filter(
        (pedido) =>
          pedidoPendienteDespacho(pedido) &&
          (pedido.stock_disponible < cantidadParaDespacho(pedido) ||
            pedido.estado === 'sin_stock' ||
            pedido.origen === 'suministrador' ||
            pedido.destino === 'bodega')
      ),
    [colaPriorizada]
  )
  const distribucionPrioridad = useMemo(() => {
    const base = [
      { nombre: 'Critica', valor: 0, clase: 'bg-red-600' },
      { nombre: 'Alta', valor: 0, clase: 'bg-yellow-500' },
      { nombre: 'Media', valor: 0, clase: 'bg-yellow-500' },
      { nombre: 'Baja', valor: 0, clase: 'bg-green-500' },
    ]

    colaPriorizada.forEach((pedido) => {
      const nivel = resolverNivelPrioridad(calcularPrioridad(pedido, reglas), pedido)
      const item = base.find((dato) => dato.nombre === nivel)
      if (item) item.valor += 1
    })

    return base
  }, [colaPriorizada, reglas])
  const materialesPorDemanda = useMemo(
    () => construirTopMaterialesPorDemanda(pedidosVisibles),
    [pedidosVisibles]
  )
  const inventarioPorCategoria = useMemo(
    () => construirInventarioPorCategoria(materialesFiltrados),
    [materialesFiltrados]
  )
  const pedidosPorEstado = useMemo(
    () => construirPedidosPorEstado(pedidosVisibles),
    [pedidosVisibles]
  )

  return (
    <div className="dashboard-executive space-y-4">
      <section className="rounded-lg border border-[#d8d2df] bg-white p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#c8102e]">
              <Warehouse size={16} />
              {configuracionRol.etiqueta}
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-[#0f0f11]">
              Resumen ejecutivo
            </h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-[#5f5964]">
              {configuracionRol.descripcion}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 border-t border-[#efe5e3] pt-3">
          <Link
            to={configuracionRol.accionPrincipal.ruta}
            className="inline-flex items-center justify-center gap-2 bg-[#c8102e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#9f0d25]"
          >
            {configuracionRol.accionPrincipal.texto}
            <ArrowRight size={16} />
          </Link>
          <Link
            to={configuracionRol.accionSecundaria.ruta}
            className="inline-flex items-center justify-center gap-2 border border-[#cfc4c5] bg-white px-4 py-2 text-sm font-semibold text-[#1a1a1a] hover:bg-[#fff0f0]"
          >
            {configuracionRol.accionSecundaria.texto}
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
        <TarjetaOtif
          cargando={cargando}
          indicador={otif.suministradorBodega}
          titulo="OTIF suministrador a bodega"
        />
        <TarjetaOtif
          cargando={cargando}
          indicador={otif.bodegaFranquiciado}
          titulo="OTIF bodega a franquiciado"
        />
        {tarjetas.map((item) => {
          const Icono = item.icono

          return (
            <article
              key={item.titulo}
              className={`rounded-lg border border-[#d8d2df] bg-white p-3 ${bordeKpi(item.tono)}`}
            >
              <div className="flex items-start gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded ${colorIcono(item.tono)}`}>
                  <Icono size={20} />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#2f2f33]">
                    {item.titulo}
                  </p>
                  <strong className="font-tabular mt-1 block text-2xl font-black text-[#0f0f11]">
                    {cargando ? '-' : formatearNumero(item.valor)}
                  </strong>
                  <p className="mt-1 text-xs leading-5 text-[#5f5964]">{item.detalle}</p>
                </div>
              </div>
            </article>
          )
        })}
      </section>

      {rol === 'administrador' && (
        <>
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <PanelEjecutivo
              titulo="Prioridad de pedidos"
              descripcion="Distribucion por nivel calculado."
              icono={AlertTriangle}
            >
              <GraficoDonutPrioridad datos={distribucionPrioridad} />
            </PanelEjecutivo>

            <PanelEjecutivo
              titulo="Top materiales por demanda"
              descripcion="Materiales con mayor cantidad solicitada."
              icono={Package}
            >
              <GraficoTopMateriales datos={materialesPorDemanda} />
            </PanelEjecutivo>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_0.9fr_0.9fr]">
            <PanelEjecutivo
              titulo="Inventario por categoria"
              descripcion="Stock disponible agrupado por catman."
              icono={Boxes}
            >
              <GraficoInventarioCategoria datos={inventarioPorCategoria} />
            </PanelEjecutivo>

            <PanelEjecutivo
              titulo="Pedidos por resolucion"
              descripcion="Estado operativo de los pedidos visibles."
              icono={ClipboardList}
            >
              <GraficoPedidosEstado datos={pedidosPorEstado} />
            </PanelEjecutivo>

            <PanelRiesgoStock
              cargando={cargando}
              descripcion="Materiales que conviene reponer primero."
              materiales={materialesEnRiesgo}
              titulo="Riesgo de stock"
            />
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_0.7fr]">
            <PanelCola
              cargando={cargando}
              descripcion="Los primeros pedidos son los que requieren accion mas rapida."
              pedidos={colaPriorizada}
              reglas={reglas}
              titulo="Cola priorizada"
              vacio="No hay pedidos registrados con los filtros actuales."
            />

            <PanelAlertas
              alertas={alertasActivas}
              cargando={cargando}
              descripcion="Eventos activos que requieren revision."
              titulo="Alertas recientes"
            />
          </section>

          <SiguienteAccion
            nivel={nivelSiguiente}
            pedido={siguientePedido}
            puntaje={puntajeSiguiente}
          />
        </>
      )}

      {rol === 'bodega' && (
        <VistaBodega
          alertasActivas={alertasActivas}
          cargando={cargando}
          colaOperativa={colaOperativa}
          distribucionPrioridad={distribucionPrioridad}
          materialesEnRiesgo={materialesEnRiesgo}
          reglas={reglas}
        />
      )}

      {rol === 'suministrador' && (
        <VistaSuministrador
          alertasActivas={alertasActivas}
          cargando={cargando}
          materialesEnRiesgo={materialesEnRiesgo}
          pedidosAbastecimiento={pedidosAbastecimiento}
          reglas={reglas}
        />
      )}
    </div>
  )
}

function VistaBodega({
  alertasActivas,
  cargando,
  colaOperativa,
  distribucionPrioridad,
  materialesEnRiesgo,
  reglas,
}: {
  alertasActivas: Alerta[]
  cargando: boolean
  colaOperativa: Pedido[]
  distribucionPrioridad: Array<{ nombre: string; valor: number; clase: string }>
  materialesEnRiesgo: InventarioOperativo[]
  reglas: ReglaNegocio[]
}) {
  const siguientePedido = colaOperativa[0]
  const puntajeSiguiente = siguientePedido ? calcularPrioridad(siguientePedido, reglas) : 0
  const nivelSiguiente = resolverNivelPrioridad(puntajeSiguiente, siguientePedido)

  return (
    <>
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <SiguienteAccion
          nivel={nivelSiguiente}
          pedido={siguientePedido}
          puntaje={puntajeSiguiente}
        />

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 p-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Presion de despacho</h2>
              <p className="mt-1 text-sm text-slate-500">
                Pedidos abiertos agrupados por prioridad operativa.
              </p>
            </div>
            <BarChart3 className="text-orange-600" size={22} />
          </div>
          <GraficoPrioridad datos={distribucionPrioridad} />
        </section>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <PanelCola
          cargando={cargando}
          descripcion="Pedidos que bodega debe preparar, aprobar o despachar."
          pedidos={colaOperativa}
          reglas={reglas}
          titulo="Cola operativa de bodega"
          vacio="No hay pedidos abiertos para bodega."
        />

        <div className="space-y-6">
          <PanelRiesgoStock
            cargando={cargando}
            descripcion="Materiales que pueden bloquear el despacho."
            materiales={materialesEnRiesgo}
            titulo="Materiales que pueden frenar pedidos"
          />
          <PanelAlertas
            alertas={alertasActivas}
            cargando={cargando}
            descripcion="Eventos activos que bodega debe revisar."
            titulo="Alertas de operacion"
          />
        </div>
      </section>
    </>
  )
}

function VistaSuministrador({
  alertasActivas,
  cargando,
  materialesEnRiesgo,
  pedidosAbastecimiento,
  reglas,
}: {
  alertasActivas: Alerta[]
  cargando: boolean
  materialesEnRiesgo: InventarioOperativo[]
  pedidosAbastecimiento: Pedido[]
  reglas: ReglaNegocio[]
}) {
  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="space-y-6">
        <PanelRiesgoStock
          cargando={cargando}
          descripcion="Materiales con riesgo de reposicion o quiebre de stock."
          materiales={materialesEnRiesgo}
          titulo="Abastecimiento prioritario"
        />
        <PanelAlertas
          alertas={alertasActivas}
          cargando={cargando}
          descripcion="Alertas que impactan compras, reposicion o coordinacion."
          titulo="Alertas de suministro"
        />
      </div>

      <PanelCola
        cargando={cargando}
        descripcion="Pedidos donde compras o suministro debe dar seguimiento."
        pedidos={pedidosAbastecimiento}
        reglas={reglas}
        titulo="Pedidos con impacto de abastecimiento"
        vacio="No hay pedidos pendientes de abastecimiento."
      />
    </section>
  )
}

function PanelEjecutivo({
  children,
  descripcion,
  icono: Icono,
  titulo,
}: {
  children: ReactNode
  descripcion: string
  icono: typeof BarChart3
  titulo: string
}) {
  return (
    <section className="rounded-lg border border-[#d8d2df] bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-[#efe5e3] p-4">
        <div>
          <h2 className="text-base font-black text-[#0f0f11]">{titulo}</h2>
          <p className="mt-1 text-xs leading-5 text-[#5f5964]">{descripcion}</p>
        </div>
        <Icono className="text-[#c8102e]" size={20} />
      </div>
      {children}
    </section>
  )
}

function GraficoDonutPrioridad({
  datos,
}: {
  datos: Array<{ nombre: string; valor: number; clase: string }>
}) {
  const total = datos.reduce((suma, item) => suma + item.valor, 0)
  const gradiente = construirGradienteDonut(
    datos.map((item) => ({
      color: colorHexPrioridad(item.nombre),
      valor: item.valor,
    }))
  )

  return (
    <div className="p-5">
      <div className="mx-auto grid h-44 w-44 place-items-center rounded-full" style={{ background: gradiente }}>
        <div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center">
          <strong className="font-tabular block text-2xl text-[#0f0f11]">{total}</strong>
          <span className="text-xs font-semibold text-[#5f5964]">Pedidos</span>
        </div>
      </div>
      <div className="mt-5 space-y-2">
        {datos.map((item) => (
          <div key={item.nombre} className="grid grid-cols-[1rem_1fr_auto] items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorHexPrioridad(item.nombre) }} />
            <span className="font-semibold text-[#5f5964]">{item.nombre}</span>
            <span className="font-tabular font-bold text-[#0f0f11]">
              {total === 0 ? '0%' : `${Math.round((item.valor / total) * 100)}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function GraficoTopMateriales({
  datos,
}: {
  datos: Array<{ nombre: string; valor: number }>
}) {
  const maximo = Math.max(...datos.map((item) => item.valor), 1)

  return (
    <div className="space-y-4 p-5">
      {datos.map((item, index) => (
        <div key={item.nombre} className="grid grid-cols-[1fr_auto] gap-3 text-xs">
          <span className="truncate font-semibold text-[#2f2f33]">
            {index + 1}. {item.nombre}
          </span>
          <span className="font-tabular font-bold text-[#0f0f11]">{formatearNumero(item.valor)}</span>
          <div className="col-span-2 h-2 rounded-full bg-[#eee9e7]">
            <div
              className="h-2 rounded-full bg-[#c8102e]"
              style={{ width: `${Math.max(6, (item.valor / maximo) * 100)}%` }}
            />
          </div>
        </div>
      ))}

      {datos.length === 0 && (
        <p className="py-8 text-center text-sm text-[#5f5964]">Sin pedidos en el periodo.</p>
      )}
    </div>
  )
}

function GraficoInventarioCategoria({
  datos,
}: {
  datos: Array<{ nombre: string; valor: number }>
}) {
  const maximo = Math.max(...datos.map((item) => item.valor), 1)

  return (
    <div className="space-y-4 p-5">
      {datos.map((item) => (
        <div key={item.nombre} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-xs">
          <span className="truncate font-semibold text-[#5f5964]">{item.nombre}</span>
          <div className="h-3 rounded-full bg-[#eee9e7]">
            <div
              className="h-3 rounded-full bg-[#1a1b22]"
              style={{ width: `${Math.max(5, (item.valor / maximo) * 100)}%` }}
            />
          </div>
          <span className="font-tabular font-bold text-[#0f0f11]">{formatearNumero(item.valor)}</span>
        </div>
      ))}

      {datos.length === 0 && (
        <p className="py-8 text-center text-sm text-[#5f5964]">Sin materiales con los filtros actuales.</p>
      )}
    </div>
  )
}

function GraficoPedidosEstado({
  datos,
}: {
  datos: Array<{ nombre: string; valor: number }>
}) {
  const total = datos.reduce((suma, item) => suma + item.valor, 0)
  const gradiente = construirGradienteDonut(
    datos.map((item) => ({
      color: colorHexEstado(item.nombre),
      valor: item.valor,
    }))
  )

  return (
    <div className="grid gap-5 p-5 sm:grid-cols-[9rem_1fr] sm:items-center">
      <div className="mx-auto grid h-36 w-36 place-items-center rounded-full" style={{ background: gradiente }}>
        <div className="grid h-24 w-24 place-items-center rounded-full bg-white text-center">
          <strong className="font-tabular block text-2xl text-[#0f0f11]">{total}</strong>
          <span className="text-xs font-semibold text-[#5f5964]">Total</span>
        </div>
      </div>
      <div className="space-y-2">
        {datos.map((item) => (
          <div key={item.nombre} className="grid grid-cols-[1rem_1fr_auto] items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorHexEstado(item.nombre) }} />
            <span className="font-semibold text-[#5f5964]">{item.nombre}</span>
            <span className="font-tabular font-bold text-[#0f0f11]">
              {total === 0 ? '0%' : `${Math.round((item.valor / total) * 100)}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PanelCola({
  cargando,
  descripcion,
  pedidos,
  reglas,
  titulo,
  vacio,
}: {
  cargando: boolean
  descripcion: string
  pedidos: Pedido[]
  reglas: ReglaNegocio[]
  titulo: string
  vacio: string
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{titulo}</h2>
          <p className="mt-1 text-sm text-slate-500">{descripcion}</p>
        </div>
        <Truck className="text-orange-600" size={22} />
      </div>

      <div className="divide-y divide-slate-100">
        {pedidos.slice(0, 6).map((pedido) => {
          const puntaje = calcularPrioridad(pedido, reglas)
          const nivel = resolverNivelPrioridad(puntaje, pedido)
          const semaforo = resolverSemaforoPedido({
            ...pedido,
            prioridad_calculada: puntaje,
          })

          return (
            <div key={pedido.id} className="grid gap-3 p-5 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-900">{pedido.codigo}</p>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${colorPrioridad(nivel)}`}>
                    Prioridad {puntaje}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${claseSemaforoBadge(semaforo)}`}>
                    {etiquetaSemaforoCola(semaforo)}
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    Resolucion: {formatearEstado(pedido.estado)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {pedido.material} - {cantidadParaDespacho(pedido)} {pedido.unidad_medida}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Stock {pedido.stock_disponible} - {pedido.solicitante}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-600">
                  {describirTiempoPedido(pedido)}
                </p>
              </div>
              <div className="min-w-36">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Timer size={16} className="text-slate-400" />
                  Compromiso {formatearFecha(pedido.fecha_compromiso)}
                </div>
                <div className="mt-3 h-2 rounded-full bg-slate-200">
                  <div
                    className={`h-2 rounded-full ${claseSemaforoBarra(semaforo)}`}
                    style={{ width: `${porcentajeSemaforo(semaforo)}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })}

        {!cargando && pedidos.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-500">{vacio}</p>
        )}
      </div>
    </section>
  )
}

function PanelRiesgoStock({
  cargando,
  descripcion,
  materiales,
  titulo,
}: {
  cargando: boolean
  descripcion: string
  materiales: InventarioOperativo[]
  titulo: string
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5">
        <h2 className="text-lg font-semibold text-slate-900">{titulo}</h2>
        <p className="mt-1 text-sm text-slate-500">{descripcion}</p>
      </div>

      <div className="divide-y divide-slate-100">
        {materiales.map((material) => {
          const stockDisponible = stockDisponibleMaterial(material)
          const porcentaje = Math.min(
            Math.round((stockDisponible / Math.max(material.stock_objetivo_material, material.stock_minimo, 1)) * 100),
            100
          )

          return (
            <div key={material.id} className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-800">{material.nombre}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Minimo {material.stock_minimo} {material.unidad_medida}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    stockDisponible <= 0
                      ? claseSemaforoBadge('critico')
                      : claseSemaforoBadge('riesgo')
                  }`}
                >
                  {formatearNumero(stockDisponible)}
                </span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-slate-200">
                <div
                  className={`h-2 rounded-full ${
                    stockDisponible <= 0
                      ? claseSemaforoBarra('critico')
                      : claseSemaforoBarra('riesgo')
                  }`}
                  style={{ width: `${porcentaje}%` }}
                />
              </div>
            </div>
          )
        })}

        {!cargando && materiales.length === 0 && (
          <div className="flex items-center gap-3 p-5 text-sm text-green-700">
            <CheckCircle2 size={18} />
            Inventario sin materiales bajo minimo.
          </div>
        )}
      </div>
    </section>
  )
}

function PanelAlertas({
  alertas,
  cargando,
  descripcion,
  titulo,
}: {
  alertas: Alerta[]
  cargando: boolean
  descripcion: string
  titulo: string
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5">
        <h2 className="text-lg font-semibold text-slate-900">{titulo}</h2>
        <p className="mt-1 text-sm text-slate-500">{descripcion}</p>
      </div>

      <div className="divide-y divide-slate-100">
        {alertas.slice(0, 4).map((alerta) => (
          <div key={alerta.id} className="p-5">
            <div className="flex items-start gap-3">
              <Bell size={18} className="mt-0.5 text-orange-600" />
              <div>
                <p className="font-semibold text-slate-800">{alerta.tipo_alerta}</p>
                <p className="mt-1 text-sm leading-5 text-slate-600">{alerta.mensaje}</p>
              </div>
            </div>
          </div>
        ))}

        {!cargando && alertas.length === 0 && (
          <p className="p-5 text-sm text-slate-500">No hay alertas activas.</p>
        )}
      </div>
    </section>
  )
}

function SiguienteAccion({
  nivel,
  pedido,
  puntaje,
}: {
  nivel: string
  pedido?: Pedido
  puntaje: number
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-slate-700">Siguiente accion recomendada</p>
      {pedido ? (
        <div className="mt-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xl font-bold text-slate-950">{pedido.codigo}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Preparar {pedido.cantidad} {pedido.unidad_medida} de {pedido.material}
                {' '}para {pedido.solicitante}.
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${colorPrioridad(nivel)}`}>
              {nivel}
            </span>
          </div>
          <div className="mt-5 h-3 rounded-full bg-slate-200">
            <div className={`h-3 rounded-full ${colorBarra(nivel)}`} style={{ width: `${puntaje}%` }} />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Prioridad calculada con urgencia, stock, fecha y tipo de solicitante.
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">No hay pedidos pendientes por atender.</p>
      )}
    </section>
  )
}

function GraficoPrioridad({
  datos,
}: {
  datos: Array<{ nombre: string; valor: number; clase: string }>
}) {
  const total = datos.reduce((suma, item) => suma + item.valor, 0)
  const maximo = Math.max(...datos.map((item) => item.valor), 1)

  return (
    <div className="p-5">
      <div className="flex h-44 items-end gap-4 rounded-lg bg-slate-50 px-4 py-5">
        {datos.map((item) => {
          const alto = total === 0 ? 8 : Math.max(14, (item.valor / maximo) * 100)

          return (
            <div key={item.nombre} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div className="flex h-28 w-full items-end justify-center">
                <div
                  className={`w-full max-w-14 rounded-t-md ${item.clase}`}
                  style={{ height: `${alto}%` }}
                />
              </div>
              <strong className="text-sm text-slate-900">{item.valor}</strong>
              <span className="text-xs font-medium text-slate-500">{item.nombre}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-4 space-y-3">
        {datos.map((item) => (
          <div key={item.nombre} className="grid grid-cols-[4rem_1fr_2rem] items-center gap-3 text-sm">
            <span className="font-medium text-slate-600">{item.nombre}</span>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${item.clase}`}
                style={{ width: `${total === 0 ? 0 : (item.valor / total) * 100}%` }}
              />
            </div>
            <span className="text-right font-semibold text-slate-800">{item.valor}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TarjetaOtif({
  cargando,
  indicador,
  titulo,
}: {
  cargando: boolean
  indicador: { valor: number; cumplidos: number; total: number; detalle: string }
  titulo: string
}) {
  const tono =
    indicador.valor >= 75
      ? 'border-l-green-500'
      : indicador.valor >= 45
        ? 'border-l-yellow-500'
        : 'border-l-red-600'

  return (
    <div className={`border border-[#d8d2df] border-l-4 ${tono} bg-white p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#2f2f33]">
            {titulo}
          </p>
          <p className="mt-2 text-xs text-[#5f5964]">{indicador.detalle}</p>
        </div>
        <span className={`rounded px-2.5 py-1 text-xs font-semibold ${colorOtif(indicador.valor)}`}>
          {etiquetaOtif(indicador.valor)}
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <strong className="font-tabular text-4xl font-bold text-[#0f0f11]">
          {cargando ? '-' : `${indicador.valor}%`}
        </strong>
        <span className="text-xs font-semibold text-[#5f5964]">
          {indicador.cumplidos}/{indicador.total}
        </span>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-[#e8e7f1]">
        <div
          className="h-1.5 rounded-full bg-[#a33e00] transition-all duration-300"
          style={{ width: `${indicador.valor}%` }}
        />
      </div>
    </div>
  )
}

function obtenerConfiguracionRol(rol: RolUsuario) {
  if (rol === 'administrador') {
    return {
      accionPrincipal: { ruta: '/reportes', texto: 'Ver reportes' },
      accionSecundaria: { ruta: '/estado-sistema', texto: 'Revisar sistema' },
      descripcion:
        'Vista general de la operacion: pedidos, inventario, alertas, cumplimiento OTIF y espera operativa.',
      etiqueta: 'Vista administrador',
      indicador: 'OTIF operativo',
      indicadorDetalle:
        'Mide compra de suministrador a bodega y venta de bodega a franquiciado segun las hojas cargadas.',
      titulo: 'Panel ejecutivo',
    }
  }

  if (rol === 'bodega') {
    return {
      accionPrincipal: { ruta: '/pedidos', texto: 'Gestionar despacho' },
      accionSecundaria: { ruta: '/inventario', texto: 'Revisar inventario' },
      descripcion:
        'Vista operativa para preparar despachos, detectar quiebres de stock y atender alertas de bodega.',
      etiqueta: 'Vista bodega',
      indicador: 'OTIF de despacho',
      indicadorDetalle:
        'Compara compras pendientes hacia bodega con ventas y entregas Bodega-FQ.',
      titulo: 'Dashboard operativo',
    }
  }

  return {
    accionPrincipal: { ruta: '/materiales', texto: 'Revisar materiales' },
    accionSecundaria: { ruta: '/pedidos', texto: 'Ver pedidos' },
    descripcion:
      'Vista enfocada en abastecimiento: materiales sensibles, pedidos con falta de stock y alertas de suministro.',
    etiqueta: 'Vista suministrador',
    indicador: 'OTIF de suministro',
    indicadorDetalle:
      'Controla las compras pendientes desde suministrador y su impacto sobre ventas Bodega-FQ.',
    titulo: 'Panel de suministro',
  }
}

function crearTarjetasPorRol(
  rol: RolUsuario,
  metricas: DashboardMetricas,
  materialesEnRiesgo: number,
  alertasActivas: number
): TarjetaDashboard[] {
  if (rol === 'bodega') {
    return [
      {
        titulo: 'Por despachar',
        valor: metricas.porDespachar,
        detalle: 'Pedidos abiertos con cantidad pendiente',
        icono: Truck,
        tono: 'blue',
      },
      {
        titulo: 'Sin stock',
        valor: metricas.sinStock,
        detalle: 'Pedidos que pueden bloquearse',
        icono: PackageX,
        tono: 'red',
      },
      {
        titulo: 'En despacho',
        valor: metricas.enDespacho,
        detalle: 'Pedidos en movimiento operativo',
        icono: Warehouse,
        tono: 'green',
      },
      {
        titulo: 'Alertas bodega',
        valor: alertasActivas,
        detalle: 'Eventos activos por revisar',
        icono: Bell,
        tono: 'amber',
      },
    ]
  }

  if (rol === 'suministrador') {
    return [
      {
        titulo: 'Stock bajo',
        valor: materialesEnRiesgo,
        detalle: 'Materiales bajo el minimo',
        icono: PackageX,
        tono: 'red',
      },
      {
        titulo: 'Pedidos sin stock',
        valor: metricas.sinStock,
        detalle: 'Requieren coordinacion de suministro',
        icono: AlertTriangle,
        tono: 'amber',
      },
      {
        titulo: 'NC o espera',
        valor: metricas.ncOEspera,
        detalle: 'Impacto directo del solicitante',
        icono: Timer,
        tono: 'blue',
      },
      {
        titulo: 'Alertas activas',
        valor: alertasActivas,
        detalle: 'Seguimiento de abastecimiento',
        icono: Bell,
        tono: 'green',
      },
    ]
  }

  return [
    {
      titulo: 'Pedidos pendientes',
      valor: metricas.totalPedidos,
      detalle:
        metricas.totalPedidos === 0
          ? 'No hay pedidos pendientes'
          : 'Pedidos esperando seguimiento',
      icono: ClipboardList,
      tono: 'blue',
    },
    {
      titulo: 'Atencion inmediata',
      valor: metricas.pedidosCriticos,
      detalle:
        metricas.pedidosCriticos > 0
          ? 'Pedidos criticos sin despachar'
          : 'Sin pedidos criticos',
      icono: AlertTriangle,
      tono: 'red',
    },
    {
      titulo: 'Inventario sensible',
      valor: materialesEnRiesgo,
      detalle:
        materialesEnRiesgo > 0
          ? 'Materiales bajo el minimo'
          : 'Inventario estable',
      icono: Boxes,
      tono: 'amber',
    },
    {
      titulo: 'Alertas activas',
      valor: alertasActivas,
      detalle:
        alertasActivas > 0
          ? 'Eventos pendientes'
          : 'Sin alertas activas',
      icono: Bell,
      tono: 'green',
    },
  ]
}

function colorBarra(nivel: string) {
  return clasePrioridadBarra(nivel)
}

function colorIcono(tono: string) {
  const colores = {
    amber: 'bg-[#fff3bf] text-[#5f4200]',
    blue: 'bg-[#111112] text-white',
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-600 text-white',
  }

  return colores[tono as keyof typeof colores]
}

function bordeKpi(tono: string) {
  const colores = {
    amber: 'border-l-4 border-l-[#ffd200]',
    blue: 'border-l-4 border-l-[#111112]',
    green: 'border-l-4 border-l-green-600',
    red: 'border-l-4 border-l-[#c8102e]',
  }

  return colores[tono as keyof typeof colores] || colores.blue
}

function colorPrioridad(nivel: string) {
  return clasePrioridadBadge(nivel)
}

function colorOtif(valor: number) {
  if (valor >= 75) return 'bg-green-100 text-green-700'
  if (valor >= 45) return 'bg-yellow-100 text-yellow-800'
  return 'bg-red-600 text-white'
}

function etiquetaOtif(valor: number) {
  if (valor >= 75) return 'En plazo'
  if (valor >= 45) return 'Atencion'
  return 'Fuera de plazo'
}

function categoriaMaterial(material: InventarioOperativo) {
  return material.catman_categoria || material.categoria || 'Sin categoria'
}

function construirTopMaterialesPorDemanda(pedidos: Pedido[]) {
  const mapa = new Map<string, number>()

  pedidos.forEach((pedido) => {
    const nombre = pedido.material || 'Sin material'
    mapa.set(nombre, (mapa.get(nombre) || 0) + cantidadParaDespacho(pedido))
  })

  return [...mapa.entries()]
    .map(([nombre, valor]) => ({ nombre, valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 5)
}

function construirInventarioPorCategoria(materiales: InventarioOperativo[]) {
  const mapa = new Map<string, number>()

  materiales.forEach((material) => {
    const categoria = categoriaMaterial(material)
    mapa.set(categoria, (mapa.get(categoria) || 0) + stockDisponibleMaterial(material))
  })

  return [...mapa.entries()]
    .map(([nombre, valor]) => ({ nombre, valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 5)
}

function construirPedidosPorEstado(pedidos: Pedido[]) {
  const mapa = new Map<string, number>()

  pedidos.forEach((pedido) => {
    const estado = formatearEstado(pedido.estado)
    mapa.set(estado, (mapa.get(estado) || 0) + 1)
  })

  return [...mapa.entries()]
    .map(([nombre, valor]) => ({ nombre, valor }))
    .sort((a, b) => b.valor - a.valor)
}

function construirGradienteDonut(datos: Array<{ color: string; valor: number }>) {
  const total = datos.reduce((suma, item) => suma + item.valor, 0)

  if (total === 0) return 'conic-gradient(#eee9e7 0deg 360deg)'

  let acumulado = 0
  const segmentos = datos.map((item) => {
    const inicio = acumulado
    const grados = (item.valor / total) * 360
    acumulado += grados
    return `${item.color} ${inicio}deg ${acumulado}deg`
  })

  return `conic-gradient(${segmentos.join(', ')})`
}

function colorHexPrioridad(nombre: string) {
  if (nombre === 'Critica') return '#c8102e'
  if (nombre === 'Alta') return '#ffd200'
  if (nombre === 'Media') return '#f5b000'
  return '#118744'
}

function colorHexEstado(nombre: string) {
  const texto = normalizarTexto(nombre)

  if (texto.includes('entregado') || texto.includes('cerrado')) return '#118744'
  if (texto.includes('despacho') || texto.includes('revision') || texto.includes('aprobado')) return '#ffd200'
  if (texto.includes('cancelado') || texto.includes('rechazado') || texto.includes('stock')) return '#c8102e'
  if (texto.includes('retrasado')) return '#c8102e'
  return '#1a1b22'
}

function formatearEstado(estado: string) {
  const limpio = estado.replace(/_/g, ' ')
  return limpio.charAt(0).toUpperCase() + limpio.slice(1)
}

function cantidadParaDespacho(pedido: Pedido) {
  return pedido.cantidad_despacho && pedido.cantidad_despacho > 0
    ? pedido.cantidad_despacho
    : pedido.cantidad
}

function pedidoCerrado(pedido: Pedido) {
  return ['entregado', 'cancelado', 'rechazado'].includes(pedido.estado)
}

function pedidoPendienteDespacho(pedido: Pedido) {
  return !pedidoCerrado(pedido) && pedido.estado !== 'en_despacho'
}

function formatearFecha(fecha: string) {
  const valor = fechaLocal(fecha)
  if (!valor) return 'Sin fecha'

  return valor.toLocaleDateString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function fechaLocal(fecha: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha)
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  }

  const valor = new Date(fecha)
  if (Number.isNaN(valor.getTime())) return null
  return valor
}

function etiquetaSemaforoCola(semaforo: SemaforoOperativo) {
  if (semaforo === 'critico') return 'Retraso critico'
  if (semaforo === 'riesgo') return 'Con retraso'
  if (semaforo === 'a_tiempo') return 'En tiempo'
  return 'Cerrado'
}

function porcentajeSemaforo(semaforo: SemaforoOperativo) {
  if (semaforo === 'critico') return 100
  if (semaforo === 'riesgo') return 65
  if (semaforo === 'a_tiempo') return 35
  return 100
}

function normalizarTexto(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function stockDisponibleMaterial(material: InventarioOperativo) {
  return material.stock_disponible_operativo
}

function ratioStock(material: InventarioOperativo) {
  return stockDisponibleMaterial(material) / Math.max(material.stock_minimo, 1)
}

function formatearNumero(valor: number) {
  return new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 }).format(valor)
}

function otifInicial(): OtifOperativo {
  return {
    suministradorBodega: {
      valor: 0,
      cumplidos: 0,
      total: 0,
      detalle: 'OC en espera dentro de 30 dias',
    },
    bodegaFranquiciado: {
      valor: 0,
      cumplidos: 0,
      total: 0,
      detalle: 'Casos Bodega-FQ dentro del SLA',
    },
  }
}
