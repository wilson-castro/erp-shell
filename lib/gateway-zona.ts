import 'server-only'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import { caminhoNaZona, type MapaDeZonas, type ZonaDoMapa } from './mapa-zonas.ts'
import { ehFragmento, temFormaDeZona } from './zonas.ts'
import { renderizarPaginaErroDeZona } from './pagina-erro-zona.ts'
import type { FalhaDeZona } from './rotas-auth.ts'

/**
 * Gateway de documento do shell (C3, ADR-0015 decisões 1 e 7). O `proxy.ts` reescreve a navegação de documento de
 * uma zona para `/_gateway/{caminho}`; a rota interna chama este gateway, que repassa à origem do mapa.
 *
 * Por que não `fetch`: o `fetch` do Node descomprime o corpo e o Next não recomprime a resposta de route handler
 * (a página chegava 18 vezes maior). Aqui é `node:http`/`node:https`, com um agente keep-alive por origem, e os
 * bytes e o `content-encoding` da zona passam como vieram.
 *
 * Teto (`ERP_ZONA_TETO_MS`): conta até os cabeçalhos da zona chegarem. Estourou, ou a zona recusou/caiu antes
 * deles: 503 com a página da base, `supportId`, `no-store` e `retry-after`, e a conexão com a zona é destruída.
 * Depois do primeiro byte vale a ociosidade (`ERP_ZONA_OCIOSIDADE_MS`): resposta parada é cortada, sem página,
 * porque o status já saiu. Limite declarado.
 */

export type ConfigDoGateway = {
  mapa: MapaDeZonas
  tetoMs: number
  ociosidadeMs: number
  registrarFalha: (falha: FalhaDeZona) => void
}

/** Hop-by-hop (RFC 9110 §7.6.1) e os de credencial de proxy: não atravessam o gateway em nenhum sentido. */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade',
  'proxy-authorization', 'proxy-authenticate', 'host',
])

/** Nomes listados no `Connection` também são hop-by-hop. */
function nomesEmConnection(valor: string | string[] | null | undefined): Set<string> {
  const v = Array.isArray(valor) ? valor.join(',') : (valor ?? '')
  return new Set(v.split(',').map((n) => n.trim().toLowerCase()).filter(Boolean))
}

const agentes = new Map<string, http.Agent>()
function agenteDe(origem: string): http.Agent {
  let a = agentes.get(origem)
  if (!a) {
    a = origem.startsWith('https:') ? new https.Agent({ keepAlive: true }) : new http.Agent({ keepAlive: true })
    agentes.set(origem, a)
  }
  return a
}

const naoEncontrado = () => new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } })

/** O caminho original: a requisição pode chegar com o prefixo interno `/_gateway` ou sem ele. */
function caminhoOriginal(url: URL): string {
  const p = url.pathname
  return /^\/_gateway(?:\/|$)/i.test(p) ? p.slice('/_gateway'.length) || '/' : p
}

