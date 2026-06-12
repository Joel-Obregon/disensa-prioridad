import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react'
import { supabase } from '../services/supabaseClient'

type RevisionSistema = {
  nombre: string
  detalle: string
  ok: boolean
  mensaje: string
}

const revisiones = [
  {
    nombre: 'Base de datos',
    tabla: 'pedidos',
    columnas: 'id',
    detalle: 'Conexion principal con Supabase para leer la operacion.',
  },
  {
    nombre: 'Priorizacion de pedidos',
    tabla: 'pedidos',
    columnas: 'id,codigo,estado,fecha_compromiso,prioridad_calculada',
    detalle: 'Valida que la cola pueda ordenar pedidos por retraso y criticidad.',
  },
  {
    nombre: 'Reglas de negocio',
    tabla: 'reglas_negocio',
    columnas: 'id,nombre,criterio,efecto,peso,estado',
    detalle: 'Confirma que las reglas del modulo Reglas esten disponibles para el motor.',
  },
  {
    nombre: 'Alertas visuales',
    tabla: 'alertas',
    columnas: 'id,tipo_alerta,nivel,mensaje,estado',
    detalle: 'Revisa si las alertas pueden mostrarse y cambiar entre operativas e historial.',
  },
  {
    nombre: 'Semaforo operativo',
    tabla: 'materiales',
    columnas: 'id,stock_actual,stock_minimo,codigo_material',
    detalle: 'Valida los datos usados para pintar rojo, amarillo o verde en inventario y pedidos.',
  },
  {
    nombre: 'Inventario operativo',
    tabla: 'inventario_bodega',
    columnas: 'codigo_material,stock_disponible,stock_libre_utilizacion,bloqueado',
    detalle: 'Confirma que el stock real de bodega este disponible para descuentos y alertas.',
  },
  {
    nombre: 'Reportes operativos',
    tabla: 'reportes_operativos',
    columnas: 'id,titulo,tipo,prioridad,estado',
    detalle: 'Valida reportes internos generados desde el modulo Reportes.',
  },
]

export default function EstadoSistema() {
  const [resultados, setResultados] = useState<RevisionSistema[]>([])
  const [cargando, setCargando] = useState(true)

  async function revisarSistema() {
    setCargando(true)

    const checks = await Promise.all(
      revisiones.map(async (revision) => {
        const { error } = await supabase
          .from(revision.tabla)
          .select(revision.columnas)
          .limit(1)

        return {
          nombre: revision.nombre,
          detalle: revision.detalle,
          ok: !error,
          mensaje: error ? error.message : 'Funcionando correctamente.',
        }
      })
    )

    setResultados(checks)
    setCargando(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(revisarSistema, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [])

  const resumen = useMemo(() => {
    const ok = resultados.filter((resultado) => resultado.ok).length
    return { ok, total: resultados.length, todoOk: ok === resultados.length && resultados.length > 0 }
  }, [resultados])

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Estado del sistema</h1>
          <p className="mt-1 text-slate-500">
            Valida si los modulos principales estan funcionando correctamente.
          </p>
        </div>
        <button
          type="button"
          onClick={revisarSistema}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <RefreshCw size={16} />
          Revisar
        </button>
      </div>

      <section
        className={`mt-6 rounded-lg border p-5 shadow-sm ${
          resumen.todoOk
            ? 'border-green-200 bg-green-50'
            : 'border-amber-200 bg-amber-50'
        }`}
      >
        <p className={resumen.todoOk ? 'text-sm text-green-700' : 'text-sm text-amber-700'}>
          Resultado general
        </p>
        <strong
          className={`mt-2 block text-3xl ${
            resumen.todoOk ? 'text-green-900' : 'text-amber-900'
          }`}
        >
          {cargando ? '-' : `${resumen.ok}/${resumen.total}`}
        </strong>
        <p className={resumen.todoOk ? 'mt-3 text-sm text-green-800' : 'mt-3 text-sm text-amber-800'}>
          {resumen.todoOk
            ? 'La base de datos y los modulos operativos responden correctamente.'
            : 'Hay una revision con problema. Revisa el detalle antes de operar.'}
        </p>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {resultados.map((resultado) => (
          <article
            key={resultado.nombre}
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-800">{resultado.nombre}</h2>
                <p className="mt-1 text-sm text-slate-500">{resultado.detalle}</p>
              </div>
              {resultado.ok ? (
                <CheckCircle2 className="text-green-600" size={22} />
              ) : (
                <XCircle className="text-red-600" size={22} />
              )}
            </div>
            <p
              className={`mt-4 rounded-lg px-3 py-2 text-sm ${
                resultado.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {resultado.mensaje}
            </p>
          </article>
        ))}
      </div>
    </div>
  )
}
