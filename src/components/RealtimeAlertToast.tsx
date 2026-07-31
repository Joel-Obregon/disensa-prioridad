import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { BellRing, CheckCircle2, ShieldAlert, X } from 'lucide-react'
import {
  actualizarEstadoAlerta,
  escucharAlertas,
  obtenerAlertas,
  obtenerAlertasVisualesActivas,
} from '../services/alertasService'
import {
  agregarAlertaNoRevisada,
  escucharAlertasNoRevisadas,
  limpiarAlertasNoRevisadas,
  obtenerAlertasNoRevisadas,
} from '../lib/alertNotifications'
import {
  type OpcionesAlertaVisualLocal,
  escucharAlertasVisualesLocales,
} from '../lib/alertRuntimeEvents'
import type { Alerta } from '../types/alerta'
import { alertaSilenciada } from '../lib/alertSilencio'
import { obtenerReglas } from '../services/reglasService'
import { supabase } from '../services/supabaseClient'
import { leerVisibilidadAlertas, leerRecordatorioConfig } from '../lib/reglasAlertas'
import type { VisibilidadAlertas, RecordatorioConfig } from '../lib/reglasAlertas'

const DURACION_TOAST_MS = 6000
const INTERVALO_RESPALDO_MS = 30000

// Nivel esperado segun el stock real del material con los umbrales fijos
// del semaforo (rojo <= 30, amarillo 31-60, verde >= 61).
function nivelStockEsperado(stock: number): Alerta['nivel'] | null {
  if (stock > 60) return null
  if (stock <= 30) return 'critica'
  return 'alta'
}

