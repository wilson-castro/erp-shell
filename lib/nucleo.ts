import 'server-only'
import { cookies } from 'next/headers'
import { acessoHttp, criarNucleo, identidadeDev, sessaoArquivo } from '@erp/nucleo'

const SESSAO_DIR = process.env.SESSAO_DIR ?? '/tmp/erp-sessoes'
export const NOME_COOKIE_SESSAO = '__Host-session'

/**
 * Raiz de composição do shell. Só configuração, lida do ambiente. O shell é a ÚNICA
 * aplicação com `escrita`: grava e encerra sessão; as zonas só leem (N3).
 */
export const nucleo = criarNucleo({
  app: 'shell',
  sessao: sessaoArquivo({ dir: SESSAO_DIR, modo: 'leitura' }),
  lerCookieDeSessao: async () => (await cookies()).get(NOME_COOKIE_SESSAO)?.value,
  acesso: acessoHttp({ destino: 'gestao-acesso' }),
  destinos: {
    // domínio do próprio shell (N7)
    plataforma: {
      origem: process.env.DOMINIO_PLATAFORMA_URL ?? 'http://127.0.0.1:4004',
      caminhos: ['/v1/avisos'], metodos: ['GET'], credencial: 'usuario', timeoutMs: 2000,
    },
    'gestao-acesso': {
      origem: process.env.ACESSO_URL ?? 'http://127.0.0.1:4010',
      caminhos: ['/v1/modulos-permitidos'], metodos: ['GET'], credencial: 'usuario', timeoutMs: 1000,
    },
  },
  escrita: {
    store: sessaoArquivo({ dir: SESSAO_DIR, modo: 'escrita' }),
    identidade: identidadeDev(),
  },
})
