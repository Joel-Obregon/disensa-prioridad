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
    nombre: 'Usuarios',
    tabla: 'usuarios_app',
    columnas: 'id,nombre,correo,rol,estado',
    detalle: 'Perfiles internos conectados a Supabase Auth.',
  },
  {
    nombre: 'Centros de bodega',
    tabla: 'centros_bodega',
    columnas: 'centro_codigo,centro_nombre',
    detalle: 'Centros operativos importados desde las bases actuales.',
  },
  {
    nombre: 'Clientes franquiciado',
    tabla: 'clientes_franquiciado',
    columnas: 'codigo_cliente,nombre_cliente,zona',
    detalle: 'Clientes, zonas y codigos usados para pedidos y consulta invitada.',
  },
  {
    nombre: 'Proveedores operativos',
    tabla: 'proveedores_operativos',
    columnas: 'codigo_proveedor,nombre_proveedor',
    detalle: 'Suministradores conectados desde OC pendientes y transito.',
  },
  {
    nombre: 'Materiales',
    tabla: 'material_catalogo',
    columnas: 'codigo_material,nombre_material,numero_fb',
    detalle: 'Catalogo de materiales deduplicado.',
  },
  {
    nombre: 'Inventario bodega',
    tabla: 'inventario_bodega',
    columnas: 'centro_codigo,codigo_material,stock_libre_utilizacion,bloqueado,stock_disponible',
    detalle: 'Stock fisico y disponible de la bodega, fuente real para inventario.',
  },
  {
    nombre: 'Inventario visible',
    tabla: 'materiales',
    columnas: 'id,nombre,categoria,stock_actual,stock_minimo,unidad_medida',
    detalle: 'Materiales adaptados para inventario, demanda pendiente y alertas visuales.',
  },
  {
    nombre: 'Pedidos bodega-franquiciado',
    tabla: 'pedidos_bodega_fq',
    columnas: 'pedido_key,cod_pedido,codigo_material,codigo_cliente,cantidad,fecha_limite',
    detalle: 'Base operativa principal de pendientes hacia franquiciados.',
  },
  {
    nombre: 'Pedidos priorizados',
    tabla: 'pedidos',
    columnas: 'id,codigo,material,cantidad,cantidad_despacho,estado,prioridad_calculada',
    detalle: 'Cola de pedidos usada por Dashboard, Pedidos, Calendario y consulta invitada.',
  },
  {
    nombre: 'OC pendientes',
    tabla: 'oc_pendientes_bodega',
    columnas: 'oc_linea_key,documento_compras,codigo_material,cantidad_por_entregar',
    detalle: 'Reabastecimiento pendiente desde suministrador a bodega.',
  },
  {
    nombre: 'Transito bodega',
    tabla: 'transito_bodega',
    columnas: 'transito_linea_key,documento_compras,codigo_material,cantidad_por_entregar',
    detalle: 'Mercancia en camino o con movimiento hacia bodega.',
  },
  {
    nombre: 'Vista inventario operativo',
    tabla: 'materiales_operativos_v',
    columnas: 'codigo_material,nombre_material,stock_disponible,stock_transito,cantidad_oc_pendiente',
    detalle: 'Cruce de inventario, pedidos, OC y transito por codigo de material.',
  },
  {
    nombre: 'Vista detalle pedidos',
    tabla: 'pedido_detalle_operativo_v',
    columnas: 'codigo_pedido,codigo_consulta,codigo_material,stock_disponible_real,reabastecimiento_pendiente',
    detalle: 'Detalle enriquecido que usa el modulo Pedidos.',
  },
  {
    nombre: 'Vista OTIF',
    tabla: 'otif_operativo_v',
    columnas: 'suministrador_bodega_valor,bodega_franquiciado_valor',
    detalle: 'Cumplimiento OTIF para proveedor-bodega y bodega-franquiciado.',
  },
  {
    nombre: 'Reglas',
    tabla: 'reglas_negocio',
    columnas: 'id,nombre,criterio,efecto,peso,estado',
    detalle: 'Motor de reglas para priorizacion del prototipo de tesis.',
  },
  {
    nombre: 'Alertas visuales',
    tabla: 'alertas',
    columnas: 'id,pedido_id,material_id,tipo_alerta,nivel,mensaje,estado',
    detalle: 'Alertas operativas de stock, NC, prioridad y sincronizacion.',
  },
  {
    nombre: 'Reportes',
    tabla: 'reportes_operativos',
    columnas: 'id,titulo,tipo,prioridad,estado,rol_origen',
    detalle: 'Reportes internos compartidos entre roles.',
  },
  {
    nombre: 'Reportes franquiciado',
    tabla: 'reportes_franquiciado',
    columnas: 'id,pedido_id,codigo_consulta,cedula_solicitante,motivo,estado',
    detalle: 'Novedades creadas desde la consulta invitada.',
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
    const ok = resultados.filter((resultado) => resultado.ok).length
    return { ok, total: resultados.length }
  }, [resultados])

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
        <strong className="mt-2 block text-3xl text-slate-900">
          {cargando ? '-' : `${resumen.ok}/${resumen.total}`}
        </strong>
        <p className="mt-3 text-sm text-slate-600">
          Si algo aparece con error, ejecuta los SQL pendientes en Supabase.
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
