import { NextResponse, type NextRequest } from 'next/server'
import { politicaDeSeguranca, garantirTraceparent } from '@erp/nucleo/proxy'
import { decidirAcaoDoProxy } from './lib/decisao-proxy'
import { cacheSaudePadrao } from './lib/saude-zonas'
import { NOME_COOKIE_SESSAO, apagarCookie } from './lib/cookies'
import { nucleo } from './lib/nucleo'

export default async function proxy(req: NextRequest): Promise<NextResponse> {
  const caminho = req.nextUrl.pathname
  const idSessao = req.cookies.get(NOME_COOKIE_SESSAO)?.value
  const temCookieSessao = req.cookies.has(NOME_COOKIE_SESSAO)

  // Renovação proativa (ADR-0013, decisão 4): toda requisição a zona ou página do shell passa aqui.
  // Lock, releitura e gravação ficam na fábrica do núcleo; o proxy só decide o que fazer com o resultado.
  const decisao = await decidirAcaoDoProxy(
    { caminho, temCookieSessao, idSessao, metodo: req.method },
    cacheSaudePadrao, undefined, nucleo.sessao.renovarSessao,
  )

  switch (decisao.acao) {
    case 'publico':
      return aplicarCsp(req, decisao.nonce)

    case 'telemetria':
    case 'zona-estatica':
      return NextResponse.next()

    case 'zona-inativa':
      return new NextResponse(decisao.html, {
        status: decisao.status,
        headers: decisao.headers,
      })

    case 'redirecionar-login': {
      const urlAbsoluta = new URL(decisao.destino, req.url)
      return semSessaoSe(decisao.limparSessao, NextResponse.redirect(urlAbsoluta, 307))
    }

    case 'prosseguir':
      return semSessaoSe(decisao.limparSessao, aplicarCsp(req, decisao.nonce))
  }
}

/** Sessão revogada ou ausente do store: o cookie que aponta para ela sai junto com a resposta. */
function semSessaoSe(limpar: true | undefined, res: NextResponse): NextResponse {
  if (limpar) res.headers.append('Set-Cookie', apagarCookie(NOME_COOKIE_SESSAO))
  return res
}

function aplicarCsp(req: NextRequest, nonce: string): NextResponse {
  const headers = new Headers(req.headers)
  headers.set('x-nonce', nonce)
  headers.set('x-erp-caminho', req.nextUrl.pathname)
  headers.set('Content-Security-Policy', politicaDeSeguranca(nonce))
  // núcleo 8: um trace por requisição, reaproveitando o do navegador se vier válido
  headers.set('traceparent', garantirTraceparent(req.headers.get('traceparent')))
  headers.delete('x-erp-flash')
  const flash = req.cookies.get('__Host-flash')?.value
  if (flash) headers.set('x-erp-flash', flash)

  const res = NextResponse.next({ request: { headers } })
  if (flash) {
    // __Host- exige Secure também na remoção; sem ele o navegador ignora o Set-Cookie e o
    // toast volta a cada página do shell (reviewer_shell_2). Mesmos atributos do criarProxy.
    res.cookies.set('__Host-flash', '', { path: '/', secure: true, sameSite: 'lax', maxAge: 0 })
  }
  res.headers.set('x-nonce', nonce)
  res.headers.set('Content-Security-Policy', politicaDeSeguranca(nonce))
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
