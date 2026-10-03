import 'server-only'
import { createClient } from 'redis'
import type { ClienteRedis } from '@erp/nucleo'

/** O pedaço do node-redis que o invólucro usa: o cliente conectado de `createClient`. */
type NodeRedis = Pick<ReturnType<typeof createClient>, 'get' | 'set' | 'del' | 'getDel'>

/**
 * O `ClienteRedis` do núcleo sobre um node-redis. O store de escrita 0.10.0 usa `GETDEL`
 * (transação de login de uso único) e `SET PX` com `NX` (lock de renovação) ou `XX` (regravar só
 * sessão que ainda existe); as opções vão na forma atual do node-redis (`expiration`, `condition`).
 */
export function adaptarCliente(conectado: () => Promise<NodeRedis>): ClienteRedis {
  return {
    get: async (chave) => (await conectado()).get(chave),
    set: async (chave, valor, { PX, NX, XX }) =>
      (await conectado()).set(chave, valor, {
        expiration: { type: 'PX', value: PX },
        ...(NX ? { condition: 'NX' as const } : XX ? { condition: 'XX' as const } : {}),
      }),
    del: async (chave) => (await conectado()).del(chave),
    getDel: async (chave) => (await conectado()).getDel(chave),
  }
}

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
  return adaptarCliente(conectado)
}

const url = process.env.REDIS_URL
export const clienteRedis: ClienteRedis | null = url ? clientePreguicoso(url) : null
