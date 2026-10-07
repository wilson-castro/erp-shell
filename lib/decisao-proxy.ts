import 'server-only'
import { randomUUID } from 'node:crypto'
import type { EstadoDaRenovacao } from '@erp/nucleo/shell'
import { ehFragmento, ehRotaDoGateway, temFormaDeZona } from './zonas.ts'
import { caminhoNaZona, type MapaDeZonas, type ZonaDoMapa } from './mapa-zonas.ts'
import { cacheSaudePadrao, type CacheSaudeZona } from './saude-zonas.ts'
import { renderizarPaginaErroDeZona } from './pagina-erro-zona.ts'
import { registrarNoConsole, type FalhaDeZona } from './rotas-auth.ts'

export type DecisaoProxy =
  | { readonly acao: 'publico'; readonly nonce: string }
  | { readonly acao: 'telemetria' }
  // `/{zona}/_fragmento/...` é composição servidor→servidor (ADR-0011, decisão 8): do navegador, não existe
  | { readonly acao: 'nao-encontrado' }
  | {
      readonly acao: 'zona-inativa'
      readonly idZona: string
      readonly status: 503
      readonly headers: {
        readonly 'content-type': string
        readonly 'retry-after': string
        readonly 'cache-control': string
      }
      readonly html: string
      /** Só no 503 de mapa vazio, que é falha a registrar; a sonda negativa é estado conhecido da zona. */
      readonly supportId?: string
    }
  // caminho rápido (RSC, Server Action, outros métodos, estático): `NextResponse.rewrite` para a origem do mapa
  | { readonly acao: 'zona-rapida'; readonly destino: URL; readonly limparSessao?: true }
  // documento (GET/HEAD sem RSC nem Next-Action): reescrito para o gateway interno, que entrega a página da base no teto
  | { readonly acao: 'zona-documento'; readonly caminhoInterno: string; readonly limparSessao?: true }
  // `limparSessao`: o cookie leva a uma sessão que acabou (revogada no IdP ou ausente do store)
  | { readonly acao: 'redirecionar-login'; readonly destino: string; readonly limparSessao?: true }
  | { readonly acao: 'prosseguir'; readonly nonce: string; readonly limparSessao?: true }

export interface ContextoRequisicaoProxy {
  readonly caminho: string
  readonly temCookieSessao: boolean
  /** Valor do cookie de sessão, para a renovação proativa. */
  readonly idSessao?: string | undefined
  /** Método HTTP; ausente vale como `GET`. */
  readonly metodo?: string | undefined
  /** Cabeçalho `RSC` presente (navegação do cliente ou prefetch do App Router). */
  readonly rsc?: boolean | undefined
  /** Cabeçalho `Next-Action` presente (Server Action). */
  readonly acaoDoServidor?: boolean | undefined
  /** Busca da URL com o `?` (`req.nextUrl.search`), repassada à zona como veio. */
  readonly busca?: string | undefined
}

/** `nucleo.sessao.renovarSessao` da fábrica do shell: lock, releitura, IdP e gravação ficam lá. */
export type RenovarSessao = (id: string | undefined) => Promise<EstadoDaRenovacao>

/** `caminho` é `prefixo` ou está abaixo dele: `/api/otelx` não é `/api/otel` (auditor_shell_2, U6). */
const noSegmento = (caminho: string, prefixo: string) => caminho === prefixo || caminho.startsWith(`${prefixo}/`)

const paraLogin = (caminho: string) => `/login?de=${encodeURIComponent(caminho)}`

const CABECALHOS_DA_PAGINA_DA_BASE = {
  'content-type': 'text/html; charset=utf-8',
  'retry-after': '5',
  'cache-control': 'no-store',
} as const

/**
 * Para onde vai a requisição de zona que segue (ADR-0015, decisão 1). Documento (GET/HEAD sem `RSC` nem
 * `Next-Action`) vai ao gateway interno, que entrega a página da base no teto; o resto vai pelo caminho
 * rápido, `NextResponse.rewrite` para a origem do mapa. O alvo sai só do mapa: a origem é a da zona, e o
 * caminho, o da requisição (que já casou o prefixo dela).
 */
