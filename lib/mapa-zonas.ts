import { ehRotaReservada } from './zonas.ts'
import { exigirTokenDeServico, lerOrigensPermitidas, lerTimeoutDeDestino, lerTtlDoMapaDeZonas, lerValidadeDaGuardaDoMapa } from './configuracao.ts'

/**
 * Mapa vivo de zonas (C3): quem é cada zona e onde ela está, lido da gestão de acesso
 * (`GET /v2/zonas`, ADR-0015). Este módulo não importa nada do Next nem do núcleo no topo: a
 * instância do shell (`mapaDeZonas`) carrega destino e Redis na primeira leitura.
 */

export type ZonaDoMapa = { id: string; origem: string; prefixo: string; prefixoEstatico: string; urlSaude: string }
export type FonteDoMapa = () => Promise<readonly { id: string; origem: string }[]>
export type GuardaDoMapa = { ler(): Promise<string | null>; gravar(json: string): Promise<void> }
export type MapaDeZonas = {
  /** Zonas válidas do último mapa bom; relê a fonte quando o TTL venceu, sem bloquear quem chega durante a releitura. */
  zonas(): Promise<readonly ZonaDoMapa[]>
  /** Zona dona do caminho (prefixo ou prefixo estático, sem diferenciar maiúsculas), ou null. */
  encontrar(caminho: string): Promise<ZonaDoMapa | null>
}

const FORMATO_DO_ID = /^[a-z0-9][a-z0-9-]*$/
// só `http(s)://host[:porta]` com barra final opcional: sem credencial, caminho, query nem fragmento
const FORMATO_DA_ORIGEM = /^https?:\/\/[^/?#\\@\s]+\/?$/i

const escapar = (s: string) => s.replace(/[.+?^${}()|[\]\\-]/g, '\\$&')

/**
 * `origem` casa algum padrão `host:porta`? Em cada padrão, `*` no host vale qualquer sequência de
 * letras, dígitos, ponto e hífen (nunca `:`, `/` nem `@`); `*` na porta vale qualquer porta. A porta
 * omitida na origem vale a do esquema (80, 443).
 */
export function origemPermitida(origem: string, padroes: readonly string[]): boolean {
  if (!FORMATO_DA_ORIGEM.test(origem)) return false
  let url: URL
  try { url = new URL(origem) } catch { return false }
  const host = url.hostname.toLowerCase()
  const porta = url.port || (url.protocol === 'https:' ? '443' : '80')
  return padroes.some((padrao) => {
    const corte = padrao.lastIndexOf(':')
    if (corte < 0) return false
    const hostPadrao = padrao.slice(0, corte).toLowerCase()
    const portaPadrao = padrao.slice(corte + 1)
    const reHost = new RegExp(`^${hostPadrao.split('*').map(escapar).join('[a-z0-9.-]*')}$`)
    const portaCasa = portaPadrao === '*' ? /^[0-9]+$/.test(porta) : portaPadrao === porta
    return reHost.test(host) && portaCasa
  })
}

/** A zona montada, ou o motivo de a entrada ser descartada. */
function validarEntrada(e: unknown, permitidas: readonly string[]): ZonaDoMapa | string {
  if (typeof e !== 'object' || e === null) return 'entrada nao e objeto'
  const { id, origem } = e as { id?: unknown; origem?: unknown }
  if (typeof id !== 'string' || !FORMATO_DO_ID.test(id)) return 'id fora do formato'
  if (ehRotaReservada(`/${id}`)) return `id reservado "${id}"`
  // `x-static` colidiria com o prefixo estático da zona `x`
  if (id.endsWith('-static')) return `id "${id}" termina em -static`
  if (typeof origem !== 'string' || !origemPermitida(origem, permitidas)) return `origem de "${id}" invalida ou fora dos padroes permitidos`
  const base = new URL(origem).origin
  return { id, origem: base, prefixo: `/${id}`, prefixoEstatico: `/${id}-static`, urlSaude: `${base}/${id}/api/health` }
}

function validarLista(bruto: unknown, permitidas: readonly string[], registrar: (m: string) => void): ZonaDoMapa[] {
  if (!Array.isArray(bruto)) throw new Error('resposta nao e uma lista')
  const vistos = new Set<string>()
  const zonas: ZonaDoMapa[] = []
  for (const e of bruto) {
    const r = validarEntrada(e, permitidas)
    if (typeof r === 'string') { registrar(`entrada descartada: ${r}`); continue }
    if (vistos.has(r.id)) { registrar(`entrada descartada: id "${r.id}" repetido`); continue }
    vistos.add(r.id)
    zonas.push(r)
  }
  return zonas
}

export function criarMapaDeZonas(cfg: {
  fonte: FonteDoMapa
  guarda?: GuardaDoMapa
  ttlMs: number
  origensPermitidas: readonly string[]
  agora?: () => number
  /** Tempo máximo da leitura da guarda no boot frio (padrão 5000). */
  timeoutGuardaMs?: number
  registrarFalha?: (motivo: string) => void
}): MapaDeZonas {
  const agora = cfg.agora ?? Date.now
  const registrar = cfg.registrarFalha ?? (() => {})
  let ultimo: readonly ZonaDoMapa[] | null = null
  let lidoEm = 0
  let emVoo: Promise<void> | null = null

  async function carregar(): Promise<void> {
    try {
      const bruto = await cfg.fonte()
      const zonas = validarLista(bruto, cfg.origensPermitidas, registrar)
      ultimo = Object.freeze(zonas)
      lidoEm = agora()
      // a guarda recebe o que a fonte devolveu, só do shell, a cada leitura boa
      // fora do caminho crítico: Redis pendurado não pode segurar a leitura nem o voo único
      if (cfg.guarda) {
        const g = cfg.guarda
        void Promise.resolve().then(() => g.gravar(JSON.stringify(bruto))).catch((e: unknown) => registrar(`guarda nao gravou: ${mensagem(e)}`))
      }
      return
    } catch (e) {
      registrar(`fonte do mapa indisponivel ou invalida: ${mensagem(e)}`)
    }
    lidoEm = agora()
    if (ultimo !== null) return // fonte fora: segue o último mapa bom
    try {
      const json = cfg.guarda ? await comLimite(cfg.guarda.ler(), cfg.timeoutGuardaMs ?? 5000) : null
      ultimo = Object.freeze(json ? validarLista(JSON.parse(json), cfg.origensPermitidas, registrar) : [])
    } catch (e) {
      registrar(`guarda do mapa indisponivel ou invalida: ${mensagem(e)}`)
      ultimo = Object.freeze([])
    }
  }

  const iniciar = (): Promise<void> => (emVoo ??= carregar().finally(() => { emVoo = null }))

  async function zonas(): Promise<readonly ZonaDoMapa[]> {
    if (ultimo === null) {
      await iniciar()
    } else if (agora() - lidoEm >= cfg.ttlMs) {
      void iniciar() // sem await: quem chega agora usa o último mapa bom
    }
    return ultimo ?? []
  }

  return {
    zonas,
    async encontrar(caminho) {
      const semQuery = caminho.split('?')[0] ?? ''
      // o rewrite do Next casa o prefixo sem diferenciar maiúsculas (mesma regra de `encontrarZonaPorCaminho`)
      const normalizado = (semQuery.startsWith('/') ? semQuery : `/${semQuery}`).toLowerCase()
      for (const z of await zonas()) {
        if (normalizado === z.prefixo || normalizado.startsWith(`${z.prefixo}/`)) return z
        if (normalizado === z.prefixoEstatico || normalizado.startsWith(`${z.prefixoEstatico}/`)) return z
      }
      return null
    },
  }
}

/** A promessa, ou erro se ela não resolver no prazo (Redis pendurado). */
function comLimite<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const prazo = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`sem resposta em ${ms} ms`)), ms) })
  return Promise.race([p, prazo]).finally(() => clearTimeout(timer))
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e))

