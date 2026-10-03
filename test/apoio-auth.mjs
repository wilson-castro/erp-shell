// Apoio dos testes de renovação e das rotas de autenticação: a fábrica REAL do núcleo do shell,
// com store em memória ou num Redis falso que segue o contrato de `SET NX/XX PX` e `GETDEL`.
import { criarNucleoDoShell, sessaoRedisDeEscrita } from '@erp/nucleo/shell'
import { sessaoRedis } from '@erp/nucleo'
import { acessoFake, sessaoMemoria } from '@erp/nucleo/testing'

/** Redis falso: o mínimo que `sessaoRedisDeEscrita` usa, com TTL e as condições NX e XX. */
export function redisFalso() {
  const m = new Map()
  const viva = (k) => {
    const e = m.get(k)
    if (e && Date.now() >= e.expira) m.delete(k)
    return m.get(k)
  }
  return {
    chaves: () => [...m.keys()].filter((k) => viva(k)),
    async get(k) { return viva(k)?.valor ?? null },
    async set(k, valor, { PX, NX, XX } = {}) {
      const existe = viva(k) !== undefined
      if ((NX && existe) || (XX && !existe)) return null
      m.set(k, { valor, expira: PX ? Date.now() + PX : Infinity })
      return 'OK'
    },
    async del(k) { return m.delete(k) ? 1 : 0 },
    async getDel(k) {
      const v = viva(k)?.valor ?? null
      m.delete(k)
      return v
    },
  }
}

/** Os dois stores do ADR-0013 (Consequências): memória e Redis falso com NX. */
export const STORES = {
  memoria: () => {
    const s = sessaoMemoria()
    return { leitor: s, escritor: s }
  },
  'redis falso': () => {
    const cliente = redisFalso()
    return { leitor: sessaoRedis({ cliente }), escritor: sessaoRedisDeEscrita({ cliente }) }
  },
}

/** Sessão de teste com o token dentro da janela de renovação (padrão de 60 s). */
export function sessaoVencendo(sub = 'ana') {
  const agora = Date.now()
  return {
    sub, nome: 'Ana Operadora', accessToken: `antigo.${sub}`, refreshToken: `refresh.${sub}`,
    expiraEm: agora + 1_800_000, tokenExpiraEm: agora + 10_000,
  }
}

/**
 * Provedor falso que conta as renovações. `renovar` só termina quando o teste chamar
 * `liberar()`: é o que deixa ver quem espera e quem não espera pela ida ao IdP.
 */
export function identidadeContada({ resultado = 'renovada', urlLogout = null } = {}) {
  let chamadas = 0
  let liberar
  const liberado = new Promise((r) => { liberar = r })
  const identidade = {
    async iniciar() { throw new Error('nao usado') },
    async concluir() { return null },
    async renovar(s) {
      chamadas++
      await liberado
      if (resultado === 'lanca') throw new Error('IdP fora do ar')
      if (resultado === 'revogada') return { status: 'revogada' }
      return {
        status: 'renovada',
        sessao: { ...s, accessToken: `novo.${s.sub}`, tokenExpiraEm: Date.now() + 300_000 },
      }
    },
    async encerrar() { return { urlLogout } },
  }
  return { identidade, chamadas: () => chamadas, liberar: () => liberar() }
}

/** A fábrica real do shell, como `lib/nucleo.ts` a monta, sem destinos nem cookie de requisição. */
export function nucleoDoShell({ leitor, escritor }, identidade) {
  return criarNucleoDoShell({
    app: 'shell',
    sessao: leitor,
    lerCookieDeSessao: async () => undefined,
    acesso: acessoFake({ modulos: [], administra: false }),
    destinos: {},
    escrita: { store: escritor, identidade },
  })
}

/** Deixa a fila de microtarefas e de I/O andar até `condicao()` valer, sem relógio. */
export async function ateQue(condicao, voltas = 200) {
  for (let i = 0; i < voltas && !condicao(); i++) await new Promise((r) => setImmediate(r))
}