function rotaDaZona(
  zona: ZonaDoMapa, contexto: ContextoRequisicaoProxy, limparSessao: true | undefined, estatico = false,
): DecisaoProxy {
  const metodo = (contexto.metodo ?? 'GET').toUpperCase()
  const busca = contexto.busca ?? ''
  const limpar = limparSessao ? { limparSessao } : {}
  const caminho = caminhoNaZona(zona, contexto.caminho)
  if (!estatico && (metodo === 'GET' || metodo === 'HEAD') && !contexto.rsc && !contexto.acaoDoServidor) {
    return { acao: 'zona-documento', caminhoInterno: `/_gateway${caminho}${busca}`, ...limpar }
  }
  const destino = new URL(`${caminho}${busca}`, zona.origem)
  // `caminho` começa pelo prefixo da zona, então a origem não muda; conferido mesmo assim (defesa em profundidade)
  if (destino.origin !== zona.origem) return { acao: 'nao-encontrado' }
  return { acao: 'zona-rapida', destino, ...limpar }
}

/**
 * Renovação proativa (ADR-0013, decisão 4) de uma requisição com cookie que vai seguir. A fábrica
 * só chama o IdP dentro da janela e para quem ganhou o lock. Quem perdeu com o token ainda válido
 * recebe `em-andamento` na hora e segue com ele, sem esperar. Quem perdeu com o token já vencido
 * espera o vencedor (D19-B): relê a sessão a cada `ERP_RENOVACAO_ESPERA_PASSO_MS`, sem ir ao IdP, e
 * recebe `em-dia` quando o token novo aparece, `ausente` se a sessão acabou, ou `em-andamento` no
 * teto (`ERP_RENOVACAO_ESPERA_MS`). São os estados de sempre: a decisão abaixo não distingue os casos.
 *
 * - `revogada` ou `ausente`: a sessão acabou. Navegação (`GET`/`HEAD`) vai ao login; o resto
 *   (Server Action, `POST` de route handler) segue para a camada 2 responder do jeito dela, que é
 *   o que a action sabe transformar em ida ao login. Nos dois casos o cookie morto é apagado.
 * - Erro (IdP ou store fora): a sessão fica e a requisição segue; o lock da fábrica segura novas
 *   tentativas até vencer. Com o token ainda válido, um IdP instável não desloga ninguém; com o
 *   token já vencido, a requisição segue com ele e o domínio responde 401, que leva ao login. Quem
 *   perde o lock nesse caso só chega aí depois do teto da espera: com o IdP fora, o lock preso
 *   segura as idas ao IdP e cada requisição com o token vencido espera o teto antes de seguir.
 */
async function renovarAntesDeSeguir(
  contexto: ContextoRequisicaoProxy, renovar: RenovarSessao | undefined,
): Promise<{ readonly acao: 'redirecionar-login'; readonly destino: string; readonly limparSessao: true } | { readonly segue: true; readonly limparSessao?: true }> {
  if (!renovar) return { segue: true }
  let estado: EstadoDaRenovacao
  try {
    estado = await renovar(contexto.idSessao)
  } catch {
    return { segue: true }
  }
  if (estado !== 'revogada' && estado !== 'ausente') return { segue: true }
  const metodo = (contexto.metodo ?? 'GET').toUpperCase()
  if (metodo === 'GET' || metodo === 'HEAD') {
    return { acao: 'redirecionar-login', destino: paraLogin(contexto.caminho), limparSessao: true }
  }
  return { segue: true, limparSessao: true }
}

async function prosseguirComRenovacao(
  contexto: ContextoRequisicaoProxy, renovar: RenovarSessao | undefined, nonce: string,
): Promise<DecisaoProxy> {
  const r = await renovarAntesDeSeguir(contexto, renovar)
  if ('acao' in r) return r
  return r.limparSessao ? { acao: 'prosseguir', nonce, limparSessao: true } : { acao: 'prosseguir', nonce }
}

