import { NextResponse, type NextRequest } from 'next/server'
import { decidirAcaoDoProxy } from './lib/decisao-proxy'

export const NOME_COOKIE_SESSAO = '__Host-session'

export default async function proxy(req: NextRequest): Promise<NextResponse> {
  const caminho = req.nextUrl.pathname
  const temCookieSessao = req.cookies.has(NOME_COOKIE_SESSAO)

  const decisao = await decidirAcaoDoProxy({ caminho, temCookieSessao })

  switch (decisao.acao) {
    case 'publico':
      return aplicarCsp(NextResponse.next(), decisao.nonce)

    case 'telemetria':
    case 'zona-estatica':
      return NextResponse.next()

    case 'zona-inativa':
      return new NextResponse(decisao.html, {
        status: decisao.status,
        headers: decisao.headers,
      })

    case 'redirecionar-login':
      return new NextResponse(null, {
        status: 307,
        headers: { Location: decisao.destino },
      })

    case 'prosseguir':
      return aplicarCsp(NextResponse.next(), decisao.nonce)
  }
}

function aplicarCsp(res: NextResponse, nonce: string): NextResponse {
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
