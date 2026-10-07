/**
 * Regras de caminho do shell que não dependem de onde cada zona está. Quem é cada zona e onde ela
 * está vem do mapa vivo (`lib/mapa-zonas.ts`, ADR-0015); aqui ficam só as rotas que nenhuma zona
 * pode tomar e as formas de caminho que o proxy e o gateway reconhecem.
 */
export const ROTAS_RESERVADAS = [
  '/',
  '/login',
  '/erro-de-zona',
  '/api',
  '/api/auth',
  '/api/otel',
  '/api/stream',
  // rota interna do gateway de documento (C3): o proxy reescreve para ela; do navegador, é 404
  '/_gateway',
] as const

export function ehRotaReservada(caminho: string): boolean {
  if (!caminho || caminho === '/') return true
  const semQuery = caminho.split('?')[0] ?? ''
  const normalizado = semQuery.startsWith('/') ? semQuery : `/${semQuery}`
  return ROTAS_RESERVADAS.some((reservada) =>
    reservada === '/'
      ? normalizado === '/'
      : normalizado === reservada || normalizado.startsWith(`${reservada}/`)
  )
}

/** Formato do id de zona (o mesmo que o mapa exige). */
export const FORMATO_DO_ID_DE_ZONA = /^[a-z0-9][a-z0-9-]*$/

/**
 * O caminho tem forma de zona: o primeiro segmento, em minúsculas, está no formato do id e não é
 * rota reservada. Com o mapa vazio (fonte e guarda fora), esse caminho recebe 503 com a página da
 * base em vez de 404, para não esconder a queda da fonte (ADR-0015, decisão 6).
 */
export function temFormaDeZona(caminho: string): boolean {
  const semQuery = caminho.split('?')[0] ?? ''
  const primeiro = (semQuery.startsWith('/') ? semQuery.slice(1) : semQuery).split('/')[0]?.toLowerCase() ?? ''
  if (!FORMATO_DO_ID_DE_ZONA.test(primeiro)) return false
  return !ehRotaReservada(`/${primeiro}`)
}

/** Segundo segmento `_fragmento`, em qualquer caixa. Decodifica antes: `%5Ffragmento` chega à zona como `_fragmento`. */
const FRAGMENTO = /^\/[^/]+\/_fragmento(?:\/|$)/i
/** `/{zona}/_fragmento/...` é composição servidor→servidor (ADR-0011, decisão 8): do navegador, não existe. */
export function ehFragmento(caminho: string): boolean {
  let decodificado = caminho
  try { decodificado = decodeURIComponent(caminho) } catch { /* `%` solto: fica como veio */ }
  return FRAGMENTO.test(decodificado)
}

/** `/_gateway` em qualquer caixa e grafia (`%5F`): rota interna, nunca alcançável pelo navegador. */
const GATEWAY = /^\/_gateway(?:\/|$)/i
export function ehRotaDoGateway(caminho: string): boolean {
  let decodificado = caminho
  try { decodificado = decodeURIComponent(caminho) } catch { /* idem */ }
  return GATEWAY.test(decodificado) || GATEWAY.test(caminho)
}
