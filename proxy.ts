import { criarProxy } from '@erp/nucleo/proxy'
import { PREFIXOS_DE_ZONA } from './lib/zonas'

export default criarProxy({
  prefixo: '/',
  rotaLogin: '/login',
  publicos: ['/login', '/api/auth'],
  outrasAplicacoes: PREFIXOS_DE_ZONA,
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
