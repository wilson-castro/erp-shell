import { criarGatewayDeZona } from '@/lib/gateway-zona'
import { mapaDeZonas } from '@/lib/mapa-zonas'
import { lerOciosidadeDaZona, lerTetoDaZona } from '@/lib/configuracao'
import { registrarNoConsole } from '@/lib/rotas-auth'

/**
 * Rota interna do gateway de documento (C3, ADR-0015). A pasta é `%5Fgateway` porque pasta com `_` é privada no
 * App Router; a URL é `/_gateway/...`. Só o `proxy.ts` chega aqui, reescrevendo a navegação de documento de uma
 * zona; o navegador que pede `/_gateway` recebe 404 do proxy, e a reescrita do proxy não passa de novo por ele.
 * Sessão, renovação, sonda e recusa de `_fragmento` já aconteceram no proxy.
 */
export const dynamic = 'force-dynamic'

let gateway: ((req: Request) => Promise<Response>) | undefined
const doShell = (req: Request) => (gateway ??= criarGatewayDeZona({
  mapa: mapaDeZonas,
  tetoMs: lerTetoDaZona(),
  ociosidadeMs: lerOciosidadeDaZona(),
  registrarFalha: registrarNoConsole,
}))(req)

export const GET = doShell
export const HEAD = doShell
