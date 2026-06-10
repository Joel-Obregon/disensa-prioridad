import { type ChangeEvent, useState } from 'react'
import { FileUp, Upload } from 'lucide-react'
import { crearMaterial, obtenerMateriales } from '../services/materialesService'
import { crearPedido } from '../services/pedidosService'
import type { Material } from '../types/material'
import type { AccionSolicitante, CondicionMaterial, UrgenciaPedido } from '../types/pedido'

type TipoCarga = 'materiales' | 'pedidos'

type ResultadoCarga = {
  correctos: number
  errores: string[]
}

export default function CargaMasiva() {
  const [tipo, setTipo] = useState<TipoCarga>('materiales')
  const [archivo, setArchivo] = useState('')
  const [cargando, setCargando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoCarga | null>(null)
  const [error, setError] = useState('')

  async function procesarArchivo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setResultado(null)
    setError('')

    if (!file) return
    setArchivo(file.name)
    setCargando(true)

    try {
      const texto = await file.text()
      const filas = parseCsv(texto)

      if (filas.length === 0) {
        setError('El archivo no tiene filas validas.')
        setCargando(false)
        return
      }

      const respuesta =
        tipo === 'materiales'
          ? await cargarMateriales(filas)
          : await cargarPedidos(filas)

      setResultado(respuesta)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo procesar el archivo.')
    } finally {
      setCargando(false)
      event.target.value = ''
    }
  }

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Carga masiva</h1>
        <p className="mt-1 text-slate-500">
          Importa materiales o pedidos desde CSV exportado desde Excel.
        </p>
      </div>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[16rem_1fr]">
          <label className="text-sm font-medium text-slate-700">
            Tipo de carga
            <select
              value={tipo}
              onChange={(event) => setTipo(event.target.value as TipoCarga)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="materiales">Materiales</option>
              <option value="pedidos">Pedidos</option>
            </select>
          </label>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center transition hover:bg-slate-100">
            <Upload size={26} className="text-orange-600" />
            <span className="mt-3 font-semibold text-slate-800">
              {cargando ? 'Procesando...' : 'Seleccionar archivo CSV'}
            </span>
            <span className="mt-1 text-sm text-slate-500">
              {archivo || 'Usa encabezados compatibles con el tipo seleccionado.'}
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={cargando}
              onChange={procesarArchivo}
              className="hidden"
            />
          </label>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {resultado && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <p className="font-semibold">{resultado.correctos} registros cargados.</p>
            {resultado.errores.length > 0 && (
              <div className="mt-3 rounded-lg bg-white/70 p-3 text-amber-800">
                <p className="font-semibold">Filas con observaciones:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {resultado.errores.slice(0, 8).map((mensaje) => (
                    <li key={mensaje}>{mensaje}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FormatoCsv
          titulo="Formato materiales"
          encabezado="nombre,categoria,stock_actual,stock_minimo,unidad_medida"
          ejemplo="Cemento Holcim 50kg,Cemento,80,40,sacos"
        />
        <FormatoCsv
          titulo="Formato pedidos"
          encabezado="material,cantidad,solicitante,cedula_solicitante,fecha_compromiso,urgencia,tipo_cliente,accion_solicitante,condicion_material,origen,destino"
          ejemplo="Cemento Holcim 50kg,20,Disensa Daule,0912345678,2026-05-30T10:00,alta,franquiciado,despachar,urgente_despacho,bodega,franquiciado"
        />
      </section>
    </div>
  )
}

function FormatoCsv({
  ejemplo,
  encabezado,
  titulo,
}: {
  ejemplo: string
  encabezado: string
  titulo: string
}) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 font-semibold text-slate-800">
        <FileUp size={18} className="text-orange-600" />
        {titulo}
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-4 text-sm text-slate-100">
        <pre>{encabezado}</pre>
        <pre className="mt-2 text-slate-300">{ejemplo}</pre>
      </div>
    </article>
  )
}

async function cargarMateriales(filas: Array<Record<string, string>>) {
  const resultado: ResultadoCarga = { correctos: 0, errores: [] }

  for (const [index, fila] of filas.entries()) {
    const stockActual = Number(fila.stock_actual)
    const stockMinimo = Number(fila.stock_minimo)

    if (!fila.nombre || !fila.categoria || !fila.unidad_medida || Number.isNaN(stockActual)) {
      resultado.errores.push(`Fila ${index + 2}: material incompleto.`)
      continue
    }

    const { error } = await crearMaterial({
      nombre: fila.nombre.trim(),
      categoria: fila.categoria.trim(),
      stock_actual: stockActual,
      stock_minimo: Number.isNaN(stockMinimo) ? 0 : stockMinimo,
      unidad_medida: fila.unidad_medida.trim(),
      es_critico: false,
    })

    if (error) resultado.errores.push(`Fila ${index + 2}: ${error.message}`)
    else resultado.correctos += 1
  }

  return resultado
}

async function cargarPedidos(filas: Array<Record<string, string>>) {
  const resultado: ResultadoCarga = { correctos: 0, errores: [] }
  const { data: materiales } = await obtenerMateriales()
  const catalogo = new Map<string, Material>()

  ;(materiales || []).forEach((material) => {
    catalogo.set(normalizarTexto(material.nombre), material)
  })

  for (const [index, fila] of filas.entries()) {
    const material = catalogo.get(normalizarTexto(fila.material || ''))
    const cantidad = Number(fila.cantidad)
    const cedula = normalizarCedula(fila.cedula_solicitante || fila.cedula || '')

    if (!material || !fila.solicitante || cedula.length < 10 || Number.isNaN(cantidad) || cantidad <= 0) {
      resultado.errores.push(`Fila ${index + 2}: pedido incompleto o material no encontrado.`)
      continue
    }

    const { error } = await crearPedido({
      codigo: `PED-${Date.now().toString().slice(-6)}-${index + 1}`,
      material_id: material.id,
      material: material.nombre,
      cantidad,
      cantidad_despacho: cantidad,
      unidad_medida: material.unidad_medida,
      stock_disponible: material.stock_actual,
      origen: validarOrigen(fila.origen),
      destino: validarDestino(fila.destino),
      solicitante: fila.solicitante.trim(),
      cedula_solicitante: cedula,
      fecha_compromiso: fila.fecha_compromiso || new Date().toISOString(),
      urgencia: validarUrgencia(fila.urgencia),
      tipo_cliente: validarTipoCliente(fila.tipo_cliente),
      accion_solicitante: validarAccion(fila.accion_solicitante),
      condicion_material: validarCondicion(fila.condicion_material),
    })

    if (error) resultado.errores.push(`Fila ${index + 2}: ${error.message}`)
    else resultado.correctos += 1
  }

  return resultado
}

function parseCsv(texto: string) {
  const lineas = texto.split(/\r?\n/).filter((linea) => linea.trim())
  const [encabezado, ...datos] = lineas

  if (!encabezado) return []

  const columnas = splitCsvLine(encabezado).map((item) => normalizarTexto(item))

  return datos.map((linea) => {
    const valores = splitCsvLine(linea)
    return columnas.reduce<Record<string, string>>((fila, columna, index) => {
      fila[columna] = valores[index]?.trim() || ''
      return fila
    }, {})
  })
}

function splitCsvLine(linea: string) {
  const valores: string[] = []
  let actual = ''
  let enComillas = false

  for (let index = 0; index < linea.length; index += 1) {
    const char = linea[index]
    const siguiente = linea[index + 1]

    if (char === '"' && siguiente === '"') {
      actual += '"'
      index += 1
    } else if (char === '"') {
      enComillas = !enComillas
    } else if (char === ',' && !enComillas) {
      valores.push(actual)
      actual = ''
    } else {
      actual += char
    }
  }

  valores.push(actual)
  return valores
}

function validarUrgencia(valor: string): UrgenciaPedido {
  if (['baja', 'media', 'alta', 'critica'].includes(valor)) return valor as UrgenciaPedido
  return 'media'
}

function validarAccion(valor: string): AccionSolicitante {
  if (['despachar', 'nota_credito', 'esperar_pedido'].includes(valor)) {
    return valor as AccionSolicitante
  }
  return 'despachar'
}

function validarCondicion(valor: string): CondicionMaterial {
  if (
    ['normal', 'no_planificable', 'restrictivo', 'urgente_despacho', 'caducidad'].includes(
      valor
    )
  ) {
    return valor as CondicionMaterial
  }
  return 'normal'
}

function validarOrigen(valor: string) {
  return valor === 'suministrador' ? 'suministrador' : 'bodega'
}

function validarDestino(valor: string) {
  return valor === 'bodega' ? 'bodega' : 'franquiciado'
}

function validarTipoCliente(valor: string) {
  if (['bodega', 'franquiciado', 'obra_critica'].includes(valor)) {
    return valor as 'bodega' | 'franquiciado' | 'obra_critica'
  }
  return 'franquiciado'
}

function normalizarTexto(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function normalizarCedula(valor: string) {
  return valor.replace(/\D/g, '').trim()
}
