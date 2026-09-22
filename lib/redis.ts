import 'server-only'
import { createClient } from 'redis'
import type { ClienteRedis } from '@erp/nucleo'

/**
 * Cliente do store de sessão (ADR-0002), só se `REDIS_URL` estiver definido (docs/CONFIGURACAO.md);
 * sem ele a app usa o store em arquivo de desenvolvimento. Conecta na primeira chamada e, se a
 * conexão falhar, a próxima chamada tenta de novo: Redis fora vira erro normalizado no núcleo,
 * nunca "deslogado" silencioso nem processo derrubado.
 */
function clientePreguicoso(url: string): ClienteRedis {
  const criar = () => createClient({ url })
    .on('error', () => { /* a falha chega ao chamador pelo comando; o evento só não pode derrubar o processo */ })
  let conexao: Promise<ReturnType<typeof criar>> | undefined
  const conectado = () => (conexao ??= criar().connect().catch((e: unknown) => { conexao = undefined; throw e }))
  return {
    get: async (chave) => (await conectado()).get(chave),
    set: async (chave, valor, opcoes) => (await conectado()).set(chave, valor, opcoes),
    del: async (chave) => (await conectado()).del(chave),
  }
}

const url = process.env.REDIS_URL
export const clienteRedis: ClienteRedis | null = url ? clientePreguicoso(url) : null
