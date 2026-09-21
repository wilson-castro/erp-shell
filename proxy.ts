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
  headers.set('x-erp-caminho', req.nextUrl.pathname)
  headers.delete('x-erp-flash')
  const flash = req.cookies.get('__Host-flash')?.value
  if (flash) headers.set('x-erp-flash', flash)

  const res = NextResponse.next({ request: { headers } })
  if (flash) {
    res.cookies.set('__Host-flash', '', { path: '/', maxAge: 0 })
  }
  res.headers.set('x-nonce', nonce)
  res.headers.set(
    'Content-Security-Policy',
    // A mesma política do `criarProxy` do núcleo (reviewer_shell_1, achado 2): sem
    // `form-action`, que não herda de `default-src`, e sem `img-src`, o shell ficava mais frouxo
    // que as zonas. Tirar esta cópia é o item C2 de PROPOSTA-REORGANIZACAO.md.
    `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; ` +
    `style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; object-src 'none'; ` +
    `base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
  )
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
