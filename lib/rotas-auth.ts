import 'server-only'
import { randomUUID } from 'node:crypto'
import type { ConfigDoNucleoDoShell, NucleoDoShell } from '@erp/nucleo/shell'
import { NOME_COOKIE_LOGIN, NOME_COOKIE_SESSAO, apagarCookie, cookieDoShell, lerCookie } from './cookies.ts'
import { destinoInterno } from './destino-interno.ts'

/** Falha registrada no servidor: só a etapa e o par que o navegador também vê. */
export type FalhaDeAutenticacao = {
  etapa: 'entrar' | 'retorno' | 'sair'
  codigo: 'ERRO_INTERNO' | 'OPERACAO_NAO_PERMITIDA'
  supportId: string
}

/** Falha que o núcleo registra no servidor (hoje só `janela-de-renovacao`): motivo, código e `supportId`. */
export type FalhaDoNucleo = Parameters<NonNullable<ConfigDoNucleoDoShell['registrarFalha']>>[0]

/**
 * Falha de zona no gateway ou no proxy (C3): a zona, o motivo, o código e o `supportId` que a página da
 * base mostra. `teto`: sem cabeçalhos dentro de `ERP_ZONA_TETO_MS`; `conexao`: a zona recusou ou caiu antes
 * dos cabeçalhos; `ociosidade`: resposta parada depois do primeiro byte; `mapa-vazio`: sem fonte nem guarda; `sonda`: a sonda de saúde
 * deu a zona como fora.
 */
export type FalhaDeZona = {
  zona: string
  motivo: 'teto' | 'conexao' | 'ociosidade' | 'mapa-vazio' | 'sonda'
  codigo: 'ERRO_INTERNO'
  supportId: string
}

export type DependenciasDeAutenticacao = {
  sessao: Pick<NucleoDoShell['sessao'], 'iniciarLogin' | 'concluirLogin' | 'encerrarSessao'>
  registrarFalha?: (falha: FalhaDeAutenticacao) => void
}

/** `sair` confere a origem do pedido: `SHELL_HOSTS`, os mesmos hosts de `hostsPermitidos` das páginas. */
export type DependenciasDeSaida = DependenciasDeAutenticacao & { hostsDoShell: readonly string[] }

/** Location relativo quando é do shell: a URL absoluta de `req.url` pode ser a origem interna do processo. */
function irPara(destino: string, ...cookies: string[]): Response {
  const headers = new Headers({ Location: destino })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(null, { status: 303, headers })
}

/**
 * O pedido veio de uma página do próprio shell? `Sec-Fetch-Site` decide quando vem: só `same-origin`
 * passa (`same-site` é outro subdomínio, que não é o shell). Sem ele (navegador antigo), `Origin`
 * presente tem de ser de um host do shell COM o esquema da requisição: `http://` e `https://` do
 * mesmo host são origens diferentes. Sem nenhum dos dois, aceita: não é navegador moderno num
 * formulário de outro site, e o `SameSite=Lax` do cookie já impede encerrar a sessão de lá.
 */
function mesmaOrigem(req: Request, hostsDoShell: readonly string[]): boolean {
  const site = req.headers.get('sec-fetch-site')
  if (site !== null) return site === 'same-origin'
  const origem = req.headers.get('origin')
  if (origem === null) return true
  try {
    const o = new URL(origem)
    return o.protocol === new URL(req.url).protocol && hostsDoShell.includes(o.host)
  } catch {
    return false   // `Origin: null` (documento opaco) ou valor que não é URL
  }
}

/**
 * O registrador do shell no servidor: uma linha, só a etapa (ou o motivo do núcleo, ou a zona e o motivo),
 * o código e o `supportId`. Serve às rotas de autenticação, ao núcleo (`registrarFalha` em `lib/nucleo.ts`)
 * e ao roteamento de zona (proxy e gateway).
 */
export function registrarNoConsole(f: FalhaDeAutenticacao | FalhaDoNucleo | FalhaDeZona): void {
  if ('zona' in f) {
    console.error(`[zona] ${f.zona}: motivo=${f.motivo} codigo=${f.codigo} supportId=${f.supportId}`)
    return
  }
  const onde = 'etapa' in f ? `${f.etapa} falhou:` : `renovacao: motivo=${f.motivo}`
  console.error(`[auth] ${onde} codigo=${f.codigo} supportId=${f.supportId}`)
}

/**
 * IdP ou store fora (o núcleo lança erro já normalizado): volta ao login com `{ codigo, supportId }`
 * na URL e nada mais (invariante 12). A causa não atravessa; o `supportId` liga a tela ao log.
 */
