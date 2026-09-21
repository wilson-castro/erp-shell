import 'server-only'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { SessaoInvalida } from '@erp/nucleo'
import { lerFlash, moduloAtivo, NOME_COOKIE_FLASH, serializarFlash, type Toast } from '@erp/moldura'
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
  if (!(await modulosPermitidos()).some((m) => m.id === id)) notFound()
}

export async function dadosDaMoldura() {
  const sessao = await sessaoDaPagina()
  const menu = await modulosPermitidos()
  const flash = lerFlash((await cookies()).get(NOME_COOKIE_FLASH)?.value)
  const ativo = moduloAtivo(menu, await caminhoAtual())
  return { usuario: { nome: sessao.nome }, menu, flash, ...(ativo ? { ativo } : {}) }
}

/**
 * Primeiro bloco de toda Server Action (invariante 5): ela é endpoint público, e nenhum
 * layout roda antes dela. Sessão e módulo são reverificados aqui.
 */
export async function exigirNaAcao(modulo: string): Promise<void> {
  await nucleo.sessao.exigir()
  await nucleo.acesso.exigirModulo(modulo)
}

/** Toast que sobrevive à troca de documento, inclusive para outra zona. */
export async function flash(t: Toast): Promise<void> {
  (await cookies()).set(NOME_COOKIE_FLASH, serializarFlash(t), {
    path: '/', secure: true, sameSite: 'lax', maxAge: 60,
  })
}
