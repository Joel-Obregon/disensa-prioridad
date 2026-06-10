import { supabase } from './supabaseClient'

export type OtifIndicador = {
  valor: number
  cumplidos: number
  total: number
  detalle: string
}

export type OtifOperativo = {
  suministradorBodega: OtifIndicador
  bodegaFranquiciado: OtifIndicador
}

type PedidoBodegaFqRow = {
  pedido_key: string
  estado: string | null
  fecha_limite: string | null
  fecha_entrega: string | null
}

type OcPendienteRow = {
  oc_linea_key: string
  documento_compras: string
  fecha_documento: string | null
  cantidad_por_entregar: number | string | null
}

type OtifOperativoRow = {
  suministrador_bodega_valor: number | string | null
  suministrador_bodega_cumplidos: number | string | null
  suministrador_bodega_total: number | string | null
  suministrador_bodega_detalle: string | null
  bodega_franquiciado_valor: number | string | null
  bodega_franquiciado_cumplidos: number | string | null
  bodega_franquiciado_total: number | string | null
  bodega_franquiciado_detalle: string | null
}

const SLA_SUMINISTRADOR_BODEGA_DIAS = 30

export async function obtenerOtifOperativo() {
  const vistaResult = await supabase
    .from('otif_operativo_v')
    .select('*')
    .maybeSingle<OtifOperativoRow>()

  if (!vistaResult.error && vistaResult.data) {
    return {
      data: mapearOtifVista(vistaResult.data),
      error: null,
    }
  }

  const [pedidosResult, ocResult] = await Promise.all([
    supabase
      .from('pedidos_bodega_fq_priorizados_v')
      .select('pedido_key,estado,fecha_limite,fecha_entrega')
      .returns<PedidoBodegaFqRow[]>(),
    supabase
      .from('oc_pendientes_bodega')
      .select('oc_linea_key,documento_compras,fecha_documento,cantidad_por_entregar')
      .returns<OcPendienteRow[]>(),
  ])

  return {
    data: {
      suministradorBodega: ocResult.error
        ? construirIndicador(0, 0, 'No se pudo leer OC pendientes')
        : calcularOtifSuministradorBodega(ocResult.data || []),
      bodegaFranquiciado: pedidosResult.error
        ? construirIndicador(0, 0, 'No se pudo leer Bodega-FQ')
        : calcularOtifBodegaFranquiciado(pedidosResult.data || []),
    },
    error: pedidosResult.error || ocResult.error || null,
  }
}

function mapearOtifVista(row: OtifOperativoRow): OtifOperativo {
  return {
    suministradorBodega: {
      valor: numero(row.suministrador_bodega_valor),
      cumplidos: numero(row.suministrador_bodega_cumplidos),
      total: numero(row.suministrador_bodega_total),
      detalle: row.suministrador_bodega_detalle || 'OC unicas dentro de 30 dias de espera',
    },
    bodegaFranquiciado: {
      valor: numero(row.bodega_franquiciado_valor),
      cumplidos: numero(row.bodega_franquiciado_cumplidos),
      total: numero(row.bodega_franquiciado_total),
      detalle: row.bodega_franquiciado_detalle || 'Pedidos cerrados dentro del SLA completo',
    },
  }
}

function calcularOtifSuministradorBodega(rows: OcPendienteRow[]): OtifIndicador {
  const porDocumento = new Map<
    string,
    { fecha_documento: string; cantidad_por_entregar: number }
  >()

  rows.forEach((row) => {
    if (!row.documento_compras || !row.fecha_documento) return

    const existente = porDocumento.get(row.documento_compras)
    if (!existente) {
      porDocumento.set(row.documento_compras, {
        fecha_documento: row.fecha_documento,
        cantidad_por_entregar: numero(row.cantidad_por_entregar),
      })
      return
    }

    const fechaDocumento = fecha(row.fecha_documento)
    const fechaExistente = fecha(existente.fecha_documento)
    porDocumento.set(row.documento_compras, {
      fecha_documento:
        fechaDocumento.getTime() < fechaExistente.getTime()
          ? row.fecha_documento
          : existente.fecha_documento,
      cantidad_por_entregar:
        existente.cantidad_por_entregar + numero(row.cantidad_por_entregar),
    })
  })

  const evaluables = [...porDocumento.values()].filter((row) => {
    const pendiente = numero(row.cantidad_por_entregar)
    return pendiente <= 0 || diasDesde(row.fecha_documento) >= SLA_SUMINISTRADOR_BODEGA_DIAS
  })
  const cumplidos = evaluables.filter((row) => {
    const pendiente = numero(row.cantidad_por_entregar)
    return pendiente <= 0 && diasDesde(row.fecha_documento) <= SLA_SUMINISTRADOR_BODEGA_DIAS
  }).length

  return construirIndicador(
    cumplidos,
    evaluables.length,
    `OC unicas dentro de ${SLA_SUMINISTRADOR_BODEGA_DIAS} dias de espera`
  )
}

function calcularOtifBodegaFranquiciado(rows: PedidoBodegaFqRow[]): OtifIndicador {
  const cerrados = rows.filter((row) => normalizarTexto(row.estado).includes('cerrad'))
  const dentroSla = cerrados.filter((row) => {
    if (!row.fecha_entrega || !row.fecha_limite) return false
    return fecha(row.fecha_entrega).getTime() <= fecha(row.fecha_limite).getTime()
  }).length

  return construirIndicador(
    dentroSla,
    cerrados.length,
    `Pedidos cerrados; ${dentroSla} dentro del SLA completo`
  )
}

function normalizarTexto(value: string | null | undefined) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function construirIndicador(cumplidos: number, total: number, detalle: string): OtifIndicador {
  return {
    valor: total > 0 ? Math.round((cumplidos / total) * 100) : 0,
    cumplidos,
    total,
    detalle,
  }
}

function diasDesde(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY
  const inicio = fecha(value).getTime()
  const hoy = new Date().getTime()
  return Math.max(0, Math.floor((hoy - inicio) / 86_400_000))
}

function fecha(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function numero(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
