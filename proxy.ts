import { NextResponse, type NextRequest } from 'next/server'
import { politicaDeSeguranca, garantirTraceparent } from '@erp/nucleo/proxy'
import { decidirAcaoDoProxy } from './lib/decisao-proxy'

export const NOME_COOKIE_SESSAO = '__Host-session'

export default async function proxy(req: NextRequest): Promise<NextResponse> {
  const caminho = req.nextUrl.pathname
  const temCookieSessao = req.cookies.has(NOME_COOKIE_SESSAO)

  const decisao = await decidirAcaoDoProxy({ caminho, temCookieSessao })

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
      return NextResponse.redirect(urlAbsoluta, 307)
    }

    case 'prosseguir':
      return aplicarCsp(req, decisao.nonce)
  }
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
