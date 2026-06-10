import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Clock3, TimerReset } from 'lucide-react'
import {
  claseSemaforoBadge,
  describirTiempoPedido,
  etiquetaSemaforo,
  resolverSemaforoPedido,
  type SemaforoOperativo,
} from '../lib/semaforoOperativo'
import { obtenerPedidos } from '../services/pedidosService'
import type { Pedido } from '../types/pedido'

export default function Calendario() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

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

    cargarPedidos()
  }, [])

  const grupos = useMemo(() => {
    const hoy = inicioDia(new Date()).getTime()
    const pedidosOrdenados = ordenarPedidosCalendario(pedidos)

    return [
      {
        titulo: 'Vencidos',
        descripcion: 'Requieren decision inmediata.',
        icono: TimerReset,
        tono: 'text-red-600',
        pedidos: pedidosOrdenados.filter((pedido) => fechaCalendarioDia(pedido) < hoy),
      },
      {
        titulo: 'Hoy',
        descripcion: 'Deben resolverse durante la jornada.',
        icono: Clock3,
        tono: 'text-yellow-600',
        pedidos: pedidosOrdenados.filter((pedido) => fechaCalendarioDia(pedido) === hoy),
      },
      {
        titulo: 'Proximos',
        descripcion: 'Pedidos programados para los siguientes dias.',
        icono: CalendarDays,
        tono: 'text-green-600',
        pedidos: pedidosOrdenados.filter((pedido) => fechaCalendarioDia(pedido) > hoy),
      },
    ]
  }, [pedidos])

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Calendario operativo</h1>
        <p className="mt-1 text-slate-500">
          Fechas requeridas, pedidos vencidos y compromisos proximos.
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        {grupos.map((grupo) => {
          const Icono = grupo.icono

          return (
            <section key={grupo.titulo} className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-800">{grupo.titulo}</h2>
                    <p className="mt-1 text-sm text-slate-500">{grupo.descripcion}</p>
                  </div>
                  <Icono className={grupo.tono} size={24} />
                </div>
                <strong className="mt-4 block text-3xl text-slate-900">
                  {cargando ? '-' : grupo.pedidos.length}
                </strong>
              </div>

              <div className="divide-y divide-slate-100">
                {grupo.pedidos.map((pedido) => {
                  const semaforo = resolverSemaforoPedido(pedido)

                  return (
                  <article key={pedido.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-800">{pedido.codigo}</p>
                        <p className="text-sm text-slate-600">{pedido.material}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${claseSemaforoBadge(semaforo)}`}>
                        {etiquetaSemaforo(semaforo)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                      {pedido.solicitante} - Despacho {formatearFechaCalendario(pedido)} - {pedido.estado.replace('_', ' ')}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-600">
                      {describirTiempoPedido(pedido)}
                    </p>
                  </article>
                  )
                })}

                {!cargando && grupo.pedidos.length === 0 && (
                  <p className="p-6 text-center text-sm text-slate-500">
                    Sin pedidos en este grupo.
                  </p>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function inicioDia(fecha: Date) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate())
}

function ordenarPedidosCalendario(pedidos: Pedido[]) {
  return [...pedidos].sort((a, b) => {
    const salidaA = pedidoSinSalida(a) ? 0 : 1
    const salidaB = pedidoSinSalida(b) ? 0 : 1

    if (salidaA !== salidaB) return salidaA - salidaB

    const criticidadA = prioridadSemaforo(resolverSemaforoPedido(a))
    const criticidadB = prioridadSemaforo(resolverSemaforoPedido(b))

    if (criticidadA !== criticidadB) return criticidadA - criticidadB

    return fechaCalendarioDia(a) - fechaCalendarioDia(b)
  })
}

function pedidoSinSalida(pedido: Pedido) {
  return !['en_despacho', 'entregado', 'cancelado', 'rechazado'].includes(pedido.estado)
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
  return Number.isNaN(date.getTime()) ? new Date(8640000000000000) : date
}

function formatearFechaCalendario(pedido: Pedido) {
  const fecha = fechaCalendarioPedido(pedido)
  if (Number.isNaN(fecha.getTime())) return 'sin fecha'
  return fecha.toLocaleDateString()
}