/** 503 com a página da base para caminho com forma de zona quando o mapa está vazio (fonte e guarda fora). */
function mapaVazio(caminho: string): DecisaoProxy {
  const id = (caminho.split('?')[0] ?? '').split('/')[1]?.toLowerCase() ?? ''
  const falha: FalhaDeZona = { zona: id, motivo: 'mapa-vazio', codigo: 'ERRO_INTERNO', supportId: randomUUID() }
  registrarNoConsole(falha)
  return {
    acao: 'zona-inativa', idZona: id, status: 503, headers: CABECALHOS_DA_PAGINA_DA_BASE,
    html: renderizarPaginaErroDeZona(id, falha.supportId), supportId: falha.supportId,
  }
}

/**
 * `mapa` é obrigatório: o proxy passa o mapa vivo do shell (`mapaDeZonas`); os testes, um mapa fixo. Um padrão
 * aqui faria teste de unidade ir à rede sem ninguém notar.
 */
export async function decidirAcaoDoProxy(
  contexto: ContextoRequisicaoProxy,
  cacheSaude: CacheSaudeZona = cacheSaudePadrao,
  mapa: MapaDeZonas,
  renovar?: RenovarSessao
): Promise<DecisaoProxy> {
  const { caminho, temCookieSessao } = contexto
  const nonce = crypto.randomUUID().replaceAll('-', '')

  // 0. Rota interna do gateway (C3): o proxy reescreve para ela, e a reescrita não passa de novo pelo proxy.
  // Do navegador, em qualquer grafia, não existe.
  if (ehRotaDoGateway(caminho)) return { acao: 'nao-encontrado' }

  // 1. Rotas reservadas públicas do shell
  if (
    caminho === '/login' ||
    caminho.startsWith('/login/') ||
    noSegmento(caminho, '/api/auth') ||
    caminho === '/erro-de-zona' ||
    caminho.startsWith('/erro-de-zona/')
  ) {
    return { acao: 'publico', nonce }
  }

  // 2. Gateway de telemetria das zonas: tratado pelo route handler do shell
  if (noSegmento(caminho, '/api/otel')) {
    return { acao: 'telemetria' }
  }

  // 3. Rota de zona (ex.: /zona1, /zona1/*, /zona1-static/*), pelo mapa vivo
  const zona = await mapa.encontrar(caminho)
  if (zona) {
    // antes da sonda e do cookie: não revela se a zona está no ar nem manda ao login
    if (ehFragmento(caminho)) return { acao: 'nao-encontrado' }
    const saudavel = await cacheSaude.verificar(zona.urlSaude)
    if (!saudavel) {
      return {
        acao: 'zona-inativa',
        idZona: zona.id,
        status: 503,
        headers: CABECALHOS_DA_PAGINA_DA_BASE,
        html: renderizarPaginaErroDeZona(zona.id),
      }
    }

    // asset da zona: sem cookie e sem renovação, pelo caminho rápido
    const baixo = caminho.toLowerCase()
    if (baixo === zona.prefixoEstatico || baixo.startsWith(`${zona.prefixoEstatico}/`)) {
      return rotaDaZona(zona, contexto, undefined, true)
    }

    if (!temCookieSessao) {
      return { acao: 'redirecionar-login', destino: paraLogin(caminho) }
    }

    const r = await renovarAntesDeSeguir(contexto, renovar)
    if ('acao' in r) return r
    return rotaDaZona(zona, contexto, r.limparSessao)
  }

  // Mapa vazio (fonte e guarda fora): caminho com forma de zona recebe a página da base, não 404 (ADR-0015, decisão 6)
  if (temFormaDeZona(caminho) && (await mapa.zonas()).length === 0) {
    if (ehFragmento(caminho)) return { acao: 'nao-encontrado' }
    return mapaVazio(caminho)
  }

  // 4. Rotas da própria aplicação shell (ex.: '/')
  if (!temCookieSessao) {
    return { acao: 'redirecionar-login', destino: paraLogin(caminho) }
  }

  return prosseguirComRenovacao(contexto, renovar, nonce)
}
