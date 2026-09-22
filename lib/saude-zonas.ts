import { lerNumeroPositivo } from './configuracao.ts'

export interface CacheSaudeZona {
  verificar(urlSaude: string): Promise<boolean>
  limpar(): void
}

// tetos: TTL longo manteria uma zona caída como "no ar"; timeout acima de 2 s quebra o 503 rápido (L7)
export const TTL_SAUDE_PADRAO_MS = lerNumeroPositivo(process.env.ERP_SONDA_TTL_MS, 1000, 'ERP_SONDA_TTL_MS', 10_000)
export const TIMEOUT_PROBE_PADRAO_MS = lerNumeroPositivo(process.env.ERP_SONDA_TIMEOUT_MS, 500, 'ERP_SONDA_TIMEOUT_MS', 2_000)

interface EntradaCache {
  readonly saudavel: boolean
  readonly expiraEm: number
}

export function criarCacheSaudeZona(
  ttlMs: number = TTL_SAUDE_PADRAO_MS,
  timeoutMs: number = TIMEOUT_PROBE_PADRAO_MS,
  fetchFn: typeof fetch = fetch
): CacheSaudeZona {
  const cache = new Map<string, EntradaCache>()
  const emAndamento = new Map<string, Promise<boolean>>()

  async function executarProbe(url: string): Promise<boolean> {
    try {
      const res = await fetchFn(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
        cache: 'no-store',
      })
      // a sonda pergunta a `/{zona}/api/health`, pública: só 2xx é "no ar". 404 é zona sem a rota
      // (outro processo na porta), 3xx é quem responde não ser a zona (auditor_b1_d1_2, L1)
      return res.status >= 200 && res.status < 300
    } catch {
      return false
    }
  }

  return {
    async verificar(urlSaude: string): Promise<boolean> {
      const agora = Date.now()
      const entrada = cache.get(urlSaude)
      if (entrada && agora < entrada.expiraEm) {
        return entrada.saudavel
      }

      const pendente = emAndamento.get(urlSaude)
      if (pendente) return pendente

      const promessa = executarProbe(urlSaude)
        .then((saudavel) => {
          cache.set(urlSaude, { saudavel, expiraEm: Date.now() + ttlMs })
          return saudavel
        })
        .finally(() => {
          emAndamento.delete(urlSaude)
        })

      emAndamento.set(urlSaude, promessa)
      return promessa
    },
    limpar() {
      cache.clear()
      emAndamento.clear()
    },
  }
}

export const cacheSaudePadrao = criarCacheSaudeZona()