export default function RealtimeAlertToast() {
  const location = useLocation()
  const [alerta, setAlerta] = useState<Alerta | null>(null)
  const [cola, setCola] = useState<Alerta[]>([])
  const [alertasCentro, setAlertasCentro] = useState<Alerta[]>([])
  const [idsNoRevisados, setIdsNoRevisados] = useState<string[]>(obtenerAlertasNoRevisadas)
  const [visible, setVisible] = useState(false)
  const [centroAbierto, setCentroAbierto] = useState(false)
  const [cargandoCentro, setCargandoCentro] = useState(false)
  const alertasConocidasRef = useRef<Map<string, string>>(new Map())
  const firmasVisualesConocidasRef = useRef<Set<string>>(new Set())
  const lineaBaseListaRef = useRef(false)
  const enPaginaAlertasRef = useRef(false)
  const visibilidadRef = useRef<VisibilidadAlertas>({
    rojas: true,
    amarillas: true,
    pedidos: true,
    materiales: true,
  })
  const [recordatorio, setRecordatorio] = useState<RecordatorioConfig>({
    activo: false,
    minutos: 0,
    deseleccionadas: [],
  })
  const recordatorioRef = useRef<RecordatorioConfig>({
    activo: false,
    minutos: 0,
    deseleccionadas: [],
  })
  const stockMaterialesRef = useRef<Map<string, { stock: number; expira: number }>>(new Map())

  const nivelStockMaterialActual = useCallback(
    async (materialId: string): Promise<number | null> => {
      const ahora = Date.now()
      const guardado = stockMaterialesRef.current.get(materialId)
      if (guardado && guardado.expira > ahora) return guardado.stock

      const { data, error } = await supabase
        .from('materiales')
        .select('stock_actual')
        .eq('id', materialId)
        .limit(1)
        .returns<{ stock_actual: number | null }[]>()

      if (error || !data?.[0] || typeof data[0].stock_actual !== 'number') return null

      stockMaterialesRef.current.set(materialId, {
        stock: data[0].stock_actual,
        expira: ahora + 3000,
      })
      return data[0].stock_actual
    },
    []
  )

  // Valida que una alerta de stock tenga el color del estado actual del material.
  // Si el trigger de la BD o un sync viejo creo una alerta con nivel distinto
  // al que corresponde (umbrales fijos), se oculta para que no se duplique.
  const alertaStockColorValido = useCallback(
    async (alerta: Alerta): Promise<boolean> => {
      if (!esAlertaStockMaterial(alerta) || alerta.nivel === 'informativa') return true
      if (!alerta.material_id) return true

      const stock = await nivelStockMaterialActual(alerta.material_id)
      if (stock === null) return true

      return nivelStockEsperado(stock) === alerta.nivel
    },
    [nivelStockMaterialActual]
  )

  const sincronizarFirmasVisualesConocidas = useCallback(() => {
    firmasVisualesConocidasRef.current = new Set(alertasConocidasRef.current.values())
  }, [])

  const registrarAlertaEntrante = useCallback((
    nuevaAlerta: Alerta,
    opciones: { notificar?: boolean } & OpcionesAlertaVisualLocal = {}
  ) => {
    const esResolucionForzada =
      opciones.forzarNotificacion && esAlertaResolucionStock(nuevaAlerta)

    if (
      nuevaAlerta.estado === 'cerrada' ||
      (nuevaAlerta.nivel === 'informativa' && !esResolucionForzada)
    ) {
      const firmaAnterior = alertasConocidasRef.current.get(nuevaAlerta.id)
      alertasConocidasRef.current.delete(nuevaAlerta.id)
      if (firmaAnterior) sincronizarFirmasVisualesConocidas()
      setAlertasCentro((actual) => actual.filter((item) => item.id !== nuevaAlerta.id))
      return
    }

    // Regla de visibilidad: si el color/categoria de la alerta no esta marcado,
    // no se notifica ni se cuenta (no aparece el aviso flotante ni en el centro).
    if (!alertaVisiblePorRegla(nuevaAlerta, visibilidadRef.current)) {
      alertasConocidasRef.current.set(nuevaAlerta.id, firmaAlerta(nuevaAlerta))
      firmasVisualesConocidasRef.current.add(firmaAlerta(nuevaAlerta))
      setAlertasCentro((actual) => actual.filter((item) => item.id !== nuevaAlerta.id))
      return
    }

    // Regla de recordatorio activa: solo saltan como aviso flotante las categorias
    // seleccionadas (reposicion / pedidos / reportes). Las desmarcadas no notifican.
    if (
      recordatorioRef.current.activo &&
      !alertaEnRecordatorio(nuevaAlerta, recordatorioRef.current.deseleccionadas)
    ) {
      alertasConocidasRef.current.set(nuevaAlerta.id, firmaAlerta(nuevaAlerta))
      firmasVisualesConocidasRef.current.add(firmaAlerta(nuevaAlerta))
      setAlertasCentro((actual) => actual.filter((item) => item.id !== nuevaAlerta.id))
      return
    }

    const firma = firmaAlerta(nuevaAlerta)
    const yaConocidaPorId = alertasConocidasRef.current.get(nuevaAlerta.id) === firma
    const yaConocidaPorFirma = firmasVisualesConocidasRef.current.has(firma)
    alertasConocidasRef.current.set(nuevaAlerta.id, firma)
    firmasVisualesConocidasRef.current.add(firma)
    setAlertasCentro((actual) =>
      esResolucionForzada
        ? actual.filter((item) => !mismaAlertaStockMaterial(item, nuevaAlerta))
        : agregarAlerta(
            actual.filter((item) => !mismaAlertaStockMaterial(item, nuevaAlerta)),
            nuevaAlerta
          )
    )

    if (
      alertaSilenciada(nuevaAlerta) ||
      yaConocidaPorId ||
      yaConocidaPorFirma ||
      (!opciones.forzarNotificacion && opciones.notificar === false) ||
      enPaginaAlertasRef.current
    ) {
      return
    }

    setCola((actual) => actual.filter((item) => !mismaAlertaStockMaterial(item, nuevaAlerta)))

    if (opciones.forzarNotificacion && esAlertaStockMaterial(nuevaAlerta)) {
      setAlerta(nuevaAlerta)
      setVisible(true)
      agregarAlertaNoRevisada(nuevaAlerta.id)
      setIdsNoRevisados(obtenerAlertasNoRevisadas())
      return
    }

    setCola((actual) => agregarAlerta(actual, nuevaAlerta))
    agregarAlertaNoRevisada(nuevaAlerta.id)
    setIdsNoRevisados(obtenerAlertasNoRevisadas())
  }, [sincronizarFirmasVisualesConocidas])

  const registrarAlertaEntranteValidada = useCallback((
    nuevaAlerta: Alerta,
    opciones: { notificar?: boolean } & OpcionesAlertaVisualLocal = {}
  ) => {
    void alertaStockColorValido(nuevaAlerta).then((valida) => {
      if (!valida) {
        // La alerta no coincide con el color del stock: se marca como conocida
        // para no reprocesarla, pero no se muestra ni se notifica.
        alertasConocidasRef.current.set(nuevaAlerta.id, firmaAlerta(nuevaAlerta))
        firmasVisualesConocidasRef.current.add(firmaAlerta(nuevaAlerta))
        return
      }
      registrarAlertaEntrante(nuevaAlerta, opciones)
    })
  }, [registrarAlertaEntrante, alertaStockColorValido])

  const establecerLineaBase = useCallback(async () => {
    const { data, error } = await obtenerAlertasVisualesActivas()
    if (error) return

    alertasConocidasRef.current = new Map(
      (data || []).map((item) => [item.id, firmaAlerta(item)])
    )
    sincronizarFirmasVisualesConocidas()
    lineaBaseListaRef.current = true
  }, [sincronizarFirmasVisualesConocidas])

  function limpiarNotificacionesVistas() {
    limpiarAlertasNoRevisadas()
    setIdsNoRevisados([])
    setCola([])
    setVisible(false)
    setAlerta(null)
  }

  useEffect(() => {
    const dejarDeEscuchar = escucharAlertas((nuevaAlerta) => {
      registrarAlertaEntranteValidada(nuevaAlerta, {
        notificar: !esAlertaStockSincronizada(nuevaAlerta),
      })
    })

    return dejarDeEscuchar
  }, [registrarAlertaEntranteValidada])

  useEffect(() => {
    return escucharAlertasVisualesLocales((nuevaAlerta, opciones) => {
      registrarAlertaEntranteValidada(nuevaAlerta, opciones)
    })
  }, [registrarAlertaEntranteValidada])

  useEffect(() => {
    let cancelado = false

    async function detectarAlertasNuevas() {
      if (enPaginaAlertasRef.current) {
        limpiarNotificacionesVistas()
        await establecerLineaBase()
        return
      }

      if (!lineaBaseListaRef.current) {
        await establecerLineaBase()
        return
      }

      const { data, error } = await obtenerAlertasVisualesActivas()

      if (cancelado || error) return

      const activas = data || []
      const idsActivos = new Set(activas.map((item) => item.id))

      alertasConocidasRef.current.forEach((_, id) => {
        if (!idsActivos.has(id)) alertasConocidasRef.current.delete(id)
      })
      sincronizarFirmasVisualesConocidas()

      activas
        .filter((item) => alertasConocidasRef.current.get(item.id) !== firmaAlerta(item))
        .reverse()
        .forEach((item) =>
          registrarAlertaEntranteValidada(item, {
            notificar: !esAlertaStockSincronizada(item),
          })
        )
    }

    establecerLineaBase()
    const intervalo = window.setInterval(detectarAlertasNuevas, INTERVALO_RESPALDO_MS)

    return () => {
      cancelado = true
      window.clearInterval(intervalo)
    }
  }, [establecerLineaBase, registrarAlertaEntranteValidada, sincronizarFirmasVisualesConocidas])

  useEffect(() => {
    enPaginaAlertasRef.current = location.pathname.startsWith('/alertas')

    if (!enPaginaAlertasRef.current) return

    limpiarNotificacionesVistas()
    void establecerLineaBase()
  }, [establecerLineaBase, location.pathname])

  useEffect(() => {
    let activo = true
    const cargarReglas = () =>
      obtenerReglas().then((resultado) => {
        if (!activo || resultado.error) return
        const reglas = resultado.data || []
        visibilidadRef.current = leerVisibilidadAlertas(reglas)
        const siguiente = leerRecordatorioConfig(reglas)
        recordatorioRef.current = siguiente
        setRecordatorio((prev) =>
          prev.activo === siguiente.activo &&
          prev.minutos === siguiente.minutos &&
          prev.deseleccionadas.join(',') === siguiente.deseleccionadas.join(',')
            ? prev
            : siguiente,
        )
      })
    cargarReglas()
    const intervalo = window.setInterval(cargarReglas, 20000)
    return () => {
      activo = false
      window.clearInterval(intervalo)
    }
  }, [])

  // Recordatorio: cada X minutos vuelven a aparecer las alertas activas que
  // pasan la visibilidad y cuya regla no fue desmarcada (nunca las de historial).
  useEffect(() => {
    if (!recordatorio.activo || recordatorio.minutos <= 0) return

    const repetir = async () => {
      const { data, error } = await obtenerAlertas()
      if (error) return

      const aRecordar = (data || []).filter(
        (item) =>
          item.estado !== 'cerrada' &&
          item.nivel !== 'informativa' &&
          alertaVisiblePorRegla(item, visibilidadRef.current) &&
          alertaEnRecordatorio(item, recordatorio.deseleccionadas),
      )

      if (aRecordar.length === 0) return

      // Recordatorio: TODAS las alertas registradas del/los modulo(s) seleccionado(s)
      // vuelven a la cola y aparecen una tras otra, en el orden de prioridad
      // vigente (primero rojas/criticas, luego amarillas), unos segundos cada una.
      const ordenadas = [...aRecordar].sort(ordenarAlertasPorPrioridad)
      setCola((actual) => {
        const nueva = [...actual]
        ordenadas.forEach((item) => {
          if (!nueva.some((x) => x.id === item.id)) nueva.push(item)
        })
        return nueva.slice(-50).sort(ordenarAlertasPorPrioridad)
      })
      aRecordar.forEach((item) => agregarAlertaNoRevisada(item.id))
      setIdsNoRevisados(obtenerAlertasNoRevisadas())
    }

    void repetir()
    const intervalo = window.setInterval(repetir, recordatorio.minutos * 60000)
    return () => window.clearInterval(intervalo)
  }, [recordatorio])

  useEffect(() => escucharAlertasNoRevisadas(setIdsNoRevisados), [])

  useEffect(() => {
    if (visible || cola.length === 0) return

    const mostrarTimeout = window.setTimeout(() => {
      const [siguiente, ...resto] = cola
      setAlerta(siguiente)
      setCola(resto)
      setVisible(true)
    }, 0)

    return () => window.clearTimeout(mostrarTimeout)
  }, [cola, visible])

  useEffect(() => {
    if (!visible || !alerta) return

    const cerrarTimeout = window.setTimeout(() => {
      setVisible(false)
      setAlerta(null)
    }, DURACION_TOAST_MS)

    return () => window.clearTimeout(cerrarTimeout)
  }, [alerta, visible])

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

    const visibles: Alerta[] = []
    for (const item of data || []) {
      if (item.estado === 'cerrada' || item.nivel === 'informativa') continue
      if (!(await alertaStockColorValido(item))) continue
      visibles.push(item)
    }

    setAlertasCentro(visibles.slice(0, 8))
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
          className={`alert-toast fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-md rounded-lg border p-5 shadow-xl ${estilos}`}
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
                    limpiarNotificacionesVistas()
                  }}
                  className="inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-semibold transition hover:bg-white/30"
                >
                  Ver alertas
                </Link>
              </div>
            </div>

            <button
              onClick={() => {
                setVisible(false)
                setAlerta(null)
              }}
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
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#ed1c24]">
                Centro de alertas
              </p>
              <h3 className="mt-1 text-lg font-bold">Alertas recientes</h3>
            </div>
            <button
              type="button"
              onClick={() => setCentroAbierto(false)}
              className="alert-center-close rounded-lg p-2 text-[#6d5d57] transition hover:bg-[#fff0f0] hover:text-[#c8102e]"
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
                    className="rounded-lg border border-[#ed1c24]/45 px-3 py-1.5 text-xs font-semibold text-[#c8102e] transition hover:bg-[#ed1c24]/10"
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
        className={`alert-float-button relative flex h-10 w-10 items-center justify-center rounded-full border border-[#f0c2c2] bg-white text-[#c8102e] shadow-sm transition hover:scale-105 hover:bg-[#fff0f0] ${
          idsNoRevisados.length > 0 ? 'animate-pulse ring-4 ring-[#ed1c24]/20' : ''
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
  if (alertas.some((item) => item.id === alerta.id)) {
    return alertas.map((item) => (item.id === alerta.id ? alerta : item))
  }
  return [...alertas, alerta].slice(-5)
}

function firmaAlerta(alerta: Alerta) {
  return [
    alerta.estado,
    alerta.nivel,
    alerta.tipo_alerta,
    alerta.pedido_id || '',
    alerta.material_id || '',
    alerta.pedido_codigo || '',
    alerta.pedido_estado || '',
    normalizarTexto(alerta.pedido_material || ''),
  ].join('|')
}

function formatearEtiqueta(valor: string) {
  return valor.replace(/_/g, ' ')
}

function colorNivel(nivel: Alerta['nivel']) {
  if (nivel === 'critica') return 'bg-red-500'
  if (nivel === 'alta' || nivel === 'media') return 'bg-yellow-400'
  return 'bg-green-400'
}

// Orden de prioridad vigente: primero las rojas (criticas), luego las amarillas.
function pesoNivelAlerta(nivel: Alerta['nivel']) {
  if (nivel === 'critica') return 0
  if (nivel === 'alta') return 1
  if (nivel === 'media') return 2
  return 3
}

function ordenarAlertasPorPrioridad(a: Alerta, b: Alerta) {
  return pesoNivelAlerta(a.nivel) - pesoNivelAlerta(b.nivel)
}

// Clasifica cada alerta flotante en una de las tres categorias del recordatorio:
// pedidos (priorizacion de pedidos), inventario (stock/materiales) o reportes.
function categoriaAlerta(alerta: Alerta): 'inventario' | 'pedidos' | 'reportes' {
  const tipo = (alerta.tipo_alerta || '').toLowerCase()
  if (tipo.includes('reporte') || tipo.includes('nota_credito') || tipo.includes('_nc')) {
    return 'reportes'
  }
  if (
    tipo.includes('stock') ||
    tipo.includes('inventario') ||
    tipo.includes('material') ||
    tipo.includes('falta') ||
    tipo.includes('agotar')
  ) {
    return 'inventario'
  }
  return 'pedidos'
}

function alertaEnRecordatorio(alerta: Alerta, deseleccionadas: string[]) {
  return !deseleccionadas.includes(categoriaAlerta(alerta))
}

function alertaVisiblePorRegla(alerta: Alerta, visibilidad: VisibilidadAlertas) {
  const colorOk = alerta.nivel === 'critica' ? visibilidad.rojas : visibilidad.amarillas
  const categoriaOk = esAlertaStockMaterial(alerta) ? visibilidad.materiales : visibilidad.pedidos
  return colorOk && categoriaOk
}

function esAlertaStockMaterial(alerta: Alerta) {
  return (
    ['stock_bajo', 'faltante_bodega_fq', 'stock_normalizado'].includes(alerta.tipo_alerta) &&
    Boolean(alerta.material_id || alerta.pedido_material)
  )
}

function esAlertaResolucionStock(alerta: Alerta) {
  return alerta.tipo_alerta === 'stock_normalizado'
}

function mismaAlertaStockMaterial(actual: Alerta, entrante: Alerta) {
  if (actual.id === entrante.id) return false
  if (!esAlertaStockMaterial(actual) || !esAlertaStockMaterial(entrante)) return false

  if (actual.material_id && entrante.material_id) {
    return actual.material_id === entrante.material_id
  }

  return (
    normalizarTexto(actual.pedido_material || '') !== '' &&
    normalizarTexto(actual.pedido_material || '') === normalizarTexto(entrante.pedido_material || '')
  )
}

function esAlertaStockSincronizada(alerta: Alerta) {
  const responsable = normalizarTexto(alerta.responsable || '')

  return (
    alerta.id.startsWith('stock-operativo-') ||
    responsable.includes('sincronizacion automatica')
  )
}

function normalizarTexto(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}
