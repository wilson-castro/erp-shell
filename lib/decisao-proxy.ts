import 'server-only'
import type { EstadoDaRenovacao } from '@erp/nucleo/shell'
import {
  encontrarZonaPorCaminho,
  type DefinicaoDeZona,
} from './zonas.ts'
import { cacheSaudePadrao, type CacheSaudeZona } from './saude-zonas.ts'
import { renderizarPaginaErroDeZona } from './pagina-erro-zona.ts'

export type DecisaoProxy =
  | { readonly acao: 'publico'; readonly nonce: string }
  | { readonly acao: 'telemetria' }
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
    }
  | { readonly acao: 'zona-estatica' }
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
}

/** `nucleo.sessao.renovarSessao` da fábrica do shell: lock, releitura, IdP e gravação ficam lá. */
export type RenovarSessao = (id: string | undefined) => Promise<EstadoDaRenovacao>

/** `caminho` é `prefixo` ou está abaixo dele: `/api/otelx` não é `/api/otel` (auditor_shell_2, U6). */
const noSegmento = (caminho: string, prefixo: string) => caminho === prefixo || caminho.startsWith(`${prefixo}/`)

const paraLogin = (caminho: string) => `/login?de=${encodeURIComponent(caminho)}`

/**
 * Renovação proativa (ADR-0013, decisão 4) de uma requisição com cookie que vai seguir. A fábrica
 * só chama o IdP dentro da janela e para quem ganhou o lock; quem perdeu recebe `em-andamento` na
 * hora, então nenhuma requisição espera a renovação de outra.
 *
 * - `revogada` ou `ausente`: a sessão acabou. Navegação (`GET`/`HEAD`) vai ao login; o resto
 *   (Server Action, `POST` de route handler) segue para a camada 2 responder do jeito dela, que é
 *   o que a action sabe transformar em ida ao login. Nos dois casos o cookie morto é apagado.
 * - Erro (IdP ou store fora): a sessão fica e a requisição segue; o lock da fábrica segura novas
 *   tentativas até vencer. Com o token ainda válido, um IdP instável não desloga ninguém; com o
 *   token já vencido, a requisição segue com ele e o domínio responde 401, que leva ao login. O
 *   mesmo vale para quem perde o lock com o token vencido (DEFERRED.md, D19).
 */
async function prosseguirComRenovacao(
  contexto: ContextoRequisicaoProxy, renovar: RenovarSessao | undefined, nonce: string,
): Promise<DecisaoProxy> {
  if (!renovar) return { acao: 'prosseguir', nonce }
  let estado: EstadoDaRenovacao
  try {
    estado = await renovar(contexto.idSessao)
  } catch {
    return { acao: 'prosseguir', nonce }
  }
  if (estado !== 'revogada' && estado !== 'ausente') return { acao: 'prosseguir', nonce }
  const metodo = (contexto.metodo ?? 'GET').toUpperCase()
  if (metodo === 'GET' || metodo === 'HEAD') {
    return { acao: 'redirecionar-login', destino: paraLogin(contexto.caminho), limparSessao: true }
  }
  return { acao: 'prosseguir', nonce, limparSessao: true }
}

export async function decidirAcaoDoProxy(
  contexto: ContextoRequisicaoProxy,
  cacheSaude: CacheSaudeZona = cacheSaudePadrao,
  zonas?: readonly DefinicaoDeZona[],
  renovar?: RenovarSessao
): Promise<DecisaoProxy> {
  const { caminho, temCookieSessao } = contexto
  const nonce = crypto.randomUUID().replaceAll('-', '')

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

  // 3. Rota de zona (ex.: /zona1, /zona1/*, /zona1-static/*)
  const zona = encontrarZonaPorCaminho(caminho, zonas)
  if (zona) {
    const saudavel = await cacheSaude.verificar(zona.urlSaude)
    if (!saudavel) {
      return {
        acao: 'zona-inativa',
        idZona: zona.id,
        status: 503,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'retry-after': '5',
          'cache-control': 'no-store',
        },
        html: renderizarPaginaErroDeZona(zona.id),
      }
    }

    if (caminho.toLowerCase().startsWith(zona.prefixoEstatico)) {
      return { acao: 'zona-estatica' }
    }

    if (!temCookieSessao) {
      return { acao: 'redirecionar-login', destino: paraLogin(caminho) }
    }

    return prosseguirComRenovacao(contexto, renovar, nonce)
  }

  // 4. Rotas da própria aplicação shell (ex.: '/')
  if (!temCookieSessao) {
    return { acao: 'redirecionar-login', destino: paraLogin(caminho) }
  }

  return prosseguirComRenovacao(contexto, renovar, nonce)
}
