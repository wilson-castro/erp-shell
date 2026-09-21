import 'server-only'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { ErroDeAplicacao, SessaoInvalida } from '@erp/nucleo'
import { MENSAGENS } from '@erp/contratos'
import { lerFlash, moduloAtivo, NOME_COOKIE_FLASH, serializarFlash, type ResultadoDeAcao, type Toast } from '@erp/moldura'

/** O proxy do núcleo consome o cookie de flash e o entrega por este cabeçalho (uma vez só). */
const CABECALHO_FLASH = 'x-erp-flash'
import { nucleo } from './nucleo'

/** Posto pelo proxy do núcleo; layouts não recebem o caminho de outra forma. */
export const caminhoAtual = async () => (await headers()).get('x-erp-caminho') ?? '/'

const irParaLogin = async (): Promise<never> =>
  redirect(`/login?de=${encodeURIComponent(await caminhoAtual())}`)

/**
 * Camada 2: o cookie existe (camada 1 já viu), mas a sessão precisa existir no store.
 * `cache` faz layout e página dividirem uma leitura por requisição.
 */
export const sessaoDaPagina = cache(async () => (await nucleo.sessao.atual()) ?? irParaLogin())

/** Uma consulta ao domínio de gestão de acesso por requisição (D7: a cada renderização). */
export const modulosPermitidos = cache(async () => {
  try {
    return await nucleo.acesso.modulosPermitidos()
  } catch (e) {
    if (e instanceof SessaoInvalida) return irParaLogin()
    throw e
  }
})

/** Módulo restrito não revela que existe: 404, sem página de "sem acesso" (D6, invariante 8). */
export async function exigirModulo(id: string): Promise<void> {
  // Fail-closed: sem confirmar o módulo, a página não renderiza. Se a gestão de acesso falhar,
  // o erro sobe e o layout mostra "Serviço indisponível"; engolir o erro aqui entregava o
  // conteúdo do módulo no payload RSC (gate "Shell novo", auditor_shell_1 V1).
  if (!(await modulosPermitidos()).some((m) => m.id === id)) notFound()
}

/**
 * Sem a gestão de acesso ninguém entra em módulo nenhum. O layout mostra a moldura com a
 * mensagem de indisponibilidade no HTML do servidor, em vez de lançar: o `global-error` do
 * Next só aparece depois da hidratação, e sem JavaScript a página ficaria em branco.
 */
export async function dadosDaMoldura() {
  const sessao = await sessaoDaPagina()
  const menu = await modulosPermitidos().catch((e: unknown) => {
    if (e instanceof ErroDeAplicacao) return null
    throw e   // redirect para o login e qualquer erro de programação seguem adiante
  })
  const flash = lerFlash((await headers()).get(CABECALHO_FLASH))
  const ativo = menu ? moduloAtivo(menu, await caminhoAtual()) : undefined
  return { usuario: { nome: sessao.nome }, menu: menu ?? [], flash, indisponivel: menu === null, ...(ativo ? { ativo } : {}) }
}

/** Toast que sobrevive à troca de documento, inclusive para outra zona. */
export async function flash(t: Toast): Promise<void> {
  (await cookies()).set(NOME_COOKIE_FLASH, serializarFlash(t), {
    path: '/', secure: true, sameSite: 'lax', maxAge: 60,
  })
}

/** Hosts do shell que servem esta aplicação ao navegador; os mesmos de `allowedOrigins`. */
const HOSTS_DO_SHELL = (process.env.SHELL_HOSTS ?? 'localhost:3000').split(',')

async function origemPermitida(): Promise<boolean> {
  const h = await headers()
  const site = h.get('sec-fetch-site')
  if (site && site !== 'same-origin') return false
  try {
    return HOSTS_DO_SHELL.includes(new URL(h.get('origin') ?? '').host)
  } catch {
    return false   // sem Origin ou Origin inválido: recusa
  }
}

/**
 * Envelope de toda Server Action. Primeiro bloco: sessão e módulo reverificados
 * (invariantes 5 e 16) — a action é endpoint público e nenhum layout roda antes dela.
 * Nunca lança para o cliente: todo erro vira `{ codigo }` num toast (invariante 12) e um
 * destino, que o `FormularioDeAcao` abre com `location.assign`. Nunca usa `redirect()`:
 * com JavaScript, o Next buscaria o destino no processo desta zona (limitação 11).
 */
export async function acaoProtegida(
  modulo: string,
  voltar: string,
  corpo: () => Promise<{ toast: Toast; destino: string }>,
): Promise<ResultadoDeAcao> {
  // A checagem de origem do Next deixa passar requisição SEM `Origin` (medido pelo
  // challenger_base_1: curl sem Origin executou a action). Aqui ela é obrigatória.
  if (!(await origemPermitida())) return { destino: '/' }
  try {
    await nucleo.sessao.exigir()
    await nucleo.acesso.exigirModulo(modulo)
  } catch (e) {
    if (e instanceof SessaoInvalida) return { destino: `/login?de=${encodeURIComponent(voltar)}` }
    await flash({ tipo: 'erro', texto: MENSAGENS.OPERACAO_NAO_PERMITIDA })
    return { destino: '/' }
  }
  try {
    const { toast, destino } = await corpo()
    await flash(toast)
    return { destino }
  } catch (e) {
    await flash({ tipo: 'erro', texto: MENSAGENS[e instanceof ErroDeAplicacao ? e.codigo : 'ERRO_INTERNO'] })
    return { destino: voltar }
  }
}
