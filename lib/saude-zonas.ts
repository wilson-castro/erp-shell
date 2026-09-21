export interface CacheSaudeZona {
  verificar(urlSaude: string): Promise<boolean>
  limpar(): void
}

export const TTL_SAUDE_PADRAO_MS = 1000
export const TIMEOUT_PROBE_PADRAO_MS = 500

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
      return res.status < 500
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
