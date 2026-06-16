const MAX_TEXTO_CORTO = 120
const MAX_TEXTO_LARGO = 800

export function soloDigitos(valor: string, maxDigitos = 13) {
  return valor.replace(/\D/g, '').slice(0, maxDigitos)
}

export function soloEnteroNoNegativo(valor: string, maxDigitos = 9) {
  return soloDigitos(valor, maxDigitos)
}

export function soloTextoNombre(valor: string, maxCaracteres = MAX_TEXTO_CORTO) {
  return valor
    .replace(/[^\p{L}\p{M}\s'.&-]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, maxCaracteres)
}

export function textoMixtoOperativo(valor: string, maxCaracteres = MAX_TEXTO_CORTO) {
  return valor
    .replace(/[^\p{L}\p{M}\d\s#._/&+()º°,-]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, maxCaracteres)
}

export function textoDescripcion(valor: string, maxCaracteres = MAX_TEXTO_LARGO) {
  return valor
    .replace(/[^\p{L}\p{M}\d\s#._/&+()º°,:;¿?!¡@%-]/gu, '')
    .replace(/\s{3,}/g, '  ')
    .slice(0, maxCaracteres)
}

export function esEnteroPositivo(valor: string) {
  return /^\d+$/.test(valor) && Number(valor) > 0
}

export function esEnteroNoNegativo(valor: string) {
  return /^\d+$/.test(valor) && Number(valor) >= 0
}

export function esCodigoClienteORucValido(valor: string) {
  const digitos = soloDigitos(valor)
  return digitos.length >= 6 && digitos.length <= 13
}

export function esCedulaORucValido(valor: string) {
  const digitos = soloDigitos(valor)
  return digitos.length >= 10 && digitos.length <= 13
}

export function esCodigoMaterialValido(valor: string) {
  const digitos = soloDigitos(valor, 8)
  return digitos.length === 8
}

export function esCorreoValido(valor: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor.trim())
}
