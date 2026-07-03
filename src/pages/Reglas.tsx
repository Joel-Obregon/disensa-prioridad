import { useEffect, useState, type ReactNode } from 'react'
import {
  Boxes,
  ChevronDown,
  Clock3,
  GripVertical,
  History,
  Pencil,
  RotateCcw,
  Save,
  Settings,
  ShieldAlert,
  Store,
  Truck,
  X,
} from 'lucide-react'
import { useAuth } from '../auth/authState'
import {
  obtenerAuditoriaPorEntidad,
  registrarAuditoria,
} from '../services/auditoriaService'
import {
  actualizarReglaNegocio,
  obtenerReglas,
} from '../services/reglasService'
import {
  guardarOrdenPrioridad,
  obtenerPrioridadCriterios,
  type PrioridadCriterio,
} from '../services/prioridadCriteriosService'
import type { Auditoria } from '../types/auditoria'
import type { ReglaNegocio } from '../types/regla'

type NivelAtencion = 'critica' | 'alta' | 'media' | 'seguimiento'

type FormularioRegla = {
  accion: string
  activa: boolean
  criterio: string
  efecto: string
  nivel: NivelAtencion
  parametros: Record<string, string>
}

type GuiaRegla = {
  area: string
  responsable: string
}

const configuracionNivel: Record<
  NivelAtencion,
  { color: string; etiqueta: string; pesoInterno: number; descripcion: string }
> = {
  critica: {
    color: 'red',
    etiqueta: 'Atención crítica',
    pesoInterno: 40,
    descripcion: 'Se atiende de inmediato y aparece al inicio de la cola.',
  },
  alta: {
    color: 'orange',
    etiqueta: 'Atención alta',
    pesoInterno: 30,
    descripcion: 'Se gestiona con prioridad durante la jornada.',
  },
  media: {
    color: 'yellow',
    etiqueta: 'Atención media',
    pesoInterno: 20,
    descripcion: 'Requiere seguimiento antes de que se convierta en retraso.',
  },
  seguimiento: {
    color: 'blue',
    etiqueta: 'Seguimiento',
    pesoInterno: 10,
    descripcion: 'Se mantiene visible sin desplazar casos urgentes.',
  },
}

const niveles: NivelAtencion[] = ['critica', 'alta', 'media', 'seguimiento']
// Una regla es configurable (editable) si guarda sus parametros como JSON en
// la columna `condicion`. Asi el editor se adapta a cualquier regla.
function esReglaConfigurable(regla: ReglaNegocio): boolean {
  return (regla.condicion ?? '').trim().startsWith('{')
}

const REGLAS_PRIORIDAD_OCULTAS = [
  'Retraso del pedido (amarillo)',
  'Reprogramado por retraso (naranja)',
  'Retraso critico (rojo)',
]

