import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  PackageCheck,
  TimerReset,
} from 'lucide-react'
import {
  claseSemaforoBadge,
  describirTiempoPedido,
  etiquetaSemaforo,
  resolverSemaforoPedido,
  type SemaforoOperativo,
} from '../lib/semaforoOperativo'
import { escucharPedidos, obtenerPedidos } from '../services/pedidosService'
import type { Pedido } from '../types/pedido'

const DIAS_SEMANA = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']
const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

export default function Calendario() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [mesVisible, setMesVisible] = useState(() => inicioMes(new Date()))
  const [diaSeleccionado, setDiaSeleccionado] = useState(() => inicioDia(new Date()))

  useEffect(() => {
    async function cargarPedidos() {
      const { data, error } = await obtenerPedidos()

      if (error) {
        setError('No se pudo leer pedidos desde Supabase.')
        setCargando(false)
        return
      }

      setPedidos(data || [])
      setCargando(false)
    }

    const timer = window.setTimeout(cargarPedidos, 0)
    const dejarDeEscucharPedidos = escucharPedidos(cargarPedidos)

    return () => {
      window.clearTimeout(timer)
      dejarDeEscucharPedidos()
    }
  }, [])

  const pedidosOrdenados = useMemo(() => ordenarPedidosCalendario(pedidos), [pedidos])
  const pedidosPorDia = useMemo(() => agruparPedidosPorDia(pedidosOrdenados), [pedidosOrdenados])
  const diasCalendario = useMemo(() => construirDiasCalendario(mesVisible), [mesVisible])
  const llaveSeleccionada = llaveDia(diaSeleccionado)
  const pedidosDiaSeleccionado = pedidosPorDia.get(llaveSeleccionada) || []

  const metricasMes = useMemo(() => {
    const inicio = inicioMes(mesVisible).getTime()
    const fin = finMes(mesVisible).getTime()
    const hoy = inicioDia(new Date()).getTime()
    const pedidosDelMes = pedidosOrdenados.filter((pedido) => {
      const fecha = fechaCalendarioDia(pedido)
      return fecha >= inicio && fecha <= fin
    })

    return [
      {
        titulo: 'Pedidos del mes',
        valor: pedidosDelMes.length,
        detalle: 'Programados en calendario',
        icono: CalendarDays,
        clase: 'border-[#d8d2df]',
        iconoClase: 'text-[#c8102e]',
      },
      {
        titulo: 'Vencidos',
        valor: pedidosDelMes.filter((pedido) => {
          const semaforo = resolverSemaforoPedido(pedido)
          return semaforo === 'critico' || semaforo === 'riesgo'
        }).length,
        detalle: 'Con retraso operativo',
        icono: TimerReset,
        clase: 'border-red-200',
        iconoClase: 'text-red-600',
      },
      {
        titulo: 'Hoy',
        valor: pedidosDelMes.filter((pedido) => fechaCalendarioDia(pedido) === hoy).length,
        detalle: 'Compromisos del dia',
        icono: Clock3,
        clase: 'border-yellow-200',
        iconoClase: 'text-yellow-600',
      },
      {
        titulo: 'Cerrados',
        valor: pedidosDelMes.filter((pedido) => pedidoCerrado(pedido)).length,
        detalle: 'Entregados o cerrados',
        icono: PackageCheck,
        clase: 'border-green-200',
        iconoClase: 'text-green-600',
      },
    ]
  }, [mesVisible, pedidosOrdenados])

  const aniosDisponibles = useMemo(() => {
    const anioActual = new Date().getFullYear()
    const anios = new Set<number>([
      anioActual - 1,
      anioActual,
      anioActual + 1,
      mesVisible.getFullYear(),
    ])

    pedidos.forEach((pedido) => {
      const fecha = fechaCalendarioPedido(pedido)
      if (!Number.isNaN(fecha.getTime()) && Math.abs(fecha.getFullYear()) < 10000) {
        anios.add(fecha.getFullYear())
      }
    })

    return [...anios].sort((a, b) => a - b)
  }, [mesVisible, pedidos])

  function cambiarMes(delta: number) {
    const nuevoMes = new Date(mesVisible.getFullYear(), mesVisible.getMonth() + delta, 1)
    setMesVisible(nuevoMes)
    setDiaSeleccionado(clampDiaAlMes(diaSeleccionado, nuevoMes))
  }

  function seleccionarMes(mes: number) {
    const nuevoMes = new Date(mesVisible.getFullYear(), mes, 1)
    setMesVisible(nuevoMes)
    setDiaSeleccionado(clampDiaAlMes(diaSeleccionado, nuevoMes))
  }

  function seleccionarAnio(anio: number) {
    const nuevoMes = new Date(anio, mesVisible.getMonth(), 1)
    setMesVisible(nuevoMes)
    setDiaSeleccionado(clampDiaAlMes(diaSeleccionado, nuevoMes))
  }

  function volverAHoy() {
    const hoy = inicioDia(new Date())
    setMesVisible(inicioMes(hoy))
    setDiaSeleccionado(hoy)
  }

  return (
    <div className="calendario-module space-y-5">
      <header className="calendario-header flex flex-col gap-4 border-b border-[#e3d6d0] pb-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c8102e]">
            Vista operativa
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#0f0f11]">
            Calendario operativo
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[#69636d]">
            Pedidos organizados por fecha de despacho, entrega o compromiso.
          </p>
        </div>

        <div className="calendario-toolbar flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => cambiarMes(-1)}
            className="calendario-icon-button inline-flex h-10 w-10 items-center justify-center border border-[#d8d2df] bg-white text-[#2b160f] transition hover:border-[#c8102e] hover:text-[#c8102e]"
            aria-label="Mes anterior"
          >
            <ChevronLeft size={20} />
          </button>

          <label className="sr-only" htmlFor="calendario-mes">
            Mes
          </label>
          <select
            id="calendario-mes"
            value={mesVisible.getMonth()}
            onChange={(event) => seleccionarMes(Number(event.target.value))}
            className="h-10 border border-[#d8d2df] bg-white px-3 text-sm font-semibold text-[#2b160f] outline-none focus:border-[#c8102e]"
          >
            {MESES.map((mes, index) => (
              <option key={mes} value={index}>
                {mes}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="calendario-anio">
            Anio
          </label>
          <select
            id="calendario-anio"
            value={mesVisible.getFullYear()}
            onChange={(event) => seleccionarAnio(Number(event.target.value))}
            className="h-10 border border-[#d8d2df] bg-white px-3 text-sm font-semibold text-[#2b160f] outline-none focus:border-[#c8102e]"
          >
            {aniosDisponibles.map((anio) => (
              <option key={anio} value={anio}>
                {anio}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => cambiarMes(1)}
            className="calendario-icon-button inline-flex h-10 w-10 items-center justify-center border border-[#d8d2df] bg-white text-[#2b160f] transition hover:border-[#c8102e] hover:text-[#c8102e]"
            aria-label="Mes siguiente"
          >
            <ChevronRight size={20} />
          </button>

          <button
            type="button"
            onClick={volverAHoy}
            className="h-10 border border-[#c8102e] bg-[#c8102e] px-4 text-sm font-bold text-white transition hover:bg-[#a30d25]"
          >
            Hoy
          </button>
        </div>
      </header>

      {error && (
        <div className="border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm font-semibold text-yellow-900">
          {error}
        </div>
      )}

      <section className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
        {metricasMes.map((item) => {
          const Icono = item.icono

          return (
            <article
              key={item.titulo}
              className={`calendario-metric border-l-4 bg-white p-4 shadow-sm ${item.clase}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#69636d]">
                    {item.titulo}
                  </p>
                  <strong className="mt-2 block text-3xl font-black text-[#0f0f11]">
                    {cargando ? '-' : item.valor}
                  </strong>
                  <p className="mt-1 text-sm text-[#69636d]">{item.detalle}</p>
                </div>
                <Icono className={item.iconoClase} size={22} />
              </div>
            </article>
          )
        })}
      </section>

      <section className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="calendario-panel overflow-hidden border border-[#d8d2df] bg-white shadow-sm">
          <div className="calendario-month-title flex flex-wrap items-center justify-between gap-3 border-b border-[#e3d6d0] px-4 py-3">
            <div>
              <h2 className="text-lg font-bold text-[#0f0f11]">
                {MESES[mesVisible.getMonth()]} {mesVisible.getFullYear()}
              </h2>
              <p className="text-sm text-[#69636d]">
                {cargando ? 'Cargando pedidos...' : `${pedidosOrdenados.length} pedidos conectados`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-[#69636d]">
              <Leyenda color="bg-red-600" texto="Critico" />
              <Leyenda color="bg-yellow-500" texto="En riesgo" />
              <Leyenda color="bg-green-500" texto="A tiempo" />
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-[#e3d6d0] bg-[#fff4ef]">
            {DIAS_SEMANA.map((dia) => (
              <div
                key={dia}
                className="px-2 py-3 text-center text-xs font-bold uppercase tracking-[0.12em] text-[#6d2b12]"
              >
                {dia}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 bg-[#f8fafc]">
            {diasCalendario.map((dia) => {
              const llave = llaveDia(dia.fecha)
              const pedidosDia = pedidosPorDia.get(llave) || []
              const seleccionado = mismaFecha(dia.fecha, diaSeleccionado)
              const hoy = mismaFecha(dia.fecha, new Date())

              return (
                <button
                  key={llave}
                  type="button"
                  onClick={() => {
                    setDiaSeleccionado(inicioDia(dia.fecha))
                    if (!dia.enMesActual) setMesVisible(inicioMes(dia.fecha))
                  }}
                  className={`calendario-day min-h-36 border-b border-r border-[#e5dde9] bg-white p-2 text-left transition hover:bg-[#fff7f3] focus:outline-none focus:ring-2 focus:ring-[#c8102e] ${
                    dia.enMesActual ? '' : 'calendario-day-muted bg-[#f5f5f6] text-[#9a9197]'
                  } ${seleccionado ? 'calendario-day-selected ring-2 ring-inset ring-[#c8102e]' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`inline-flex h-7 min-w-7 items-center justify-center px-2 text-sm font-bold ${
                        hoy
                          ? 'bg-[#c8102e] text-white'
                          : dia.enMesActual
                            ? 'text-[#0f0f11]'
                            : 'text-[#9a9197]'
                      }`}
                    >
                      {dia.fecha.getDate()}
                    </span>
                    {pedidosDia.length > 0 && (
                      <span className="rounded-full bg-[#f4ebe7] px-2 py-0.5 text-[11px] font-bold text-[#6d2b12]">
                        {pedidosDia.length}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 space-y-1">
                    {pedidosDia.slice(0, 3).map((pedido) => {
                      const semaforo = resolverSemaforoPedido(pedido)

                      return (
                        <div
                          key={pedido.id}
                          className="calendario-event flex min-w-0 items-center gap-2 border border-[#eadbd6] bg-[#fffaf7] px-2 py-1"
                          title={`${pedido.codigo} - ${pedido.material}`}
                        >
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${colorPunto(semaforo)}`} />
                          <span className="truncate text-xs font-semibold text-[#2b160f]">
                            {pedido.codigo}
                          </span>
                        </div>
                      )
                    })}

                    {pedidosDia.length > 3 && (
                      <p className="text-xs font-bold text-[#c8102e]">
                        +{pedidosDia.length - 3} mas
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <aside className="calendario-panel border border-[#d8d2df] bg-white shadow-sm">
          <div className="border-b border-[#e3d6d0] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c8102e]">
              Agenda del dia
            </p>
            <h2 className="mt-1 text-xl font-bold text-[#0f0f11]">
              {formatearDiaLargo(diaSeleccionado)}
            </h2>
            <p className="mt-1 text-sm text-[#69636d]">
              {pedidosDiaSeleccionado.length} pedidos programados.
            </p>
          </div>

          <div className="max-h-[720px] divide-y divide-[#eadbd6] overflow-y-auto">
            {pedidosDiaSeleccionado.map((pedido) => {
              const semaforo = resolverSemaforoPedido(pedido)

              return (
                <article key={pedido.id} className="calendario-agenda-item p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-[#0f0f11]">{pedido.codigo}</p>
                      <p className="mt-1 text-sm font-semibold text-[#2b160f]">{pedido.material}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${claseSemaforoBadge(semaforo)}`}>
                      {etiquetaSemaforo(semaforo)}
                    </span>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <Dato label="Cliente" valor={pedido.solicitante} />
                    <Dato label="Cantidad" valor={`${pedido.cantidad} ${pedido.unidad_medida}`} />
                    <Dato label="Estado" valor={pedido.estado.replace('_', ' ')} />
                    <Dato label="Fecha" valor={formatearHoraFecha(pedido)} />
                  </dl>

                  <p className="mt-3 border-l-4 border-[#c8102e] bg-[#fff4ef] px-3 py-2 text-xs font-bold text-[#6d2b12]">
                    {describirTiempoPedido(pedido)}
                  </p>
                </article>
              )
            })}

            {!cargando && pedidosDiaSeleccionado.length === 0 && (
              <div className="p-6 text-sm text-[#69636d]">
                No hay pedidos programados para este dia.
              </div>
            )}
          </div>
        </aside>
      </section>
    </div>
  )
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {texto}
    </span>
  )
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="bg-[#faf7f5] p-2">
      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#7e7576]">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-[#2b160f]">{valor}</dd>
    </div>
  )
}

function construirDiasCalendario(mes: Date) {
  const inicio = inicioMes(mes)
  const fin = finMes(mes)
  const offsetInicio = (inicio.getDay() + 6) % 7
  const primerDia = new Date(inicio)
  primerDia.setDate(inicio.getDate() - offsetInicio)

  const totalDias = Math.ceil((offsetInicio + fin.getDate()) / 7) * 7

  return Array.from({ length: Math.max(totalDias, 35) }, (_, index) => {
    const fecha = new Date(primerDia)
    fecha.setDate(primerDia.getDate() + index)

    return {
      fecha,
      enMesActual: fecha.getMonth() === mes.getMonth() && fecha.getFullYear() === mes.getFullYear(),
    }
  })
}

function agruparPedidosPorDia(pedidos: Pedido[]) {
  const grupos = new Map<string, Pedido[]>()

  pedidos.forEach((pedido) => {
    const fecha = fechaCalendarioPedido(pedido)
    if (Number.isNaN(fecha.getTime())) return

    const llave = llaveDia(fecha)
    grupos.set(llave, [...(grupos.get(llave) || []), pedido])
  })

  return grupos
}

function ordenarPedidosCalendario(pedidos: Pedido[]) {
  return [...pedidos].sort((a, b) => {
    const criticidadA = prioridadSemaforo(resolverSemaforoPedido(a))
    const criticidadB = prioridadSemaforo(resolverSemaforoPedido(b))

    if (criticidadA !== criticidadB) return criticidadA - criticidadB

    const fechaA = fechaCalendarioDia(a)
    const fechaB = fechaCalendarioDia(b)
    if (fechaA !== fechaB) return fechaA - fechaB

    return a.codigo.localeCompare(b.codigo)
  })
}

function pedidoCerrado(pedido: Pedido) {
  return ['entregado', 'cancelado', 'rechazado'].includes(pedido.estado)
}

function prioridadSemaforo(semaforo: SemaforoOperativo) {
  if (semaforo === 'critico') return 0
  if (semaforo === 'riesgo') return 1
  if (semaforo === 'a_tiempo') return 2
  return 3
}

function fechaCalendarioDia(pedido: Pedido) {
  return inicioDia(fechaCalendarioPedido(pedido)).getTime()
}

function fechaCalendarioPedido(pedido: Pedido) {
  const fecha =
    pedido.estado === 'en_despacho'
      ? pedido.despachado_at || pedido.fecha_compromiso
      : pedido.estado === 'entregado'
        ? pedido.fecha_entrega || pedido.despachado_at || pedido.fecha_compromiso
        : pedido.fecha_compromiso

  const date = new Date(fecha)
  return Number.isNaN(date.getTime()) ? new Date(Number.NaN) : date
}

function inicioDia(fecha: Date) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate())
}

function inicioMes(fecha: Date) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), 1)
}

function finMes(fecha: Date) {
  return new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0)
}

function clampDiaAlMes(diaActual: Date, mes: Date) {
  const ultimoDia = finMes(mes).getDate()
  return new Date(mes.getFullYear(), mes.getMonth(), Math.min(diaActual.getDate(), ultimoDia))
}

function llaveDia(fecha: Date) {
  return [
    fecha.getFullYear(),
    String(fecha.getMonth() + 1).padStart(2, '0'),
    String(fecha.getDate()).padStart(2, '0'),
  ].join('-')
}

function mismaFecha(a: Date, b: Date) {
  return llaveDia(a) === llaveDia(b)
}

function formatearDiaLargo(fecha: Date) {
  return fecha.toLocaleDateString('es-EC', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function formatearHoraFecha(pedido: Pedido) {
  const fecha = fechaCalendarioPedido(pedido)
  if (Number.isNaN(fecha.getTime())) return 'Sin fecha'

  return fecha.toLocaleString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function colorPunto(semaforo: SemaforoOperativo) {
  if (semaforo === 'critico') return 'bg-red-600'
  if (semaforo === 'riesgo') return 'bg-yellow-500'
  if (semaforo === 'a_tiempo') return 'bg-green-500'
  return 'bg-slate-400'
}
