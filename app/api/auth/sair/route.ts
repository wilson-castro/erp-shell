import { nucleo } from '@/lib/nucleo'
import { lerHostsDoShell } from '@/lib/configuracao'
import { sair } from '@/lib/rotas-auth'

// Hosts do shell que servem esta aplicação ao navegador; os mesmos de `hostsPermitidos` (lib/pagina.ts).
const hostsDoShell = lerHostsDoShell()

/**
 * Remove do store: a sessão acaba em todas as zonas na próxima requisição, não só no shell.
 * Só da mesma origem; de outro site, `403` (lib/rotas-auth.ts).
 */
export function POST(req: Request) {
  return sair(req, { sessao: nucleo.sessao, hostsDoShell })
}