export default function Reglas() {
  const { perfil } = useAuth()
  const [reglas, setReglas] = useState<ReglaNegocio[]>([])
  const [criterios, setCriterios] = useState<PrioridadCriterio[]>([])
  const [arrastrando, setArrastrando] = useState<number | null>(null)
  const [historial, setHistorial] = useState<Auditoria[]>([])
  const [reglaEditando, setReglaEditando] = useState<ReglaNegocio | null>(null)
  const [formulario, setFormulario] = useState<FormularioRegla | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const puedeEditar = perfil?.rol === 'administrador'

  useEffect(() => {
    let activo = true

    Promise.all([
      obtenerReglas(),
      obtenerAuditoriaPorEntidad('reglas_negocio'),
      obtenerPrioridadCriterios(),
    ]).then(([reglasResult, historialResult, criteriosResult]) => {
      if (!activo) return

      if (!criteriosResult.error) setCriterios(criteriosResult.data || [])

      if (reglasResult.error) {
        setError('No se pudieron cargar las reglas desde Supabase.')
        setReglas([])
      } else {
        setReglas(reglasResult.data || [])
      }

      if (!historialResult.error) {
        setHistorial(historialResult.data || [])
      }

      setCargando(false)
    })

    return () => {
      activo = false
    }
  }, [])

  function abrirConfiguracion(regla: ReglaNegocio) {
    setReglaEditando(regla)
    setFormulario({
      accion: regla.accion || regla.efecto,
      activa: regla.estado === 'activa' && regla.activo !== false,
      criterio: regla.criterio,
      efecto: regla.efecto,
      nivel: nivelDesdeRegla(regla),
      parametros: parametrosIniciales(regla),
    })
    setError('')
    setMensaje('')
  }

  function cerrarConfiguracion() {
    setReglaEditando(null)
    setFormulario(null)
  }

  async function guardarConfiguracion() {
    if (!reglaEditando || !formulario || !puedeEditar) return

    if (!formulario.criterio.trim() || !formulario.efecto.trim()) {
      setError('La condición y la acción del sistema son obligatorias.')
      return
    }

    const parametros = parametrosNormalizados(formulario.parametros)

    setGuardando(true)
    setError('')
    setMensaje('')

    const nivel = configuracionNivel[formulario.nivel]
    const estado = formulario.activa ? 'activa' : 'inactiva'
    const resultado = await actualizarReglaNegocio(reglaEditando.id, {
      accion: formulario.accion.trim() || formulario.efecto.trim(),
      activo: formulario.activa,
      color: nivel.color,
      condicion: JSON.stringify(parametros),
      criterio: formulario.criterio.trim(),
      efecto: formulario.efecto.trim(),
      estado,
      peso: nivel.pesoInterno,
    })

    if (resultado.error || !resultado.data) {
      setError(resultado.error?.message || 'No se pudo guardar la regla.')
      setGuardando(false)
      return
    }

    setReglas((actuales) =>
      actuales.map((regla) =>
        regla.id === resultado.data.id ? resultado.data : regla
      )
    )

    await registrarAuditoria({
      entidad: 'reglas_negocio',
      entidad_id: reglaEditando.id,
      accion: 'configurar_regla',
      detalle: `${reglaEditando.nombre}: ${estado}, ${nivel.etiqueta.toLowerCase()}. Condición: ${formulario.criterio.trim()}.`,
      responsable: perfil?.nombre || perfil?.correo || 'Administrador',
    })

    const historialResult = await obtenerAuditoriaPorEntidad('reglas_negocio')
    if (!historialResult.error) setHistorial(historialResult.data || [])

    setMensaje(`La regla “${reglaEditando.nombre}” quedó actualizada.`)
    setGuardando(false)
    cerrarConfiguracion()
  }

  async function soltarCriterioEn(destino: number) {
    if (!puedeEditar || arrastrando === null || arrastrando === destino) {
      setArrastrando(null)
      return
    }

    const nuevo = [...criterios]
    const [movido] = nuevo.splice(arrastrando, 1)
    nuevo.splice(destino, 0, movido)
    setArrastrando(null)
    setCriterios(nuevo.map((criterio, i) => ({ ...criterio, orden: i + 1 })))
    await guardarOrdenPrioridad(nuevo.map((criterio) => criterio.clave))
  }

  return (
    <div className="reglas-module space-y-6">
      <section className="border border-[#d8d2df] bg-white p-6 lg:p-8">
        <div className="max-w-4xl">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#a33e00]">
            <Settings size={16} />
            Reglas parametrizables
          </div>
          <h1 className="mt-3 text-3xl font-bold leading-tight text-[#0f0f11]">
            Reglas operativas configurables
          </h1>
        </div>

        {!puedeEditar && (
          <div className="mt-5 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Puedes consultar el motor. Solo un administrador puede cambiar su configuración.
          </div>
        )}

        {error && (
          <div className="mt-5 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {mensaje && (
          <div className="mt-5 border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {mensaje}
          </div>
        )}
      </section>

      <section className="border border-[#d8d2df] bg-white">
        <div className="border-b border-[#d8d2df] p-5 lg:p-6">
          <h2 className="text-xl font-bold text-[#0f0f11]">Orden de prioridad de la cola</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Arrastra para reordenar.
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {criterios.map((criterio, indice) => (
            <div
              key={criterio.clave}
              draggable={puedeEditar}
              onDragStart={() => setArrastrando(indice)}
              onDragOver={(evento) => evento.preventDefault()}
              onDrop={() => soltarCriterioEn(indice)}
              onDragEnd={() => setArrastrando(null)}
              className={`flex items-center gap-4 p-4 transition lg:px-6 ${
                puedeEditar ? 'cursor-grab active:cursor-grabbing' : ''
              } ${arrastrando === indice ? 'opacity-40' : 'hover:bg-slate-50'}`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#fff1ec] text-sm font-bold text-[#a33e00]">
                {indice + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900">{criterio.etiqueta}</p>
                {criterio.descripcion && (
                  <p className="text-xs text-slate-500">{criterio.descripcion}</p>
                )}
              </div>
              {puedeEditar && <GripVertical size={18} className="shrink-0 text-slate-300" />}
            </div>
          ))}
          {criterios.length === 0 && (
            <p className="p-5 text-sm text-slate-500">Sin criterios de prioridad configurados.</p>
          )}
        </div>
      </section>

      <section className="border border-[#d8d2df] bg-white">
        <div className="border-b border-[#d8d2df] p-5 lg:p-6">
          <div className="flex items-start gap-3">
            <span className="bg-[#fff1ec] p-2.5 text-[#a33e00]">
              <ShieldAlert size={20} />
            </span>
            <div>
              <h2 className="text-xl font-bold text-[#0f0f11]">Configuración del motor</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Estas reglas definen las alertas del sistema.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-2 lg:p-6">
          {cargando && (
            <p className="border border-slate-200 bg-slate-50 p-6 text-slate-500">
              Cargando reglas...
            </p>
          )}

          {!cargando && !error && reglas.length === 0 && (
            <p className="border border-dashed border-slate-300 p-8 text-center text-slate-500 lg:col-span-2">
              No hay reglas registradas en Supabase.
            </p>
          )}

          {reglas
            .filter((regla) => !REGLAS_PRIORIDAD_OCULTAS.includes(regla.nombre))
            .map((regla) => (
            <TarjetaRegla
              key={regla.id}
              puedeEditar={puedeEditar && esReglaConfigurable(regla)}
              regla={regla}
              onConfigurar={() => abrirConfiguracion(regla)}
            />
          ))}
        </div>
      </section>

      <section className="border border-[#d8d2df] bg-white">
        <div className="flex items-start gap-3 border-b border-[#d8d2df] p-5 lg:p-6">
          <span className="bg-[#fff1ec] p-2.5 text-[#a33e00]">
            <History size={20} />
          </span>
          <div>
            <h2 className="text-xl font-bold text-[#0f0f11]">Historial de configuración</h2>
            <p className="mt-1 text-sm text-slate-500">
              Conserva quién modificó una regla y qué configuración aplicó.
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {historial.map((registro) => (
            <article key={registro.id} className="grid gap-2 p-5 md:grid-cols-[180px_1fr]">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {formatearFecha(registro.created_at)}
                </p>
                <p className="mt-1 text-xs text-slate-500">{registro.responsable}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#a33e00]">Regla actualizada</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{registro.detalle}</p>
              </div>
            </article>
          ))}

          {!cargando && historial.length === 0 && (
            <p className="p-6 text-sm text-slate-500">
              El historial comenzará a registrarse con la próxima modificación.
            </p>
          )}
        </div>
      </section>

      {reglaEditando && formulario && (
        <EditorRegla
          error={error}
          formulario={formulario}
          guardando={guardando}
          onCancelar={cerrarConfiguracion}
          onChange={setFormulario}
          onGuardar={guardarConfiguracion}
          regla={reglaEditando}
        />
      )}
    </div>
  )
}

function TarjetaRegla({
  onConfigurar,
  puedeEditar,
  regla,
}: {
  onConfigurar: () => void
  puedeEditar: boolean
  regla: ReglaNegocio
}) {
  const nivel = nivelDesdeRegla(regla)
  const guia = obtenerGuiaRegla(regla)
  const activa = regla.estado === 'activa' && regla.activo !== false

  return (
    <article
      className={`relative overflow-hidden border bg-white p-5 ${claseBordeNivel(nivel)} ${
        activa ? '' : 'opacity-70'
      }`}
    >
      <div className={`absolute inset-y-0 left-0 w-1.5 ${claseFondoNivel(nivel)}`} />
      <div className="pl-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className={`p-2.5 ${claseIconoNivel(nivel)}`}>
              <IconoArea area={guia.area} />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                {guia.area}
              </p>
              <h3 className="mt-1 font-bold text-slate-900">{regla.nombre}</h3>
            </div>
          </div>
          <span
            className={`shrink-0 px-2.5 py-1 text-xs font-semibold ${
              activa
                ? 'bg-green-50 text-green-700 ring-1 ring-green-200'
                : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'
            }`}
          >
            {activa ? 'Activa' : 'Inactiva'}
          </span>
        </div>

        <div className="mt-4 space-y-3">
          <DatoRegla etiqueta="Condición evaluada" texto={regla.criterio} />
          <DatoRegla etiqueta="Respuesta del sistema" texto={regla.efecto} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 text-xs">
          <span className={`px-3 py-1.5 font-semibold ${claseBadgeNivel(nivel)}`}>
            {configuracionNivel[nivel].etiqueta}
          </span>
          <span className="bg-[#fff7f2] px-3 py-1.5 font-semibold text-[#6d2b12]">
            Responsable: {guia.responsable}
          </span>
        </div>

        {puedeEditar && (
          <button
            type="button"
            onClick={onConfigurar}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 border border-[#dfad9c] bg-white px-4 py-2.5 text-sm font-semibold text-[#a33e00] hover:bg-[#fff1ec]"
          >
            <Pencil size={16} />
            Configurar regla
          </button>
        )}

        {!esReglaConfigurable(regla) && (
          <p className="mt-4 border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
            Regla automática vinculada al centro de alertas. Su condición se ejecuta
            desde inventario, pedidos o reportes.
          </p>
        )}
      </div>
    </article>
  )
}

function EditorRegla({
  error,
  formulario,
  guardando,
  onCancelar,
  onChange,
  onGuardar,
  regla,
}: {
  error: string
  formulario: FormularioRegla
  guardando: boolean
  onCancelar: () => void
  onChange: (formulario: FormularioRegla) => void
  onGuardar: () => void
  regla: ReglaNegocio
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4">
      <section className="mt-6 w-full max-w-3xl border border-[#d8d2df] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#d8d2df] p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#a33e00]">
              Parametrizar regla
            </p>
            <h2 className="mt-1 text-2xl font-bold text-[#0f0f11]">{regla.nombre}</h2>
          </div>
          <button
            type="button"
            onClick={onCancelar}
            className="border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
            aria-label="Cerrar configuración"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {error && (
            <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <label className="flex items-center justify-between gap-4 border border-slate-200 bg-slate-50 p-4">
            <span>
              <span className="block font-semibold text-slate-900">Regla activa</span>
              <span className="mt-1 block text-sm text-slate-500">
                Si se desactiva, deja de participar en la prioridad de los pedidos.
              </span>
            </span>
            <input
              type="checkbox"
              checked={formulario.activa}
              onChange={(event) =>
                onChange({ ...formulario, activa: event.target.checked })
              }
              className="h-5 w-5 accent-[#a33e00]"
            />
          </label>

          <Campo label="Nivel de atención">
            <div className="relative mt-2">
              <select
                value={formulario.nivel}
                onChange={(event) =>
                  onChange({
                    ...formulario,
                    nivel: event.target.value as NivelAtencion,
                  })
                }
                className="w-full appearance-none border border-slate-300 bg-white px-4 py-3 pr-10"
              >
                {niveles.map((nivel) => (
                  <option key={nivel} value={nivel}>
                    {configuracionNivel[nivel].etiqueta}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={17}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {configuracionNivel[formulario.nivel].descripcion}
            </p>
          </Campo>

          <ParametrosRegla
            formulario={formulario}
            onChange={onChange}
            regla={regla}
          />

          <VistaPreviaRegla formulario={formulario} />

          <Campo label="Descripción de la condición">
            <textarea
              value={formulario.criterio}
              onChange={(event) =>
                onChange({ ...formulario, criterio: event.target.value })
              }
              rows={3}
              className="mt-2 w-full border border-slate-300 px-4 py-3"
              placeholder="Ejemplo: Si el pedido supera la fecha comprometida."
            />
            <p className="mt-2 text-xs font-normal leading-5 text-slate-500">
              Los campos anteriores controlan el cálculo. Este texto explica la regla al equipo.
            </p>
          </Campo>

          <Campo label="Respuesta automática del sistema">
            <textarea
              value={formulario.efecto}
              onChange={(event) =>
                onChange({ ...formulario, efecto: event.target.value })
              }
              rows={3}
              className="mt-2 w-full border border-slate-300 px-4 py-3"
              placeholder="Ejemplo: Subir el pedido en la cola y mostrar alerta roja."
            />
          </Campo>

          <Campo label="Acción operativa sugerida">
            <input
              value={formulario.accion}
              onChange={(event) =>
                onChange({ ...formulario, accion: event.target.value })
              }
              className="mt-2 w-full border border-slate-300 px-4 py-3"
              placeholder="Ejemplo: Revisar despacho con bodega."
            />
          </Campo>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-[#d8d2df] p-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancelar}
            disabled={guardando}
            className="inline-flex items-center justify-center gap-2 border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCcw size={16} />
            Cancelar
          </button>
          <button
            type="button"
            onClick={onGuardar}
            disabled={guardando}
            className="inline-flex items-center justify-center gap-2 bg-[#a33e00] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#842f00] disabled:opacity-50"
          >
            <Save size={16} />
            {guardando ? 'Guardando...' : 'Guardar configuración'}
          </button>
        </div>
      </section>
    </div>
  )
}

function ParametrosRegla({
  formulario,
  onChange,
}: {
  formulario: FormularioRegla
  onChange: (formulario: FormularioRegla) => void
  regla: ReglaNegocio
}) {
  const llaves = Object.keys(formulario.parametros)

  function actualizarParametro(llave: string, valor: string) {
    onChange({
      ...formulario,
      parametros: {
        ...formulario.parametros,
        [llave]: valor.replace(/[^\d.]/g, ''),
      },
    })
  }

  if (llaves.length === 0) {
    return (
      <section className="border border-[#e3bfb1] bg-[#fff7f2] p-4">
        <p className="text-sm font-semibold text-[#261812]">Parametros</p>
        <p className="mt-1 text-sm leading-5 text-slate-600">
          Esta regla no usa umbrales numericos: solo se activa/desactiva y se le
          define el nivel de atencion.
        </p>
      </section>
    )
  }

  return (
    <GrupoParametros descripcion="Ajusta los umbrales que usa esta regla para evaluar pedidos e inventario.">
      {llaves.map((llave) => (
        <ParametroNumerico
          key={llave}
          etiqueta={etiquetaParametro(llave)}
          unidad={unidadParametro(llave)}
          valor={formulario.parametros[llave]}
          onChange={(valor) => actualizarParametro(llave, valor)}
        />
      ))}
    </GrupoParametros>
  )
}

function etiquetaParametro(llave: string): string {
  const mapa: Record<string, string> = {
    factorMinimo: 'Factor sobre la cantidad requerida',
    diasDesde: 'Retraso desde (dias)',
    diasHasta: 'Retraso hasta (dias)',
    coberturaMinima: 'Cobertura minima de stock',
    pedidosPorMes: 'Pedidos por mes',
    diasEntrega: 'Dias para la entrega (SLA)',
    diasPendiente: 'Dias pendiente permitidos',
    porcentajeAlerta: 'Porcentaje del objetivo para alertar',
    horasSinMovimiento: 'Horas sin movimiento',
    montoUmbral: 'Monto umbral',
    factorPromedio: 'Factor sobre el promedio historico',
    minFranquiciados: 'Minimo de franquiciados',
  }
  return mapa[llave] || llave
}

function unidadParametro(llave: string): string {
  const mapa: Record<string, string> = {
    factorMinimo: 'x',
    diasDesde: 'dias',
    diasHasta: 'dias',
    coberturaMinima: '%',
    pedidosPorMes: 'ped/mes',
    diasEntrega: 'dias',
    diasPendiente: 'dias',
    porcentajeAlerta: '%',
    horasSinMovimiento: 'horas',
    montoUmbral: 'USD',
    factorPromedio: 'x',
    minFranquiciados: 'FQ',
  }
  return mapa[llave] || ''
}

function GrupoParametros({
  children,
  descripcion,
}: {
  children: ReactNode
  descripcion: string
}) {
  return (
    <section className="border border-[#e3bfb1] bg-[#fff7f2] p-4">
      <p className="text-sm font-semibold text-[#261812]">Parámetros que usa el cálculo</p>
      <p className="mt-1 text-sm leading-5 text-slate-600">{descripcion}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function ParametroNumerico({
  etiqueta,
  onChange,
  unidad,
  valor,
}: {
  etiqueta: string
  onChange: (valor: string) => void
  unidad: string
  valor: string
}) {
  return (
    <label className="block text-sm font-semibold text-slate-800">
      {etiqueta}
      <div className="mt-2 flex border border-slate-300 bg-white">
        <input
          type="number"
          min="0"
          step="1"
          value={valor}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 border-0 px-3 py-2.5"
        />
        <span className="flex items-center border-l border-slate-200 px-3 text-xs text-slate-500">
          {unidad}
        </span>
      </div>
    </label>
  )
}

function VistaPreviaRegla({ formulario }: { formulario: FormularioRegla }) {
  const nivel = configuracionNivel[formulario.nivel]
  const parametros = Object.entries(formulario.parametros)

  return (
    <section className="border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-semibold text-slate-900">Vista previa</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className={`px-2.5 py-1 font-semibold ${claseBadgeNivel(formulario.nivel)}`}>
          {nivel.etiqueta} · peso {nivel.pesoInterno}
        </span>
        <span
          className={`px-2.5 py-1 font-semibold ${
            formulario.activa
              ? 'bg-green-50 text-green-700 ring-1 ring-green-200'
              : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'
          }`}
        >
          {formulario.activa ? 'Activa' : 'Inactiva'}
        </span>
        {parametros.map(([llave, valor]) => (
          <span
            key={llave}
            className="bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200"
          >
            {etiquetaParametro(llave)}: {valor || '0'} {unidadParametro(llave)}
          </span>
        ))}
      </div>
      <p className="mt-2 text-sm leading-5 text-slate-600">{nivel.descripcion}</p>
    </section>
  )
}

function DatoRegla({ etiqueta, texto }: { etiqueta: string; texto: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
        {etiqueta}
      </p>
      <p className="mt-1 text-sm leading-6 text-slate-700">{texto}</p>
    </div>
  )
}

function Campo({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block text-sm font-semibold text-slate-800">
      {label}
      {children}
    </label>
  )
}

function obtenerGuiaRegla(regla: ReglaNegocio): GuiaRegla {
  const texto = normalizarTexto(
    `${regla.nombre} ${regla.descripcion || ''} ${regla.criterio} ${regla.efecto}`
  )

  if (
    texto.includes('stock') ||
    texto.includes('inventario') ||
    texto.includes('material pedido no existe')
  ) {
    return {
      area: 'Disponibilidad de materiales',
      responsable: 'Bodega e inventario',
    }
  }

  if (texto.includes('retraso') || texto.includes('antiguedad') || texto.includes('fecha')) {
    return {
      area: 'Cumplimiento y tiempos',
      responsable: 'Operación',
    }
  }

  if (texto.includes('reporte') || texto.includes('franquiciado') || texto.includes('novedad')) {
    return {
      area: 'Incidencias del franquiciado',
      responsable: 'Operación y servicio',
    }
  }

  if (texto.includes('nota de credito') || texto.includes('valor pendiente')) {
    return {
      area: 'Impacto comercial',
      responsable: 'Gestión comercial',
    }
  }

  if (texto.includes('cantidad pendiente') || texto.includes('despach')) {
    return {
      area: 'Despacho del pedido',
      responsable: 'Bodega',
    }
  }

  return {
    area: 'Gestión operativa',
    responsable: 'Operación',
  }
}

function nivelDesdeRegla(regla: ReglaNegocio): NivelAtencion {
  const color = normalizarTexto(regla.color || '')

  if (color === 'red') return 'critica'
  if (color === 'orange') return 'alta'
  if (color === 'yellow') return 'media'
  if (color === 'blue') return 'seguimiento'
  if (regla.peso >= 35) return 'critica'
  if (regla.peso >= 25) return 'alta'
  if (regla.peso >= 18) return 'media'
  return 'seguimiento'
}

function IconoArea({ area }: { area: string }) {
  if (area === 'Disponibilidad de materiales') return <Boxes size={19} />
  if (area === 'Cumplimiento y tiempos') return <Clock3 size={19} />
  if (area === 'Incidencias del franquiciado') return <Store size={19} />
  if (area === 'Impacto comercial') return <ShieldAlert size={19} />
  if (area === 'Despacho del pedido') return <Truck size={19} />
  return <Settings size={19} />
}

function claseBadgeNivel(nivel: NivelAtencion) {
  if (nivel === 'critica') return 'bg-red-50 text-red-700 ring-1 ring-red-200'
  if (nivel === 'alta') return 'bg-orange-50 text-orange-700 ring-1 ring-orange-200'
  if (nivel === 'media') return 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
  return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
}

function claseBordeNivel(nivel: NivelAtencion) {
  if (nivel === 'critica') return 'border-red-200'
  if (nivel === 'alta') return 'border-orange-200'
  if (nivel === 'media') return 'border-amber-200'
  return 'border-blue-200'
}

function claseFondoNivel(nivel: NivelAtencion) {
  if (nivel === 'critica') return 'bg-red-600'
  if (nivel === 'alta') return 'bg-orange-500'
  if (nivel === 'media') return 'bg-amber-500'
  return 'bg-blue-500'
}

function claseIconoNivel(nivel: NivelAtencion) {
  if (nivel === 'critica') return 'bg-red-50 text-red-700'
  if (nivel === 'alta') return 'bg-orange-50 text-orange-700'
  if (nivel === 'media') return 'bg-amber-50 text-amber-800'
  return 'bg-blue-50 text-blue-700'
}

function normalizarTexto(valor: string) {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function formatearFecha(fecha: string) {
  const valor = new Date(fecha)
  if (Number.isNaN(valor.getTime())) return 'Fecha no disponible'

  return valor.toLocaleString('es-EC', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function parametrosIniciales(regla: ReglaNegocio): Record<string, string> {
  if (!regla.condicion?.trim().startsWith('{')) return {}

  try {
    const guardados = JSON.parse(regla.condicion) as Record<string, unknown>
    const valores: Record<string, string> = {}
    Object.entries(guardados).forEach(([llave, valor]) => {
      const numero = Number(valor)
      if (Number.isFinite(numero)) valores[llave] = String(numero)
    })
    return valores
  } catch {
    return {}
  }
}

function parametrosNormalizados(
  parametros: Record<string, string>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(parametros).map(([llave, valor]) => {
      const numero = Number(valor)
      return [llave, Number.isFinite(numero) && numero >= 0 ? numero : 0]
    }),
  )
}
