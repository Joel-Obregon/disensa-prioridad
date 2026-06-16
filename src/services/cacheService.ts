type CacheEntry<T> = {
  expiresAt: number
  promise: Promise<T> | null
  value: T | null
}

export type NotificadorCambios = (() => void) & {
  cancelar: () => void
}

const cache = new Map<string, CacheEntry<unknown>>()

export async function consultarConCache<T>(
  key: string,
  ttlMs: number,
  loader: () => PromiseLike<T>
): Promise<T> {
  const ahora = Date.now()
  const existente = cache.get(key) as CacheEntry<T> | undefined

  if (existente?.value && existente.expiresAt > ahora) {
    return existente.value
  }

  if (existente?.promise) {
    return existente.promise
  }

  const entrada: CacheEntry<T> = existente || {
    expiresAt: 0,
    promise: null,
    value: null,
  }

  entrada.promise = Promise.resolve()
    .then(loader)
    .then((resultado) => {
      if (cache.get(key) !== entrada) {
        return resultado
      }

      if (resultadoTieneError(resultado)) {
        cache.delete(key)
        return resultado
      }

      entrada.value = resultado
      entrada.expiresAt = Date.now() + ttlMs
      cache.set(key, entrada as CacheEntry<unknown>)
      return resultado
    })
    .catch((error) => {
      cache.delete(key)
      throw error
    })
    .finally(() => {
      entrada.promise = null
    })

  cache.set(key, entrada as CacheEntry<unknown>)
  return entrada.promise
}

export function invalidarCache(...prefijos: string[]) {
  if (prefijos.length === 0) {
    cache.clear()
    return
  }

  for (const key of cache.keys()) {
    if (prefijos.some((prefijo) => key.startsWith(prefijo))) {
      cache.delete(key)
    }
  }
}

export function crearNotificadorCambios(
  onChange: () => void,
  prefijosAInvalidar: string[] = [],
  delayMs = 350
): NotificadorCambios {
  let timer: ReturnType<typeof setTimeout> | null = null

  const notificar = (() => {
    if (prefijosAInvalidar.length > 0) {
      invalidarCache(...prefijosAInvalidar)
    }

    if (timer) clearTimeout(timer)

    timer = setTimeout(() => {
      timer = null
      onChange()
    }, delayMs)
  }) as NotificadorCambios

  notificar.cancelar = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  return notificar
}

function resultadoTieneError(resultado: unknown) {
  return (
    typeof resultado === 'object' &&
    resultado !== null &&
    'error' in resultado &&
    Boolean((resultado as { error?: unknown }).error)
  )
}
