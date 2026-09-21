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
  | { readonly acao: 'redirecionar-login'; readonly destino: string }
  | { readonly acao: 'prosseguir'; readonly nonce: string }

export interface ContextoRequisicaoProxy {
  readonly caminho: string
  readonly temCookieSessao: boolean
}

export async function decidirAcaoDoProxy(
  contexto: ContextoRequisicaoProxy,
  cacheSaude: CacheSaudeZona = cacheSaudePadrao,
  zonas?: readonly DefinicaoDeZona[]
): Promise<DecisaoProxy> {
  const { caminho, temCookieSessao } = contexto
  const nonce = crypto.randomUUID().replaceAll('-', '')

  // 1. Rotas reservadas públicas do shell
  if (
    caminho === '/login' ||
    caminho.startsWith('/login/') ||
    caminho.startsWith('/api/auth') ||
    caminho === '/erro-de-zona' ||
    caminho.startsWith('/erro-de-zona/')
  ) {
    return { acao: 'publico', nonce }
  }

  // 2. Gateway de telemetria das zonas: tratado pelo route handler do shell
  if (caminho.startsWith('/api/otel')) {
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
      return {
        acao: 'redirecionar-login',
        destino: `/login?de=${encodeURIComponent(caminho)}`,
      }
    }

    return { acao: 'prosseguir', nonce }
  }

  // 4. Rotas da própria aplicação shell (ex.: '/')
  if (!temCookieSessao) {
    return {
      acao: 'redirecionar-login',
      destino: `/login?de=${encodeURIComponent(caminho)}`,
    }
  }

  return { acao: 'prosseguir', nonce }
}
