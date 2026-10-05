import { nucleo } from '@/lib/nucleo'
import { retorno } from '@/lib/rotas-auth'

/** Volta do IdP (ou da página de dev): conclui o login e grava a sessão. Ver `lib/rotas-auth.ts`. */
export function GET(req: Request) {
  return retorno(req, { sessao: nucleo.sessao })
}
