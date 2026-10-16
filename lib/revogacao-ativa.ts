import 'server-only'
import { exigirTokenDeServico, lerIntervaloDeEventos, lerLockDeEventos } from './configuracao.ts'

/**
 * Revogação ativa de sessão por `/v2/eventos` (G5, ADR-0014, decisão 5 e adendos 2 e 3).
 * O shell consome periodicamente os eventos de revogação da gestão de acesso com credencial de serviço
 * (`svc.shell`, pelo destino `eventos-acesso`), guarda o cursor `seq` e encerra todas as sessões de
 * quem foi desligado (`PESSOA_DESLIGADA`) ou suspenso (`PESSOA_SUSPENSA`). `ACESSO_REVOGADO` só avança
 * o cursor (a sessão continua viva para outros módulos).
 */

export type EventoDeAcesso = {
  seq: number
  tipo: string
  alvo?: string | null
  sujeitos?: readonly string[]
}

export type FonteDeEventos = (desde: number) => Promise<readonly EventoDeAcesso[]>

export type CoordenadorDeEventos = {
  adquirirLock(ttlMs: number): Promise<boolean>
  lerCursor(): Promise<number>
  gravarCursor(seq: number): Promise<void>
}

export type RevogadorDeSessoes = {
  /** Dispara a sincronização se o intervalo venceu; nunca lança para quem chama (falha vai para registrarFalha). */
  sincronizarSePreciso(): Promise<void>
  /** Força uma rodada imediata (usado pelos testes de unidade). */
  sincronizarAgora(): Promise<void>
}

const EVENTOS_QUE_ENCERRAM_SESSAO = new Set(['PESSOA_DESLIGADA', 'PESSOA_SUSPENSA'])

const CHAVE_CURSOR = 'erp:eventos-acesso:cursor'
const CHAVE_LOCK = 'erp:eventos-acesso:lock'

function sujeitosDoEvento(ev: EventoDeAcesso): string[] {
  const lista: string[] = []
  if (Array.isArray(ev.sujeitos)) {
    for (const s of ev.sujeitos) {
      if (typeof s === 'string' && s.length > 0 && !lista.includes(s)) lista.push(s)
    }
  }
  if (typeof ev.alvo === 'string' && ev.alvo.length > 0 && !lista.includes(ev.alvo)) {
    lista.push(ev.alvo)
  }
  return lista
}

export function criarRevogacaoAtiva(cfg: {
  fonte: FonteDeEventos
  coordenador: CoordenadorDeEventos
  removerPorSujeito: (sub: string) => Promise<number>
  intervaloMs: number
  lockMs: number
  agora?: () => number
  registrarFalha?: (motivo: string) => void
}): RevogadorDeSessoes {
  const agora = cfg.agora ?? Date.now
  const registrar = cfg.registrarFalha ?? (() => {})
  let cursorMemoria = 0
  let lidoEm: number | null = null
  let emCurso: Promise<void> | null = null

  async function sincronizar(): Promise<void> {
    try {
      const ganhou = await cfg.coordenador.adquirirLock(cfg.lockMs)
      if (!ganhou) {
        lidoEm = agora()
        return
      }
      const cursorLido = await cfg.coordenador.lerCursor()
      const desde = Number.isInteger(cursorLido) && cursorLido >= 0
        ? Math.max(cursorMemoria, cursorLido)
        : cursorMemoria
      const brutos = await cfg.fonte(desde)
      if (!Array.isArray(brutos)) throw new Error('resposta de /v2/eventos nao e lista')
      const validos = brutos
        .filter((ev): ev is EventoDeAcesso =>
          typeof ev === 'object' && ev !== null && typeof ev.seq === 'number' && Number.isInteger(ev.seq) && ev.seq > desde,
        )
        .sort((a, b) => a.seq - b.seq)

      let ultimoSeqConcluido = desde
      try {
        for (const ev of validos) {
          if (typeof ev.tipo === 'string' && EVENTOS_QUE_ENCERRAM_SESSAO.has(ev.tipo)) {
            for (const sub of sujeitosDoEvento(ev)) {
              await cfg.removerPorSujeito(sub)
            }
          }
          ultimoSeqConcluido = ev.seq
        }
      } catch (erroNoEvento) {
        if (ultimoSeqConcluido > desde) {
          cursorMemoria = ultimoSeqConcluido
          await cfg.coordenador.gravarCursor(ultimoSeqConcluido)
        }
        throw erroNoEvento
      }

      if (ultimoSeqConcluido > desde) {
        cursorMemoria = ultimoSeqConcluido
        await cfg.coordenador.gravarCursor(ultimoSeqConcluido)
      }
      lidoEm = agora()
    } catch (e) {
      lidoEm = agora()
      registrar(`falha ao sincronizar eventos: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const disparar = (): Promise<void> => (emCurso ??= sincronizar().finally(() => { emCurso = null }))

  return {
    async sincronizarSePreciso() {
      if (emCurso) return emCurso
      if (lidoEm !== null && agora() - lidoEm < cfg.intervaloMs) return
      await disparar()
    },
    async sincronizarAgora() {
      await disparar()
    },
  }
}

function coordenadorDoShell(): CoordenadorDeEventos {
  let cursorLocal = 0
  return {
    async adquirirLock(ttlMs) {
      const { clienteRedis } = await import('./redis.ts')
      if (!clienteRedis) return true
      return (await clienteRedis.set(CHAVE_LOCK, '1', { PX: ttlMs, NX: true })) === 'OK'
    },
    async lerCursor() {
      const { clienteRedis } = await import('./redis.ts')
      if (!clienteRedis) return cursorLocal
      const bruto = await clienteRedis.get(CHAVE_CURSOR)
      if (!bruto || !/^\d+$/.test(bruto)) return 0
      const n = Number(bruto)
      return Number.isSafeInteger(n) ? n : 0
    },
    async gravarCursor(seq) {
      cursorLocal = seq
      const { clienteRedis } = await import('./redis.ts')
      // PX de 7 dias para satisfazer a assinatura de ClienteRedis.set; se vencer sem eventos novos, relê desde 0
      if (clienteRedis) await clienteRedis.set(CHAVE_CURSOR, String(seq), { PX: 604_800_000 })
    },
  }
}

function instancia(): RevogadorDeSessoes {
  return (globalThis.__erpRevogacaoAtiva ??= (exigirTokenDeServico(), criarRevogacaoAtiva({
    fonte: async (desde) => {
      const { nucleo } = await import('./nucleo.ts')
      const r = await nucleo.destino('eventos-acesso').get<EventoDeAcesso[]>('/v2/eventos', {
        query: { desde: String(desde) },
      })
      return r.body as EventoDeAcesso[]
    },
    coordenador: coordenadorDoShell(),
    removerPorSujeito: async (sub) => {
      const { nucleo } = await import('./nucleo.ts')
      return nucleo.sessao.removerSessoesDoSujeito(sub)
    },
    intervaloMs: lerIntervaloDeEventos(),
    lockMs: lerLockDeEventos(),
    registrarFalha: (m) => console.error(`[revogacao-ativa] ${m}`),
  })))
}

export const revogacaoAtiva: RevogadorDeSessoes = {
  sincronizarSePreciso: async () => instancia().sincronizarSePreciso(),
  sincronizarAgora: async () => instancia().sincronizarAgora(),
}

