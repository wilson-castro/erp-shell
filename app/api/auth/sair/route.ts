import { nucleo, vidaTransacaoS } from '@/lib/nucleo'
import { sair } from '@/lib/rotas-auth'

/** Remove do store: a sessão acaba em todas as zonas na próxima requisição, não só no shell. */
export function POST(req: Request) {
  return sair(req, { sessao: nucleo.sessao, vidaTransacaoS })
}
