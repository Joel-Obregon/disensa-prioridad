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
    nombre: 'Proveedores',
    tabla: 'proveedores',
    columnas: 'id,nombre,contacto_email,contacto_telefono',
    detalle: 'Catalogo de proveedores importados desde el Excel.',
  },
  {
    nombre: 'Materiales',
    tabla: 'material_catalogo',
    columnas: 'codigo_material,nombre_material,numero_fb',
    detalle: 'Catalogo de materiales deduplicado.',
  },
  {
    nombre: 'Inventario prototipo',
    tabla: 'materiales',
    columnas: 'id,nombre,categoria,stock_actual,stock_minimo,unidad_medida',
    detalle: 'Materiales adaptados para inventario, demanda pendiente y alertas visuales.',
  },
  {
    nombre: 'Pedidos ERP',
    tabla: 'pedidos_erp',
    columnas: 'id,numero_pedido,status_erp,estado_operativo,valor_pendiente',
    detalle: 'Cabecera ERP normalizada para el sistema nuevo.',
  },
  {
    nombre: 'Pedidos priorizados',
    tabla: 'pedidos',
    columnas: 'id,codigo,material,cantidad,cantidad_despacho,estado,prioridad_calculada',
    detalle: 'Cola de pedidos usada por Dashboard, Pedidos, Calendario y consulta invitada.',
  },
  {
    nombre: 'Lineas ERP',
    tabla: 'pedido_lineas',
    columnas: 'id,linea_key,pedido_id,codigo_material,cantidad_pedido,cantidad_pendiente',
    detalle: 'Detalle de materiales por pedido ERP.',
  },
  {
    nombre: 'Gestiones',
    tabla: 'gestiones_pedido',
    columnas: 'respuesta_id,pedido_id,status_gestion,motivo_gestion',
    detalle: 'Respuestas y seguimiento operativo de proveedores.',
  },
  {
    nombre: 'Notas de credito',
    tabla: 'notas_credito',
    columnas: 'nc_id,pedido_id,motivo_nc,estado_nc',
    detalle: 'Flujo de notas de credito importado desde el Excel.',
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