const CHAVE_DA_GUARDA = 'erp:mapa-zonas'

/** Fonte do shell: o destino `mapa-zonas` (credencial de serviço). Carrega o núcleo na primeira leitura. */
const fonteDoShell: FonteDoMapa = async () => {
  const { nucleo } = await import('./nucleo.ts')
  const r = await nucleo.destino('mapa-zonas').get<{ id: string; origem: string }[]>('/v2/zonas')
  return r.body as { id: string; origem: string }[]
}

/** Guarda do shell: Redis, chave `erp:mapa-zonas`. Sem `REDIS_URL` não há guarda (ler devolve null, gravar não faz nada). */
function guardaDoShell(validadeS: number): GuardaDoMapa {
  return {
    async ler() {
      const { clienteRedis } = await import('./redis.ts')
      return clienteRedis ? clienteRedis.get(CHAVE_DA_GUARDA) : null
    },
    async gravar(json) {
      const { clienteRedis } = await import('./redis.ts')
      if (clienteRedis) await clienteRedis.set(CHAVE_DA_GUARDA, json, { PX: validadeS * 1000 })
    },
  }
}

/**
 * Instância do shell. A configuração é lida na criação (sem rede nem Redis): em produção, sem
 * `ERP_ZONAS_ORIGENS_PERMITIDAS` ou `ERP_TOKEN_SERVICO`, o módulo falha ao carregar.
 */
export const mapaDeZonas: MapaDeZonas = (exigirTokenDeServico(), criarMapaDeZonas({
  fonte: fonteDoShell,
  guarda: guardaDoShell(lerValidadeDaGuardaDoMapa()),
  ttlMs: lerTtlDoMapaDeZonas(),
  origensPermitidas: lerOrigensPermitidas(),
  timeoutGuardaMs: lerTimeoutDeDestino(),
  registrarFalha: (m) => console.error(`[mapa-zonas] ${m}`),
}))
