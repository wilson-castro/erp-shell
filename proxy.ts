import { NextResponse, type NextRequest } from 'next/server'
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
  const res = NextResponse.next({ request: { headers } })
  res.headers.set('x-nonce', nonce)
  res.headers.set(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; ` +
    `style-src 'self' 'nonce-${nonce}'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
  )
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
