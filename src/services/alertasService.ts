import { supabase } from './supabaseClient'
import {
  consultarConCache,
  crearNotificadorCambios,
  invalidarCache,
} from './cacheService'
import type { Alerta } from '../types/alerta'
import type { InventarioOperativo } from '../types/material'
import { obtenerInventarioOperativo } from './inventarioService'
import { diasRetrasoPedido } from '../lib/semaforoOperativo'
import { sincronizarAlertaStockMaterial } from './stockAlertasService'

type PedidoParaAlerta = {
  id: string
  codigo: string | null
  codigo_consulta?: string | null
  estado: string | null
  fecha_compromiso: string | null
  fecha_solicitud?: string | null
  stock_disponible: number | null
  cantidad: number | null
  cantidad_despacho?: number | null
  cantidad_despachada?: number | null
  material: string | null
  unidad_medida?: string | null
  origen?: string | null
  destino?: string | null
  solicitante?: string | null
  cedula_solicitante?: string | null
  urgencia?: string | null
  tipo_cliente?: string | null
  accion_solicitante?: string | null
  condicion_material?: string | null
  prioridad_calculada?: number | null
  despachado_at?: string | null
  despachado_por?: string | null
}

type MaterialParaAlerta = {
  id: string
  codigo_material?: string | null
  nombre: string | null
  stock_actual: number | string | null
  stock_minimo: number | string | null
}

type InventarioParaAlerta = {
  codigo_material: string | null
  nombre_material: string | null
  stock_disponible: number | string | null
  demanda_bodega_fq?: number | string | null
  pedido_maximo_material?: number | string | null
  stock_objetivo_material?: number | string | null
}

type AlertaStockExistente = Pick<Alerta, 'id' | 'nivel' | 'estado' | 'mensaje'>

type ContextoPedidosAlertas = {
  pedidos: PedidoParaAlerta[]
  pedidosPorCodigo: Map<string, PedidoParaAlerta>
  pedidosPorId: Map<string, PedidoParaAlerta>
}

type ContextoMaterialesAlertas = {
  inventarioPorCodigo: Map<string, InventarioParaAlerta>
  inventarioPorNombre: Map<string, InventarioParaAlerta>
  materialesPorCodigo: Map<string, MaterialParaAlerta>
  materialesPorId: Map<string, MaterialParaAlerta>
  materialesPorNombre: Map<string, MaterialParaAlerta>
}

type ContextoAlertas = ContextoPedidosAlertas & ContextoMaterialesAlertas

const TIPOS_ALERTA_STOCK = new Set([
  'stock_bajo',
  'faltante_bodega_fq',
  'falta_material_pedido',
  'stock_agotado_planificable',
  'transito_cubre_pedido',
])

const INTERVALO_SYNC_STOCK_ALERTAS_MS = 300000
const TAMANO_LOTE_SYNC_STOCK = 25
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PREFIJO_ALERTA_STOCK_DERIVADA = 'stock-operativo-'
const RESPONSABLE_SYNC_STOCK = 'Sincronizacion automatica de inventario'

let ultimaSincronizacionStockAlertas = 0
let sincronizacionStockAlertasActual: Promise<void> | null = null

type ObtenerAlertasOpciones = {
  incluirStockDerivado?: boolean
  sincronizarStock?: boolean
}

export async function obtenerAlertas(opciones: ObtenerAlertasOpciones = {}) {
  const incluirStockDerivado = opciones.incluirStockDerivado ?? true

  if (opciones.sincronizarStock) {
    await sincronizarAlertasOperativas()
    invalidarCache('alertas')
  }

  return consultarConCache(
    `alertas:lista:${incluirStockDerivado ? 'con-stock' : 'base'}`,
    incluirStockDerivado ? 8_000 : 12_000,
    () => cargarAlertasDesdeSupabase(incluirStockDerivado)
  )
}

async function cargarAlertasDesdeSupabase(incluirStockDerivado: boolean) {
  // Supabase limita cada consulta a 1000 filas. Si se pide todo junto ordenado
  // por fecha, las alertas activas antiguas (p. ej. retrasos de hace semanas)
  // quedan fuera del corte. Por eso se piden por separado: TODAS las abiertas
  // (activas/revisadas) mas un historial reciente de cerradas.
  const [abiertas, cerradas] = await Promise.all([
    supabase
      .from('alertas')
      .select('*')
      .in('estado', ['activa', 'revisada'])
      .order('created_at', { ascending: false })
      .limit(1000)
      .returns<Alerta[]>(),
    supabase
      .from('alertas')
      .select('*')
      .eq('estado', 'cerrada')
      .order('created_at', { ascending: false })
      .limit(400)
      .returns<Alerta[]>(),
  ])

  const result = abiertas.error
    ? abiertas
    : { ...abiertas, data: [...(abiertas.data || []), ...(cerradas.data || [])] }

  if (result.error) return result

  const depuradas = result.data?.length ? await normalizarAlertasConContexto(result.data) : []
  const derivadas = incluirStockDerivado ? await obtenerAlertasStockDerivadasInventario() : []

  return { ...result, data: mezclarAlertasConStockDerivado(depuradas, derivadas) }
}

async function sincronizarAlertasResueltasPorStock() {
  const result = await supabase.rpc('sincronizar_alertas_resueltas_por_stock')

  return result
}

async function sincronizarAlertasOperativas() {
  await sincronizarAlertasResueltasPorStock()
  await sincronizarAlertasStockInventarioActual()
  await evaluarReglasNegocio()
}

