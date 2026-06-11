import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react'
import { supabase } from '../services/supabaseClient'

type RevisionSistema = {
  nombre: string
  detalle: string
  categoria: CategoriaRevision
  ok: boolean
  mensaje: string
}

type CategoriaRevision = 'nucleo' | 'conexion'

const revisiones = [
  {
    nombre: 'Usuarios',
    categoria: 'nucleo',
    tabla: 'usuarios_app',
    columnas: 'id,nombre,correo,rol,estado',
    detalle: 'Perfiles internos conectados a Supabase Auth.',
  },
  {
    nombre: 'Inventario visible',
    categoria: 'nucleo',
    tabla: 'materiales',
    columnas: 'id,nombre,categoria,stock_actual,stock_minimo,unidad_medida',
    detalle: 'Materiales adaptados para inventario, demanda pendiente y alertas visuales.',
  },
  {
    nombre: 'Pedidos bodega-franquiciado',
    categoria: 'conexion',
    tabla: 'pedidos_bodega_fq',
    columnas: 'pedido_key,cod_pedido,codigo_material,codigo_cliente,cantidad,fecha_limite',
    detalle: 'Base operativa principal de pendientes hacia franquiciados.',
  },
  {
    nombre: 'Vista inventario operativo',
    categoria: 'nucleo',
    tabla: 'materiales_operativos_v',
    columnas: 'codigo_material,nombre_material,stock_disponible,stock_transito,cantidad_oc_pendiente',
    detalle: 'Cruce de inventario, pedidos, OC y transito por codigo de material.',
  },
  {
    nombre: 'Vista detalle pedidos',
    categoria: 'nucleo',
    tabla: 'pedido_detalle_operativo_v',
    columnas: 'codigo_pedido,codigo_consulta,codigo_material,stock_disponible_real,reabastecimiento_pendiente',
    detalle: 'Detalle enriquecido que usa el modulo Pedidos.',
  },
  {
    nombre: 'Pedidos priorizados',
    categoria: 'nucleo',
    tabla: 'pedidos',
    columnas: 'id,codigo,material,cantidad,cantidad_despacho,estado,prioridad_calculada',
    detalle: 'Cola de pedidos usada por Dashboard, Pedidos, Calendario y consulta invitada.',
  },
  {
    nombre: 'Vista OTIF',
    categoria: 'nucleo',
    tabla: 'otif_operativo_v',
    columnas: 'suministrador_bodega_valor,bodega_franquiciado_valor',
    detalle: 'Cumplimiento OTIF para proveedor-bodega y bodega-franquiciado.',
  },
  {
    nombre: 'Reglas',
    categoria: 'nucleo',
    tabla: 'reglas_negocio',
    columnas: 'id,nombre,criterio,efecto,peso,estado',
    detalle: 'Motor de reglas para priorizacion del prototipo de tesis.',
  },
  {
    nombre: 'Inventario bodega',
    categoria: 'conexion',
    tabla: 'inventario_bodega',
    columnas: 'centro_codigo,codigo_material,stock_libre_utilizacion,bloqueado,stock_disponible',
    detalle: 'Fuente real del stock operativo importado desde Excel.',
  },
  {
    nombre: 'OC pendientes',
    categoria: 'conexion',
    tabla: 'oc_pendientes_bodega',
    columnas: 'oc_linea_key,documento_compras,codigo_material,cantidad_por_entregar',
    detalle: 'Fuente principal del reabastecimiento pendiente.',
  },
  {
    nombre: 'Alertas visuales',
    categoria: 'nucleo',
    tabla: 'alertas',
    columnas: 'id,pedido_id,material_id,tipo_alerta,nivel,mensaje,estado',
    detalle: 'Alertas operativas de stock, NC, prioridad y sincronizacion.',
  },
  {
    nombre: 'Reportes',
    categoria: 'nucleo',
    tabla: 'reportes_operativos',
    columnas: 'id,titulo,tipo,prioridad,estado,rol_origen',
    detalle: 'Reportes internos compartidos entre roles.',
  },
  {
    nombre: 'Reportes franquiciado',
    categoria: 'nucleo',
    tabla: 'reportes_franquiciado',
    columnas: 'id,pedido_id,codigo_consulta,cedula_solicitante,motivo,estado',
    detalle: 'Novedades creadas desde la consulta invitada.',
  },
] satisfies Array<{
  nombre: string
  categoria: CategoriaRevision
  tabla: string
  columnas: string
  detalle: string
}>

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
          categoria: revision.categoria,
          ok: !error,
          mensaje: error ? error.message : 'Conectado y visible para la app.',
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
    const nucleo = resultados.filter((resultado) => resultado.categoria === 'nucleo')
    const conexion = resultados.filter((resultado) => resultado.categoria === 'conexion')

    return {
      nucleo: {
        ok: nucleo.filter((resultado) => resultado.ok).length,
        total: nucleo.length,
      },
      conexion: {
        ok: conexion.filter((resultado) => resultado.ok).length,
        total: conexion.length,
      },
      total: {
        ok: resultados.filter((resultado) => resultado.ok).length,
        total: resultados.length,
      },
    }
  }, [resultados])

  const grupos = useMemo(
    () => [
      {
        id: 'nucleo' as CategoriaRevision,
        titulo: 'Nucleo de la aplicacion',
        detalle: 'Lo minimo que debe responder para usar login, pedidos, inventario, alertas, reglas y reportes.',
      },
      {
        id: 'conexion' as CategoriaRevision,
        titulo: 'Datos operativos importados',
        detalle: 'Fuentes minimas que sostienen stock, pedidos pendientes y reabastecimiento.',
      },
    ],
    []
  )

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Estado del sistema</h1>
          <p className="mt-1 text-slate-500">
            Valida tablas, columnas y permisos que necesita la aplicacion.
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

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">Resultado general</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <IndicadorEstado
            cargando={cargando}
            etiqueta="Nucleo"
            ok={resumen.nucleo.ok}
            total={resumen.nucleo.total}
          />
          <IndicadorEstado
            cargando={cargando}
            etiqueta="Bases Excel"
            ok={resumen.conexion.ok}
            total={resumen.conexion.total}
          />
          <IndicadorEstado
            cargando={cargando}
            etiqueta="Total tecnico"
            ok={resumen.total.ok}
            total={resumen.total.total}
          />
        </div>
        <p className="mt-3 text-sm text-slate-600">
          El nucleo indica si el prototipo puede operar. Las bases Excel validan que la
          sincronizacion completa siga coherente.
        </p>
      </section>

      {grupos.map((grupo) => {
        const resultadosGrupo = resultados.filter((resultado) => resultado.categoria === grupo.id)

        return (
          <section key={grupo.id} className="mt-6">
            <div>
              <h2 className="text-lg font-bold text-slate-800">{grupo.titulo}</h2>
              <p className="mt-1 text-sm text-slate-500">{grupo.detalle}</p>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {resultadosGrupo.map((resultado) => (
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
          </section>
        )
      })}
    </div>
  )
}

function IndicadorEstado({
  cargando,
  etiqueta,
  ok,
  total,
}: {
  cargando: boolean
  etiqueta: string
  ok: number
  total: number
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {etiqueta}
      </p>
      <strong className="mt-1 block text-2xl text-slate-900">
        {cargando ? '-' : `${ok}/${total}`}
      </strong>
    </div>
  )
}
