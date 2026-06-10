import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { BellRing, CheckCircle2, ShieldAlert, X } from 'lucide-react'
import {
  actualizarEstadoAlerta,
  escucharAlertas,
  obtenerAlertas,
} from '../services/alertasService'
import {
  agregarAlertaNoRevisada,
  escucharAlertasNoRevisadas,
  limpiarAlertasNoRevisadas,
  obtenerAlertasNoRevisadas,
} from '../lib/alertNotifications'
import type { Alerta } from '../types/alerta'

export default function RealtimeAlertToast() {
  const [alerta, setAlerta] = useState<Alerta | null>(null)
  const [cola, setCola] = useState<Alerta[]>([])
  const [alertasCentro, setAlertasCentro] = useState<Alerta[]>([])
  const [idsNoRevisados, setIdsNoRevisados] = useState<string[]>(obtenerAlertasNoRevisadas)
  const [visible, setVisible] = useState(false)
  const [centroAbierto, setCentroAbierto] = useState(false)
  const [cargandoCentro, setCargandoCentro] = useState(false)

  useEffect(() => {
    const dejarDeEscuchar = escucharAlertas((nuevaAlerta) => {
      setCola((actual) => agregarAlerta(actual, nuevaAlerta))
      setAlertasCentro((actual) => agregarAlerta(actual, nuevaAlerta))
      agregarAlertaNoRevisada(nuevaAlerta.id)
      setIdsNoRevisados(obtenerAlertasNoRevisadas())
    })

    return dejarDeEscuchar
  }, [])

  useEffect(() => escucharAlertasNoRevisadas(setIdsNoRevisados), [])

  useEffect(() => {
    if (visible || cola.length === 0) return

    const mostrarTimeout = window.setTimeout(() => {
      const [siguiente, ...resto] = cola
      setAlerta(siguiente)
      setCola(resto)
      setVisible(true)
    }, 0)

    const cerrarTimeout = window.setTimeout(() => {
      setVisible(false)
    }, 6000)

    return () => {
      window.clearTimeout(mostrarTimeout)
      window.clearTimeout(cerrarTimeout)
    }
  }, [cola, visible])

  const alertasPendientes = useMemo(
    () => alertasCentro.filter((item) => item.estado !== 'cerrada').slice(0, 8),
    [alertasCentro]
  )

  async function abrirCentro() {
    const vaAbrir = !centroAbierto
    setCentroAbierto(vaAbrir)

    if (!vaAbrir) return

    limpiarAlertasNoRevisadas()
    setIdsNoRevisados([])

    setCargandoCentro(true)
    const { data } = await obtenerAlertas()
    setAlertasCentro(
      (data || [])
        .filter((item) => item.estado !== 'cerrada' && item.nivel !== 'informativa')
        .slice(0, 8)
    )
    setCargandoCentro(false)
  }

  async function cerrarAlerta(alertaId: string) {
    const resultado = await actualizarEstadoAlerta(alertaId, 'cerrada')
    if (resultado.error) return

    setAlertasCentro((actual) => actual.filter((item) => item.id !== alertaId))
    if (alerta?.id === alertaId) setVisible(false)
  }

  const estilos =
    alerta?.nivel === 'critica'
      ? 'border-red-700 bg-red-600 text-white'
      : alerta?.nivel === 'alta' || alerta?.nivel === 'media'
        ? 'border-yellow-300 bg-yellow-400 text-slate-950'
        : 'border-green-200 bg-green-600 text-white'

  return (
    <>
      {alerta && visible && (
        <div
          className={`fixed right-4 top-4 z-50 w-[calc(100vw-2rem)] max-w-md rounded-lg border p-5 shadow-xl ${estilos}`}
        >
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-white/20 p-2">
              {alerta.nivel === 'critica' ? <ShieldAlert size={24} /> : <BellRing size={24} />}
            </span>

            <div className="flex-1">
              <h3 className="text-lg font-bold">{formatearEtiqueta(alerta.tipo_alerta)}</h3>
              <p className="mt-1 text-sm leading-5 opacity-95">{alerta.mensaje}</p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">
                  Nivel: {alerta.nivel}
                </span>
                <Link
                  to="/alertas"
                  onClick={() => {
                    setVisible(false)
                    limpiarAlertasNoRevisadas()
                    setIdsNoRevisados([])
                  }}
                  className="inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-semibold transition hover:bg-white/30"
                >
                  Ver alertas
                </Link>
              </div>
            </div>

            <button
              onClick={() => setVisible(false)}
              className="rounded-md p-1 transition hover:bg-white/20"
              aria-label="Cerrar aviso"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      )}

      {centroAbierto && (
        <section className="alert-center-panel fixed right-4 top-20 z-50 w-[calc(100vw-2rem)] max-w-md rounded-xl border border-[#ecd7ce] bg-white p-4 text-[#1a1b22] shadow-2xl">
          <div className="alert-center-header flex items-start justify-between gap-3 border-b border-[#ecd7ce] pb-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#ff7a1a]">
                Centro de alertas
              </p>
              <h3 className="mt-1 text-lg font-bold">Alertas recientes</h3>
            </div>
            <button
              type="button"
              onClick={() => setCentroAbierto(false)}
              className="alert-center-close rounded-lg p-2 text-[#6d5d57] transition hover:bg-[#fff1eb] hover:text-[#a33e00]"
              aria-label="Cerrar centro de alertas"
            >
              <X size={18} />
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto py-2">
            {cargandoCentro && (
              <p className="alert-center-muted px-1 py-6 text-sm text-[#6d5d57]">Cargando alertas...</p>
            )}

            {!cargandoCentro && alertasPendientes.length === 0 && (
              <div className="alert-center-muted flex items-center gap-3 px-1 py-6 text-sm text-[#6d5d57]">
                <CheckCircle2 size={20} className="text-green-400" />
                No hay alertas pendientes.
              </div>
            )}

            {alertasPendientes.map((item) => (
              <article
                key={item.id}
                className="alert-center-item my-2 rounded-lg border border-[#f0ded7] bg-[#fff8f5] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${colorNivel(item.nivel)}`} />
                      <p className="font-semibold">{formatearEtiqueta(item.tipo_alerta)}</p>
                      <span className="alert-center-level rounded-full bg-[#f4ebe7] px-2 py-0.5 text-[11px] font-semibold text-[#6d2b12]">
                        {item.nivel}
                      </span>
                    </div>
                    <p className="alert-center-message mt-2 text-sm leading-5 text-[#5f5964]">{item.mensaje}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    to="/alertas"
                    onClick={() => setCentroAbierto(false)}
                    className="rounded-lg border border-[#ff7a1a]/50 px-3 py-1.5 text-xs font-semibold text-[#ff8a33] transition hover:bg-[#ff7a1a]/10"
                  >
                    Ver detalle
                  </Link>
                  <button
                    type="button"
                    onClick={() => cerrarAlerta(item.id)}
                    className="rounded-lg border border-green-400/40 px-3 py-1.5 text-xs font-semibold text-green-300 transition hover:bg-green-400/10"
                  >
                    Cerrar alerta
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={abrirCentro}
        className={`alert-float-button relative flex h-10 w-10 items-center justify-center rounded-full border border-[#ffd6c0] bg-white text-[#a33e00] shadow-sm transition hover:scale-105 hover:bg-[#fff7f2] ${
          idsNoRevisados.length > 0 ? 'animate-pulse ring-4 ring-[#ff7a1a]/20' : ''
        }`}
        aria-label="Abrir alertas"
      >
        <BellRing size={24} />
        {idsNoRevisados.length > 0 && (
          <span className="absolute -right-1 -top-1 min-w-6 rounded-full bg-red-600 px-1.5 py-0.5 text-center text-[11px] font-bold text-white">
            {idsNoRevisados.length}
          </span>
        )}
      </button>
    </>
  )
}

function agregarAlerta(alertas: Alerta[], alerta: Alerta) {
  if (alertas.some((item) => item.id === alerta.id)) return alertas
  return [...alertas, alerta].slice(-5)
}

function formatearEtiqueta(valor: string) {
  return valor.replace(/_/g, ' ')
}

function colorNivel(nivel: Alerta['nivel']) {
  if (nivel === 'critica') return 'bg-red-500'
  if (nivel === 'alta' || nivel === 'media') return 'bg-yellow-400'
  return 'bg-green-400'
}
