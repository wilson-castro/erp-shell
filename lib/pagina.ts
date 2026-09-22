import 'server-only'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { criarPaginas } from '@erp/nucleo/app'
import { criarMolduraDoServidor } from '@erp/moldura/servidor'
import { nucleo } from './nucleo'

// Só a ligação com o Next. A decisão de acesso (sessão, módulo, origem da action) é do núcleo e a
// parte visual (menu, toast, destino) é da moldura, uma cópia só para as quatro apps (ADR-0012).

const cabecalho = async (nome: string) => (await headers()).get(nome)

const paginas = criarPaginas(nucleo, {
  // Hosts do shell que servem esta aplicação ao navegador; os mesmos de `allowedOrigins`.
  hostsPermitidos: (process.env.SHELL_HOSTS ?? 'localhost:3000').split(','),
  next: { cabecalho, naoEncontrado: notFound, redirecionar: redirect, porRequisicao: cache },
  // Entrada de menu de quem tem papel na gestão de acesso; a mesma em toda app (moldura comum).
  entradaAdministrativa: { id: 'acesso', rotulo: 'Gestão de acesso', prefixo: '/acesso' },
})

const moldura = criarMolduraDoServidor({
  paginas,
  cabecalho,
  gravarCookie: async (nome, valor, atributos) => { (await cookies()).set(nome, valor, atributos) },
})

export const { caminhoAtual, sessaoDaPagina, acessoEfetivo, modulosPermitidos, exigirModulo, exigirPapel } = paginas
export const { dadosDaMoldura, flash, acaoProtegida } = moldura