// Evalua las reglas de negocio avanzadas (inventario por agotarse, multifranquiciado,
// material no planificable, franquiciado alta frecuencia) y genera/cierra sus alertas.
// Si la funcion aun no existe en la BD, se ignora silenciosamente.
async function evaluarReglasNegocio() {
  const result = await supabase.rpc('evaluar_reglas_negocio_avanzadas')
  if (
    result.error &&
    (result.error.code === '42883' ||
      result.error.code === 'PGRST202' ||
      result.error.message?.toLowerCase().includes('could not find the function'))
  ) {
    return { data: null, error: null }
  }
  return result
}

async function sincronizarAlertasStockInventarioActual() {
  const ahora = Date.now()

  if (sincronizacionStockAlertasActual) return sincronizacionStockAlertasActual
  if (ahora - ultimaSincronizacionStockAlertas < INTERVALO_SYNC_STOCK_ALERTAS_MS) return

  sincronizacionStockAlertasActual = (async () => {
    const inventarioResult = await obtenerInventarioOperativo()
    if (inventarioResult.error) return

    const materiales = materialesInventarioUnicos(inventarioResult.data || []).filter(
      (material) => nivelStockInventario(material) !== null
    )

    for (let index = 0; index < materiales.length; index += TAMANO_LOTE_SYNC_STOCK) {
      const lote = materiales.slice(index, index + TAMANO_LOTE_SYNC_STOCK)

      await Promise.all(
        lote.map(async (material) => {
          if (!esUuid(material.id)) {
            // Materiales solo de inventario (sin uuid): la interfaz ya muestra su
            // alerta derivada en memoria. Persistirla generaba un bucle de
            // crear/cerrar que inundaba la tabla y ocultaba las alertas reales.
            return
          }

          await cerrarAlertasStockPorReferencia(material)

          const result = await sincronizarAlertaStockMaterial(
            {
              id: material.id,
              codigo_material: material.codigo_material,
              nombre: material.nombre,
              stock_actual: material.stock_disponible_operativo,
              stock_minimo: umbralMinimoInventario(material),
              pedido_maximo_material: material.pedido_maximo_material,
              stock_objetivo_material: umbralNormalInventario(material),
              demanda_bodega_fq: material.demanda_bodega_fq,
            },
            Math.max(0, material.stock_disponible_operativo),
            { emitir: false, responsable: RESPONSABLE_SYNC_STOCK }
          )

          if (result.error) {
            // La lectura de alertas no debe romperse por una fila puntual con permisos o datos antiguos.
            return
          }
        })
      )
    }

    ultimaSincronizacionStockAlertas = Date.now()
  })()

  try {
    await sincronizacionStockAlertasActual
  } finally {
    sincronizacionStockAlertasActual = null
  }
}

export async function obtenerUltimaAlertaVisualActiva() {
  return consultarConCache('alertas:visual:ultima', 4_000, async () => {
    const result = await supabase
      .from('alertas')
      .select('*')
      .eq('estado', 'activa')
      .in('nivel', ['critica', 'alta', 'media'])
      .order('created_at', { ascending: false })
      .limit(20)
      .returns<Alerta[]>()

    if (result.error) return result

    const depuradas = result.data?.length ? await normalizarAlertasConContexto(result.data) : []

    return {
      ...result,
      data: depuradas.filter(alertaVisualVigente).sort(ordenarAlertasRecientes).slice(0, 1),
    }
  })
}

export async function obtenerAlertasVisualesActivas(limite = 100) {
  return consultarConCache(`alertas:visual:activas:${limite}`, 4_000, async () => {
    const result = await supabase
      .from('alertas')
      .select('*')
      .eq('estado', 'activa')
      .neq('nivel', 'informativa')
      .order('created_at', { ascending: false })
      .limit(limite)
      .returns<Alerta[]>()

    if (result.error) return result

    const depuradas = await normalizarAlertasConContexto(result.data || [])

    return {
      ...result,
      data: depuradas.filter(alertaVisualVigente),
    }
  })
}

export async function actualizarEstadoAlerta(id: string, estado: Alerta['estado']) {
  if (id.startsWith(PREFIJO_ALERTA_STOCK_DERIVADA)) {
    return { data: null, error: null }
  }

  const result = await supabase.from('alertas').update({ estado }).eq('id', id)

  if (!result.error) invalidarCache('alertas')
  return result
}

export function escucharCambiosAlertas(onChange: () => void) {
  const notificar = crearNotificadorCambios(onChange, ['alertas'])
  const channel = supabase
    .channel('alertas-cambios-tiempo-real')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'alertas',
      },
      notificar
    )
    .subscribe()

  return () => {
    notificar.cancelar()
    supabase.removeChannel(channel)
  }
}

export function escucharAlertas(onChange: (alerta: Alerta) => void) {
  const channel = supabase.channel('alertas-tiempo-real')

  channel.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'alertas',
    },
    (payload) => {
      const evento = 'eventType' in payload ? payload.eventType : null
      if (evento !== 'INSERT' && evento !== 'UPDATE') return

      if (!payload.new || !('id' in payload.new)) return
      invalidarCache('alertas')

      const alerta = normalizarAlerta(payload.new as Partial<Alerta>)
      const anterior = payload.old as Partial<Alerta> | undefined

      if (
        evento === 'UPDATE' &&
        anterior?.estado === alerta.estado &&
        anterior?.nivel === alerta.nivel &&
        anterior?.mensaje === alerta.mensaje
      ) {
        return
      }

      void normalizarAlertasConContexto([alerta]).then(([validada]) => {
        if (validada && (alertaVisualVigente(validada) || validada.estado === 'cerrada')) {
          onChange(validada)
        }
      })
    }
  )

  channel.subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