export function criarGatewayDeZona(cfg: ConfigDoGateway): (req: Request) => Promise<Response> {
  function paginaDaBase(zona: string, motivo: FalhaDeZona['motivo']): Response {
    const falha: FalhaDeZona = { zona, motivo, codigo: 'ERRO_INTERNO', supportId: randomUUID() }
    cfg.registrarFalha(falha)
    return new Response(renderizarPaginaErroDeZona(zona, falha.supportId), {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '5' },
    })
  }

  return async function gateway(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const caminho = caminhoOriginal(url)
    // o proxy já recusa; repetido aqui como defesa em profundidade (ADR-0015, decisão 8)
    if (ehFragmento(caminho)) return naoEncontrado()

    const zona = await cfg.mapa.encontrar(caminho)
    if (!zona) {
      if (temFormaDeZona(caminho) && (await cfg.mapa.zonas()).length === 0) return paginaDaBase(caminho.split('/')[1]?.toLowerCase() ?? '', 'mapa-vazio')
      return naoEncontrado()
    }

    // alvo só do mapa: origem da zona e caminho da requisição (que casou o prefixo dela); nunca Host nem X-Forwarded-*
    const alvo = new URL(`${caminhoNaZona(zona, caminho)}${url.search}`, zona.origem)
    if (alvo.origin !== zona.origem) return naoEncontrado()

    return repassar(req, zona, alvo)
  }

  function cabecalhosParaZona(req: Request, url: URL): Record<string, string> {
    const fora = nomesEmConnection(req.headers.get('connection'))
    const h: Record<string, string> = {}
    req.headers.forEach((valor, nome) => {
      if (HOP_BY_HOP.has(nome) || fora.has(nome) || nome.startsWith('x-middleware-')) return
      h[nome] = valor
    })
    h['x-forwarded-host'] = req.headers.get('host') ?? url.host
    h['x-forwarded-proto'] = req.headers.get('x-forwarded-proto') ?? url.protocol.slice(0, -1)
    // `traceparent` já veio acima: é o que o proxy pôs na requisição reescrita (núcleo 8), um trace por requisição
    return h
  }

  function cabecalhosDaResposta(zres: http.IncomingMessage, zona: ZonaDoMapa): Headers {
    const fora = nomesEmConnection(zres.headers.connection)
    const h = new Headers()
    const brutos = zres.rawHeaders
    for (let i = 0; i + 1 < brutos.length; i += 2) {
      const nome = brutos[i]!.toLowerCase()
      let valor = brutos[i + 1]!
      if (HOP_BY_HOP.has(nome) || fora.has(nome)) continue
      if (nome === 'location') valor = locationRelativo(valor, zona)
      // `append` mantém cada Set-Cookie separado (getSetCookie)
      h.append(nome, valor)
    }
    return h
  }

  function repassar(req: Request, zona: ZonaDoMapa, alvo: URL): Promise<Response> {
    const url = new URL(req.url)
    const metodo = req.method.toUpperCase() === 'HEAD' ? 'HEAD' : 'GET'
    const cliente = alvo.protocol === 'https:' ? https : http

    return new Promise<Response>((resolver) => {
      let resolvido = false
      const responder = (r: Response) => { if (!resolvido) { resolvido = true; resolver(r) } }
      // uma falha só: o `destroy` do teto também dispara o `error` da requisição
      const falharComPagina = (motivo: FalhaDeZona['motivo']) => { if (!resolvido) responder(paginaDaBase(zona.id, motivo)) }

      const zreq = cliente.request(alvo, { method: metodo, headers: cabecalhosParaZona(req, url), agent: agenteDe(zona.origem) })

      // teto até os cabeçalhos: no estouro, solta a zona e entrega a página da base
      const teto = setTimeout(() => {
        falharComPagina('teto')
        zreq.destroy(new Error('teto'))
      }, cfg.tetoMs)

      // navegador que desiste antes dos cabeçalhos solta a zona
      const aoAbortar = () => { clearTimeout(teto); responder(naoEncontrado()); zreq.destroy(new Error('cliente fechou')) }
      if (req.signal.aborted) aoAbortar()
      else req.signal.addEventListener('abort', aoAbortar, { once: true })

      zreq.on('error', () => {
        clearTimeout(teto)
        falharComPagina('conexao')
      })

      zreq.on('response', (zres) => {
        clearTimeout(teto)
        req.signal.removeEventListener('abort', aoAbortar)
        if (resolvido) { zres.destroy(); return }
        const headers = cabecalhosDaResposta(zres, zona)
        const status = zres.statusCode ?? 502
        const semCorpo = metodo === 'HEAD' || status === 204 || status === 304
        if (semCorpo) {
          zres.resume()
          responder(new Response(null, { status, headers }))
          return
        }
        responder(new Response(corpoComOciosidade(zres, zona, req.signal), { status, headers }))
      })

      zreq.end()
    })
  }

  /** O corpo da zona, byte a byte como veio; parado por mais de `ociosidadeMs`, é cortado e a zona é solta. */
  function corpoComOciosidade(zres: http.IncomingMessage, zona: ZonaDoMapa, sinal: AbortSignal): ReadableStream<Uint8Array> {
    let ocio: ReturnType<typeof setTimeout> | undefined
    let terminou = false
    const parar = () => { if (ocio) clearTimeout(ocio); ocio = undefined }
    const largar = () => { terminou = true; parar(); sinal.removeEventListener('abort', aoAbortar); zres.destroy() }
    const aoAbortar = () => largar()
    sinal.addEventListener('abort', aoAbortar, { once: true })

    return new ReadableStream<Uint8Array>({
      start(controle) {
        const falhar = (e: Error) => {
          if (terminou) return
          largar()
          try { controle.error(e) } catch { /* já fechado */ }
        }
        const armar = () => {
          parar()
          ocio = setTimeout(() => {
            const falha: FalhaDeZona = { zona: zona.id, motivo: 'ociosidade', codigo: 'ERRO_INTERNO', supportId: randomUUID() }
            cfg.registrarFalha(falha)
            falhar(new Error('zona ociosa'))
          }, cfg.ociosidadeMs)
        }
        armar()
        zres.on('data', (pedaco: Buffer) => {
          if (terminou) return
          armar()
          controle.enqueue(new Uint8Array(pedaco.buffer, pedaco.byteOffset, pedaco.byteLength))
          if ((controle.desiredSize ?? 1) <= 0) zres.pause()
        })
        zres.on('end', () => {
          if (terminou) return
          terminou = true
          parar()
          sinal.removeEventListener('abort', aoAbortar)
          controle.close()
        })
        zres.on('error', (e) => falhar(e))
        // fechou sem `end`: a zona caiu no meio da resposta
        zres.on('close', () => { if (!zres.complete) falhar(new Error('zona fechou no meio da resposta')) })
      },
      pull() { zres.resume() },
      cancel() { largar() },
    })
  }
}

/** `Location` com a origem interna da zona vira caminho relativo; outro destino (IdP, outro site) passa como veio. */
function locationRelativo(valor: string, zona: ZonaDoMapa): string {
  try {
    const u = new URL(valor, zona.origem)
    const absoluto = /^[a-z][a-z0-9+.-]*:/i.test(valor) || valor.startsWith('//')
    if (absoluto && u.origin === zona.origem) return `${u.pathname}${u.search}${u.hash}`
  } catch { /* não é URL: fica como veio */ }
  return valor
}
