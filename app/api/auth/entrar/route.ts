import { nucleo } from '@/lib/nucleo'
import { entrar } from '@/lib/rotas-auth'

/** Começa o login (ADR-0013, decisão 6). A lógica está em `lib/rotas-auth.ts`, testada fora do Next. */
export function GET(req: Request) {
  return entrar(req, { sessao: nucleo.sessao })
}