function falhar(etapa: FalhaDeAutenticacao['etapa'], deps: DependenciasDeAutenticacao, ...cookies: string[]): Response {
  const falha: FalhaDeAutenticacao = { etapa, codigo: 'ERRO_INTERNO', supportId: randomUUID() }
  ;(deps.registrarFalha ?? registrarNoConsole)(falha)
  const busca = new URLSearchParams({ erro: falha.codigo, suporte: falha.supportId })
  return irPara(`/login?${busca}`, ...cookies)
}

/**
 * `GET /api/auth/entrar?de=/caminho` (link, não formulário: `form-action 'self'` barraria o 303
 * para o IdP depois de um POST). A fábrica guarda a transação no store; o navegador leva só o id,
 * em `__Host-erp-login`, e vai para o IdP (ou para `/login/dev`, com a identidade de dev).
 */
export async function entrar(req: Request, deps: DependenciasDeAutenticacao): Promise<Response> {
  const de = destinoInterno(new URL(req.url).searchParams.get('de'))
  let inicio: Awaited<ReturnType<DependenciasDeAutenticacao['sessao']['iniciarLogin']>>
  try {
    inicio = await deps.sessao.iniciarLogin(de)
  } catch {
    return falhar('entrar', deps)
  }
  // o cookie vive o mesmo que a transação no store: `expiraEm` vem do núcleo (`ERP_LOGIN_TRANSACAO_S`)
  const vidaS = Math.max(0, Math.ceil((inicio.expiraEm - Date.now()) / 1000))
  return irPara(inicio.url, cookieDoShell(NOME_COOKIE_LOGIN, inicio.idTransacao, vidaS))
}

/**
 * `GET /api/auth/retorno`: o IdP (ou a página de dev) devolve o navegador aqui. A fábrica consome a
 * transação (uso único, mesmo recusada), conclui e grava uma sessão com id NOVO. O cookie da
 * transação é apagado em toda saída. O destino vem da transação, nunca da URL de retorno.
 */
export async function retorno(req: Request, deps: DependenciasDeAutenticacao): Promise<Response> {
  const idTransacao = lerCookie(req, NOME_COOKIE_LOGIN)
  const parametros = Object.fromEntries(new URL(req.url).searchParams)
  const semTransacao = apagarCookie(NOME_COOKIE_LOGIN)
  let r: { id: string; destino: string } | null
  try {
    r = await deps.sessao.concluirLogin(idTransacao, parametros)
  } catch {
    // a transação já foi consumida: o único caminho é começar o login de novo
    return falhar('retorno', deps, semTransacao)
  }
  if (!r) return irPara('/login', semTransacao)
  return irPara(destinoInterno(r.destino), cookieDoShell(NOME_COOKIE_SESSAO, r.id), semTransacao)
}

/**
 * `POST /api/auth/sair`: um formulário de outro site recebe `403` com `{ codigo, supportId }` e nada
 * muda: nem o cookie é apagado nem o store é tocado (logout CSRF, N2 da revisão final do D2).
 * Da mesma origem, a fábrica remove a sessão do store ANTES de pedir ao IdP a URL de logout,
 * então ela acaba em todas as zonas na próxima requisição. Se o IdP falhar, a sessão local já
 * acabou: o cookie é apagado do mesmo jeito e o navegador vai ao login do shell. A URL do IdP não
 * leva token, só `client_id` e `post_logout_redirect_uri` (invariante 1).
 */
export async function sair(req: Request, deps: DependenciasDeSaida): Promise<Response> {
  if (!mesmaOrigem(req, deps.hostsDoShell)) {
    const falha: FalhaDeAutenticacao = { etapa: 'sair', codigo: 'OPERACAO_NAO_PERMITIDA', supportId: randomUUID() }
    ;(deps.registrarFalha ?? registrarNoConsole)(falha)
    return Response.json({ codigo: falha.codigo, supportId: falha.supportId }, { status: 403 })
  }
  const semSessao = apagarCookie(NOME_COOKIE_SESSAO)
  try {
    const { urlLogout } = await deps.sessao.encerrarSessao(lerCookie(req, NOME_COOKIE_SESSAO))
    return irPara(urlLogout ?? '/login', semSessao)
  } catch {
    ;(deps.registrarFalha ?? registrarNoConsole)({ etapa: 'sair', codigo: 'ERRO_INTERNO', supportId: randomUUID() })
    return irPara('/login', semSessao)
  }
}