function normalizarAlerta(alerta: Partial<Alerta>): Alerta {
  return normalizarEstadoOperativoAlerta({
    id: alerta.id || crypto.randomUUID(),
    pedido_id: alerta.pedido_id || null,
    material_id: alerta.material_id || null,
    tipo_alerta: alerta.tipo_alerta || 'alerta_visual',
    nivel: alerta.nivel || 'informativa',
    mensaje: alerta.mensaje || 'Se recibio una nueva alerta del sistema.',
    estado: alerta.estado || 'activa',
    responsable: alerta.responsable || null,
    pedido_codigo: alerta.pedido_codigo || null,
    dias_sin_gestion: alerta.dias_sin_gestion || null,
    pedido_estado: alerta.pedido_estado || null,
    pedido_fecha_compromiso: alerta.pedido_fecha_compromiso || null,
    pedido_fecha_solicitud: alerta.pedido_fecha_solicitud || null,
    pedido_stock_disponible: alerta.pedido_stock_disponible ?? null,
    pedido_cantidad: alerta.pedido_cantidad ?? null,
    pedido_cantidad_despacho: alerta.pedido_cantidad_despacho ?? null,
    pedido_cantidad_despachada: alerta.pedido_cantidad_despachada ?? null,
    pedido_material: alerta.pedido_material || null,
    pedido_unidad_medida: alerta.pedido_unidad_medida || null,
    pedido_origen: alerta.pedido_origen || null,
    pedido_destino: alerta.pedido_destino || null,
    pedido_solicitante: alerta.pedido_solicitante || null,
    pedido_cedula_solicitante: alerta.pedido_cedula_solicitante || null,
    pedido_urgencia: alerta.pedido_urgencia || null,
    pedido_tipo_cliente: alerta.pedido_tipo_cliente || null,
    pedido_accion_solicitante: alerta.pedido_accion_solicitante || null,
    pedido_condicion_material: alerta.pedido_condicion_material || null,
    pedido_prioridad_calculada: alerta.pedido_prioridad_calculada ?? null,
    pedido_despachado_at: alerta.pedido_despachado_at || null,
    pedido_despachado_por: alerta.pedido_despachado_por || null,
    created_at: alerta.created_at || new Date().toISOString(),
  })
}

async function normalizarAlertasConContexto(alertas: Alerta[]) {
  const normalizadas = alertas.map(normalizarAlerta)
  const contextoPedidos = await obtenerContextoPedidosAlertas(normalizadas)
  const enriquecidas = enriquecerAlertasDesdePedidos(normalizadas, contextoPedidos)
  const contextoMateriales = await obtenerContextoMaterialesAlertas(enriquecidas)
  const contexto: ContextoAlertas = { ...contextoPedidos, ...contextoMateriales }
  const depuradas = enriquecidas.map((alerta) => normalizarVigenciaAlerta(alerta, contexto))
  const idsParaCerrar = depuradas
    .filter((alerta, index) => alerta.estado === 'cerrada' && normalizadas[index]?.estado !== 'cerrada')
    .map((alerta) => alerta.id)

  if (idsParaCerrar.length > 0) {
    void cerrarAlertasSinContexto(idsParaCerrar)
  }

  return depuradas
}

function normalizarVigenciaAlerta(alerta: Alerta, contexto: ContextoAlertas): Alerta {
  const base = normalizarEstadoOperativoAlerta(alerta)

  if (base.estado === 'cerrada') return base

  if (esAlertaMaterialSinInventario(base)) {
    if (materialTieneInventario(base, contexto)) return cerrarLocalmente(base)
    if (tieneReferenciaPedido(base) && !pedidoExiste(base, contexto)) return cerrarLocalmente(base)
    return base
  }

  if (esAlertaPedido(base) && !pedidoExiste(base, contexto)) {
    return cerrarLocalmente(base)
  }

  if (esAlertaStock(base)) {
    if (!materialExisteEnModuloInventario(base, contexto) && !pedidoExiste(base, contexto)) {
      return cerrarLocalmente(base)
    }

    if (stockResuelto(base, contexto)) return cerrarLocalmente(base)
  }

  if (esAlertaMaterial(base) && !materialExisteEnModuloInventario(base, contexto) && !pedidoExiste(base, contexto)) {
    return cerrarLocalmente(base)
  }

  if (!esAlertaPedido(base) && !esAlertaMaterial(base) && !tieneContextoOperativo(base, contexto)) {
    return cerrarLocalmente(base)
  }

  return base
}

function alertaVisualVigente(alerta: Alerta) {
  return alerta.estado === 'activa' && alerta.nivel !== 'informativa'
}

function cerrarLocalmente(alerta: Alerta): Alerta {
  return { ...alerta, estado: 'cerrada' }
}

async function cerrarAlertasSinContexto(ids: string[]) {
  const result = await supabase
    .from('alertas')
    .update({ estado: 'cerrada' })
    .in('id', ids)
    .in('estado', ['activa', 'revisada'])

  if (result.error) {
    // La vista ya queda depurada localmente; si Supabase bloquea la actualizacion,
    // no rompemos la experiencia del usuario.
    return
  }
}

function normalizarEstadoOperativoAlerta(alerta: Alerta): Alerta {
  if (
    alerta.estado !== 'cerrada' &&
    pedidoCerradoAlerta(alerta) &&
    !esAlertaReporteFranquiciado(alerta)
  ) {
    return { ...alerta, estado: 'cerrada' }
  }

  return alerta
}

// El texto de la alerta guarda los dias calculados por el servidor (UTC), que
// pueden diferir en 1 dia (o quedar viejos) frente al modulo de Pedidos. Antes
// de mostrarla se reescriben con el MISMO calculo local que usa Pedidos.
function sincronizarDiasRetrasoMensaje(
  mensaje: string | null | undefined,
  fechaCompromiso: string | null | undefined,
): string {
  const texto = mensaje || ''
  const retraso = diasRetrasoPedido(fechaCompromiso)
  if (retraso === null || retraso <= 0) return texto
  return texto.replace(/\d+\s*d(?:ias)?\s*de\s*retraso/gi, `${retraso} d de retraso`)
}

function pedidoCerradoAlerta(alerta: Pick<Alerta, 'pedido_estado'>) {
  return ['entregado', 'cancelado', 'rechazado', 'cerrado', 'gestion_cerrada'].includes(
    normalizarTexto(alerta.pedido_estado)
  )
}

function esAlertaReporteFranquiciado(alerta: Pick<Alerta, 'tipo_alerta' | 'mensaje'>) {
  const texto = `${alerta.tipo_alerta || ''} ${alerta.mensaje || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  return texto.includes('reporte_franquiciado') || texto.includes('reporte del franquiciado')
}

function enriquecerAlertasDesdePedidos(alertas: Alerta[], contexto: ContextoPedidosAlertas) {
  return alertas.map((alerta) => {
    const pedido =
      (alerta.pedido_id ? contexto.pedidosPorId.get(alerta.pedido_id) : null) ||
      pedidoPorCodigoAlerta(alerta, contexto)

    if (!pedido) return alerta

    return {
      ...alerta,
      pedido_codigo: alerta.pedido_codigo || pedido.codigo,
      pedido_estado: pedido.estado,
      pedido_fecha_compromiso: pedido.fecha_compromiso,
      mensaje: sincronizarDiasRetrasoMensaje(alerta.mensaje, pedido.fecha_compromiso),
      pedido_fecha_solicitud: pedido.fecha_solicitud || null,
      pedido_stock_disponible: pedido.stock_disponible,
      pedido_cantidad: pedido.cantidad,
      pedido_cantidad_despacho: pedido.cantidad_despacho || null,
      pedido_cantidad_despachada: pedido.cantidad_despachada || null,
      pedido_material: pedido.material,
      pedido_unidad_medida: pedido.unidad_medida || null,
      pedido_origen: pedido.origen || null,
      pedido_destino: pedido.destino || null,
      pedido_solicitante: pedido.solicitante || null,
      pedido_cedula_solicitante: pedido.cedula_solicitante || null,
      pedido_urgencia: pedido.urgencia || null,
      pedido_tipo_cliente: pedido.tipo_cliente || null,
      pedido_accion_solicitante: pedido.accion_solicitante || null,
      pedido_condicion_material: pedido.condicion_material || null,
      pedido_prioridad_calculada: pedido.prioridad_calculada || null,
      pedido_despachado_at: pedido.despachado_at || null,
      pedido_despachado_por: pedido.despachado_por || null,
    }
  })
}

async function obtenerContextoPedidosAlertas(alertas: Alerta[]): Promise<ContextoPedidosAlertas> {
  const pedidoIds = valoresUnicos(
    alertas
      .map((alerta) => alerta.pedido_id)
      .filter((pedidoId): pedidoId is string => Boolean(pedidoId))
  )
  const codigos = valoresUnicos(alertas.flatMap(codigosPedidoAlerta))
  const [porIds, porCodigo, porCodigoConsulta] = await Promise.all([
    consultarPedidosPorIds(pedidoIds),
    consultarPedidosPorCampo('codigo', codigos),
    consultarPedidosPorCampo('codigo_consulta', codigos),
  ])
  const pedidos = unirPorId([...porIds, ...porCodigo, ...porCodigoConsulta])
  const pedidosPorId = new Map(pedidos.map((pedido) => [pedido.id, pedido]))
  const pedidosPorCodigo = new Map<string, PedidoParaAlerta>()

  pedidos.forEach((pedido) => {
    ;[pedido.codigo, pedido.codigo_consulta].forEach((codigo) => {
      const llave = normalizarCodigo(codigo)
      if (llave) pedidosPorCodigo.set(llave, pedido)
    })
  })

  return { pedidos, pedidosPorCodigo, pedidosPorId }
}

async function consultarPedidosPorIds(pedidoIds: string[]) {
  if (pedidoIds.length === 0) return []

  const result = await supabase
    .from('pedidos')
    .select(camposPedidoAlerta())
    .in('id', pedidoIds)
    .returns<PedidoParaAlerta[]>()

  if (!result.error) return result.data || []

  if (result.error.code !== '42703') return []

  const fallback = await supabase
    .from('pedidos')
    .select('id,codigo,estado,fecha_compromiso,stock_disponible,cantidad,material')
    .in('id', pedidoIds)
    .returns<PedidoParaAlerta[]>()

  if (fallback.error) return []

  return fallback.data || []
}

async function consultarPedidosPorCampo(campo: 'codigo' | 'codigo_consulta', codigos: string[]) {
  if (codigos.length === 0) return []

  const result = await supabase
    .from('pedidos')
    .select(camposPedidoAlerta())
    .in(campo, codigos)
    .returns<PedidoParaAlerta[]>()

  if (!result.error) return result.data || []

  if (result.error.code !== '42703') return []

  const fallback = await supabase
    .from('pedidos')
    .select('id,codigo,estado,fecha_compromiso,stock_disponible,cantidad,material')
    .in(campo === 'codigo_consulta' ? 'codigo' : campo, codigos)
    .returns<PedidoParaAlerta[]>()

  return fallback.error ? [] : fallback.data || []
}

function camposPedidoAlerta() {
  return 'id,codigo,codigo_consulta,estado,fecha_solicitud,fecha_compromiso,stock_disponible,cantidad,cantidad_despacho,cantidad_despachada,material,unidad_medida,origen,destino,solicitante,cedula_solicitante,urgencia,tipo_cliente,accion_solicitante,condicion_material,prioridad_calculada,despachado_at,despachado_por'
}

async function obtenerContextoMaterialesAlertas(
  alertas: Alerta[]
): Promise<ContextoMaterialesAlertas> {
  const materialIds = valoresUnicos(
    alertas
      .map((alerta) => alerta.material_id)
      .filter((materialId): materialId is string => Boolean(materialId))
  )
  const codigos = valoresUnicos(alertas.flatMap(codigosMaterialAlerta))
  const nombres = valoresUnicos(
    alertas
      .map(nombreMaterialAlerta)
      .filter((nombre): nombre is string => Boolean(nombre))
  )
  const [materialesId, materialesCodigo, materialesNombre, inventarioCodigo, inventarioNombre] =
    await Promise.all([
      consultarMaterialesPorIds(materialIds),
      consultarMaterialesPorCampo('codigo_material', codigos),
      consultarMaterialesPorCampo('nombre', nombres),
      consultarInventarioPorCampo('codigo_material', codigos),
      consultarInventarioPorCampo('nombre_material', nombres),
    ])
  const materiales = unirPorId([...materialesId, ...materialesCodigo, ...materialesNombre])
  const inventario = unirInventario([...inventarioCodigo, ...inventarioNombre])
  const materialesPorId = new Map(materiales.map((material) => [material.id, material]))
  const materialesPorCodigo = new Map<string, MaterialParaAlerta>()
  const materialesPorNombre = new Map<string, MaterialParaAlerta>()
  const inventarioPorCodigo = new Map<string, InventarioParaAlerta>()
  const inventarioPorNombre = new Map<string, InventarioParaAlerta>()

  materiales.forEach((material) => {
    const codigo = normalizarCodigo(material.codigo_material)
    const nombre = normalizarTexto(material.nombre)

    if (codigo) materialesPorCodigo.set(codigo, material)
    if (nombre) materialesPorNombre.set(nombre, material)
  })

  inventario.forEach((material) => {
    const codigo = normalizarCodigo(material.codigo_material)
    const nombre = normalizarTexto(material.nombre_material)

    if (codigo) inventarioPorCodigo.set(codigo, material)
    if (nombre) inventarioPorNombre.set(nombre, material)
  })

  return {
    inventarioPorCodigo,
    inventarioPorNombre,
    materialesPorCodigo,
    materialesPorId,
    materialesPorNombre,
  }
}

async function consultarMaterialesPorIds(ids: string[]) {
  if (ids.length === 0) return []

  const result = await supabase
    .from('materiales')
    .select('id,codigo_material,nombre,stock_actual,stock_minimo')
    .in('id', ids)
    .returns<MaterialParaAlerta[]>()

  return result.error ? [] : result.data || []
}

async function consultarMaterialesPorCampo(
  campo: 'codigo_material' | 'nombre',
  valores: string[]
) {
  if (valores.length === 0) return []

  const result = await supabase
    .from('materiales')
    .select('id,codigo_material,nombre,stock_actual,stock_minimo')
    .in(campo, valores)
    .returns<MaterialParaAlerta[]>()

  return result.error ? [] : result.data || []
}

async function consultarInventarioPorCampo(
  campo: 'codigo_material' | 'nombre_material',
  valores: string[]
) {
  if (valores.length === 0) return []

  const result = await supabase
    .from('materiales_operativos_v')
    .select(
      'codigo_material,nombre_material,stock_disponible,demanda_bodega_fq,pedido_maximo_material,stock_objetivo_material'
    )
    .in(campo, valores)
    .returns<InventarioParaAlerta[]>()

  if (!result.error) return result.data || []

  if (result.error.code === '42P01') return []

  const fallback = await supabase
    .from('materiales_operativos_v')
    .select('codigo_material,nombre_material,stock_disponible,demanda_bodega_fq')
    .in(campo, valores)
    .returns<InventarioParaAlerta[]>()

  return fallback.error ? [] : fallback.data || []
}

function pedidoExiste(alerta: Alerta, contexto: ContextoPedidosAlertas) {
  if (alerta.pedido_id && contexto.pedidosPorId.has(alerta.pedido_id)) return true
  return Boolean(pedidoPorCodigoAlerta(alerta, contexto))
}

function pedidoPorCodigoAlerta(alerta: Alerta, contexto: ContextoPedidosAlertas) {
  const codigos = codigosPedidoAlerta(alerta)
  return codigos.map((codigo) => contexto.pedidosPorCodigo.get(normalizarCodigo(codigo))).find(Boolean)
}

function materialExisteEnModuloInventario(alerta: Alerta, contexto: ContextoMaterialesAlertas) {
  if (alerta.material_id && contexto.materialesPorId.has(alerta.material_id)) return true

  return referenciasMaterialAlerta(alerta).some(
    ({ codigo, nombre }) =>
      (codigo &&
        (contexto.materialesPorCodigo.has(codigo) || contexto.inventarioPorCodigo.has(codigo))) ||
      (nombre &&
        (contexto.materialesPorNombre.has(nombre) || contexto.inventarioPorNombre.has(nombre)))
  )
}

function materialTieneInventario(alerta: Alerta, contexto: ContextoMaterialesAlertas) {
  return referenciasMaterialAlerta(alerta).some(
    ({ codigo, nombre }) =>
      (codigo && contexto.inventarioPorCodigo.has(codigo)) ||
      (nombre && contexto.inventarioPorNombre.has(nombre))
  )
}

function stockResuelto(alerta: Alerta, contexto: ContextoAlertas) {
  const material = obtenerMaterialContexto(alerta, contexto)
  const inventario = obtenerInventarioContexto(alerta, contexto)
  const stock = stockContexto(alerta, material, inventario)

  if (stock === null) return false

  if (esAlertaFaltaMaterialPedido(alerta)) {
    const cantidad = cantidadPedidoAlerta(alerta)
    return cantidad !== null && stock >= cantidad
  }

  if (!esAlertaStock(alerta)) return false

  return stock >= umbralNormalStock(alerta, material, inventario)
}

function obtenerMaterialContexto(alerta: Alerta, contexto: ContextoMaterialesAlertas) {
  if (alerta.material_id) {
    const porId = contexto.materialesPorId.get(alerta.material_id)
    if (porId) return porId
  }

  for (const referencia of referenciasMaterialAlerta(alerta)) {
    if (referencia.codigo) {
      const porCodigo = contexto.materialesPorCodigo.get(referencia.codigo)
      if (porCodigo) return porCodigo
    }

    if (referencia.nombre) {
      const porNombre = contexto.materialesPorNombre.get(referencia.nombre)
      if (porNombre) return porNombre
    }
  }

  return null
}

function obtenerInventarioContexto(alerta: Alerta, contexto: ContextoMaterialesAlertas) {
  for (const referencia of referenciasMaterialAlerta(alerta)) {
    if (referencia.codigo) {
      const porCodigo = contexto.inventarioPorCodigo.get(referencia.codigo)
      if (porCodigo) return porCodigo
    }

    if (referencia.nombre) {
      const porNombre = contexto.inventarioPorNombre.get(referencia.nombre)
      if (porNombre) return porNombre
    }
  }

  return null
}

function stockContexto(
  alerta: Alerta,
  material: MaterialParaAlerta | null,
  inventario: InventarioParaAlerta | null
) {
  if (inventario) return numeroNoNegativo(inventario.stock_disponible)
  if (material) return numeroNoNegativo(material.stock_actual)
  if (typeof alerta.pedido_stock_disponible === 'number') {
    return Math.max(0, Math.floor(alerta.pedido_stock_disponible))
  }

  return null
}

function cantidadPedidoAlerta(alerta: Alerta) {
  if (typeof alerta.pedido_cantidad_despacho === 'number' && alerta.pedido_cantidad_despacho > 0) {
    return alerta.pedido_cantidad_despacho
  }

  return typeof alerta.pedido_cantidad === 'number' ? alerta.pedido_cantidad : null
}

function umbralNormalStock(
  alerta: Alerta,
  material: MaterialParaAlerta | null,
  inventario: InventarioParaAlerta | null
) {
  const pedidoCantidad = cantidadPedidoAlerta(alerta) || 0
  const minimo = Math.max(
    1,
    numeroNoNegativo(inventario?.pedido_maximo_material),
    numeroNoNegativo(material?.stock_minimo),
    numeroNoNegativo(inventario?.demanda_bodega_fq),
    pedidoCantidad
  )

  return Math.max(minimo * 3, numeroNoNegativo(inventario?.stock_objetivo_material))
}

function tieneContextoOperativo(alerta: Alerta, contexto: ContextoAlertas) {
  return pedidoExiste(alerta, contexto) || materialExisteEnModuloInventario(alerta, contexto)
}

function tieneReferenciaPedido(alerta: Alerta) {
  return Boolean(alerta.pedido_id || codigosPedidoAlerta(alerta).length)
}

function esAlertaPedido(alerta: Alerta) {
  const texto = textoAlerta(alerta)

  return (
    Boolean(alerta.pedido_id || alerta.pedido_codigo) ||
    texto.includes('pedido') ||
    texto.includes('priorizacion') ||
    texto.includes('retras') ||
    texto.includes('despacho') ||
    texto.includes('nota_credito') ||
    texto.includes('nota credito') ||
    texto.includes('reporte_franquiciado')
  )
}

function esAlertaMaterial(alerta: Alerta) {
  const texto = textoAlerta(alerta)

  return (
    Boolean(alerta.material_id || alerta.pedido_material) ||
    codigosMaterialAlerta(alerta).length > 0 ||
    texto.includes('material') ||
    texto.includes('stock') ||
    texto.includes('inventario') ||
    texto.includes('reabastecimiento') ||
    texto.includes('faltante')
  )
}

function esAlertaStock(alerta: Alerta) {
  const tipo = normalizarTexto(alerta.tipo_alerta)
  const texto = textoAlerta(alerta)

  return (
    TIPOS_ALERTA_STOCK.has(tipo) ||
    texto.includes('stock') ||
    texto.includes('faltante') ||
    texto.includes('sin cobertura') ||
    texto.includes('reabastecimiento')
  )
}

function esAlertaFaltaMaterialPedido(alerta: Alerta) {
  const tipo = normalizarTexto(alerta.tipo_alerta)
  return tipo === 'falta_material_pedido' || tipo === 'stock_agotado_planificable'
}

function esAlertaMaterialSinInventario(alerta: Alerta) {
  const tipo = normalizarTexto(alerta.tipo_alerta)
  const texto = textoAlerta(alerta)
  return tipo === 'material_sin_inventario' || texto.includes('no existe en inventario')
}

function referenciasMaterialAlerta(alerta: Alerta) {
  const codigos = codigosMaterialAlerta(alerta)
  const nombre = normalizarTexto(nombreMaterialAlerta(alerta))
  const referencias = codigos.map((codigo) => ({ codigo, nombre: '' }))

  if (nombre) referencias.push({ codigo: '', nombre })
  return referencias
}

function codigosPedidoAlerta(alerta: Alerta) {
  return valoresUnicos(
    [alerta.pedido_codigo, ...extraerCodigosPedido(alerta.mensaje)]
      .filter((codigo): codigo is string => Boolean(codigo))
      .map(normalizarCodigo)
      .filter(Boolean)
  )
}

function codigosMaterialAlerta(alerta: Alerta) {
  const valores = [
    ...extraerCodigosMaterial(alerta.pedido_codigo || ''),
    ...extraerCodigosMaterial(alerta.pedido_material || ''),
    ...extraerCodigosMaterial(alerta.mensaje || ''),
  ]

  return valoresUnicos(valores.map(normalizarCodigo).filter(Boolean))
}

function extraerCodigosPedido(texto: string | null | undefined) {
  const coincidencias = (texto || '').match(/\b(?:BFQ-|PED-)?\d{4,}(?:-\d{4,})?\b/gi) || []
  return coincidencias.map((codigo) => codigo.replace(/^#/, ''))
}

function extraerCodigosMaterial(texto: string) {
  const codigos = new Set<string>()
  const bfq = texto.match(/BFQ-\d+-(\d{8})/i)
  if (bfq?.[1]) codigos.add(bfq[1])

  const ochoDigitos = texto.match(/\b\d{8}\b/g) || []
  ochoDigitos.forEach((codigo) => codigos.add(codigo))

  return [...codigos]
}

function nombreMaterialAlerta(alerta: Alerta) {
  if (alerta.pedido_material) return limpiarNombreMaterial(alerta.pedido_material)

  const mensaje = alerta.mensaje || ''
  const patrones = [
    /material pedido no existe en inventario:\s*(?:\d{8}\s*-\s*)?(.+?)(?:\.|$)/i,
    /material\s+(?:\d{8}\s*-\s*)?(.+?)\s+(?:en estado|con faltante|sin cobertura|requiere|no existe)/i,
    /requiere atencion:\s*(.+?)\.\s*prioridad/i,
  ]

  for (const patron of patrones) {
    const match = mensaje.match(patron)
    if (match?.[1]) return limpiarNombreMaterial(match[1])
  }

  return null
}

function limpiarNombreMaterial(nombre: string) {
  return nombre
    .replace(/^\d{8}\s*-\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function obtenerAlertasStockDerivadasInventario(): Promise<Alerta[]> {
  const inventarioResult = await obtenerInventarioOperativo()
  if (inventarioResult.error) return []

  return materialesInventarioUnicos(inventarioResult.data || [])
    .map(alertaStockDerivada)
    .filter((alerta): alerta is Alerta => Boolean(alerta))
}

function alertaStockDerivada(material: InventarioOperativo): Alerta | null {
  const nivel = nivelStockInventario(material)
  if (!nivel) return null

  return {
    id: idAlertaStockDerivada(material),
    pedido_id: null,
    material_id: esUuid(material.id) ? material.id : null,
    tipo_alerta: 'stock_bajo',
    nivel,
    mensaje: mensajeStockInventario(material, nivel),
    estado: 'activa',
    responsable: RESPONSABLE_SYNC_STOCK,
    pedido_codigo: null,
    pedido_estado: null,
    pedido_fecha_compromiso: null,
    pedido_fecha_solicitud: null,
    pedido_stock_disponible: material.stock_disponible_operativo,
    pedido_cantidad: umbralNormalInventario(material),
    pedido_cantidad_despacho: umbralNormalInventario(material),
    pedido_cantidad_despachada: null,
    pedido_material: material.nombre,
    pedido_unidad_medida: material.unidad_medida,
    pedido_origen: null,
    pedido_destino: null,
    pedido_solicitante: null,
    pedido_cedula_solicitante: null,
    pedido_urgencia: null,
    pedido_tipo_cliente: null,
    pedido_accion_solicitante: null,
    pedido_condicion_material: material.estado_planificable || null,
    pedido_prioridad_calculada: null,
    pedido_despachado_at: null,
    pedido_despachado_por: null,
    created_at: material.created_at || new Date().toISOString(),
  }
}

function mezclarAlertasConStockDerivado(alertas: Alerta[], derivadas: Alerta[]) {
  if (derivadas.length === 0) return alertas

  const clavesPersistidas = new Set(
    alertas
      .filter((alerta) => alerta.estado !== 'cerrada' && esAlertaStock(alerta))
      .flatMap(clavesAlertaStock)
  )

  const derivadasSinDuplicar = derivadas.filter((alerta) =>
    clavesAlertaStock(alerta).every((clave) => !clavesPersistidas.has(clave))
  )

  return [...alertas, ...derivadasSinDuplicar].sort(ordenarAlertasRecientes)
}

function clavesAlertaStock(alerta: Alerta) {
  const claves = new Set<string>()

  if (alerta.material_id) claves.add(`id:${alerta.material_id}`)
  codigosMaterialAlerta(alerta).forEach((codigo) => claves.add(`codigo:${codigo}`))

  const nombre = normalizarTexto(nombreMaterialAlerta(alerta))
  if (nombre) claves.add(`nombre:${nombre}`)

  return [...claves]
}

function idAlertaStockDerivada(material: InventarioOperativo) {
  const llave =
    normalizarCodigo(material.codigo_material) ||
    normalizarTexto(material.nombre).replace(/[^a-z0-9]+/g, '-') ||
    material.id

  return `${PREFIJO_ALERTA_STOCK_DERIVADA}${llave}`
}

function materialesInventarioUnicos(materiales: InventarioOperativo[]) {
  const mapa = new Map<string, InventarioOperativo>()

  materiales.forEach((material) => {
    const llave =
      normalizarCodigo(material.codigo_material) || normalizarTexto(material.nombre) || material.id
    const actual = mapa.get(llave)

    if (!actual || severidadStockInventario(material) < severidadStockInventario(actual)) {
      mapa.set(llave, material)
    }
  })

  return [...mapa.values()]
}

function nivelStockInventario(material: InventarioOperativo): Alerta['nivel'] | null {
  const stock = Math.max(0, numeroNoNegativo(material.stock_disponible_operativo))
  const minimo = umbralMinimoInventario(material)
  const normal = umbralNormalInventario(material)

  if (stock >= normal) return null
  if (stock <= 0 || stock < minimo) return 'critica'
  return 'alta'
}

function severidadStockInventario(material: InventarioOperativo) {
  const nivel = nivelStockInventario(material)
  if (nivel === 'critica') return 0
  if (nivel === 'alta') return 1
  return 2
}

function umbralMinimoInventario(material: InventarioOperativo) {
  return Math.max(
    1,
    numeroNoNegativo(material.pedido_maximo_material),
    numeroNoNegativo(material.stock_minimo),
    numeroNoNegativo(material.demanda_bodega_fq)
  )
}

function umbralNormalInventario(material: InventarioOperativo) {
  return Math.max(
    umbralMinimoInventario(material) * 3,
    numeroNoNegativo(material.stock_objetivo_material)
  )
}

async function consultarAlertasStockPorReferencia(material: InventarioOperativo) {
  const codigo = normalizarCodigo(material.codigo_material)
  const nombre = normalizarTexto(material.nombre)

  let query = supabase
    .from('alertas')
    .select('id,nivel,estado,mensaje')
    .in('tipo_alerta', ['stock_bajo', 'faltante_bodega_fq'])
    .in('estado', ['activa', 'revisada'])
    .is('material_id', null)

  if (codigo) {
    query = query.ilike('mensaje', `%${codigo}%`)
  } else {
    query = query.ilike('mensaje', `%${nombre}%`)
  }

  const result = await query.returns<AlertaStockExistente[]>()
  return result.error ? [] : result.data || []
}

async function cerrarAlertasStockPorReferencia(material: InventarioOperativo) {
  const existentes = await consultarAlertasStockPorReferencia(material)
  if (existentes.length === 0) return

  await supabase
    .from('alertas')
    .update({ estado: 'cerrada' })
    .in(
      'id',
      existentes.map((alerta) => alerta.id)
    )
}

function mensajeStockInventario(material: InventarioOperativo, nivel: Alerta['nivel']) {
  const codigo = material.codigo_material ? `${material.codigo_material} - ` : ''
  const estado = nivel === 'critica' ? 'critico' : 'en riesgo'

  return `Material ${codigo}${material.nombre} en estado ${estado}: stock ${Math.max(
    0,
    material.stock_disponible_operativo
  )} / minimo ${umbralMinimoInventario(material)} / normal ${umbralNormalInventario(
    material
  )}. Departamento debe verificar reposicion.`
}

function esUuid(valor: string | null | undefined) {
  return Boolean(valor && UUID_RE.test(valor))
}

function textoAlerta(alerta: Pick<Alerta, 'tipo_alerta' | 'mensaje'>) {
  return normalizarTexto(`${alerta.tipo_alerta || ''} ${alerta.mensaje || ''}`)
}

function normalizarTexto(texto: string | null | undefined) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function normalizarCodigo(codigo: string | null | undefined) {
  return (codigo || '').replace(/^#/, '').trim()
}

function valoresUnicos<T extends string>(valores: T[]) {
  return [...new Set(valores.filter(Boolean))]
}

function ordenarAlertasRecientes(a: Alerta, b: Alerta) {
  return fechaAlertaMs(b.created_at) - fechaAlertaMs(a.created_at)
}

function fechaAlertaMs(fecha?: string | null) {
  const valor = new Date(fecha || '')
  return Number.isNaN(valor.getTime()) ? 0 : valor.getTime()
}

function unirPorId<T extends { id: string }>(items: T[]) {
  const mapa = new Map<string, T>()
  items.forEach((item) => mapa.set(item.id, item))
  return [...mapa.values()]
}

function unirInventario(items: InventarioParaAlerta[]) {
  const mapa = new Map<string, InventarioParaAlerta>()

  items.forEach((item) => {
    const llave = normalizarCodigo(item.codigo_material) || normalizarTexto(item.nombre_material)
    if (llave) mapa.set(llave, item)
  })

  return [...mapa.values()]
}

function numeroNoNegativo(valor: number | string | null | undefined) {
  const numero = Number(valor)
  return Number.isFinite(numero) ? Math.max(0, Math.floor(numero)) : 0
}
