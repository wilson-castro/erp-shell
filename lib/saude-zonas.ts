export interface CacheSaudeZona {
  verificar(urlSaude: string): Promise<boolean>
  limpar(): void
}

export function lerNumeroPositivo(valor: string | undefined, padrao: number, nome: string): number {
  if (valor === undefined || valor === '') return padrao
  const n = Number(valor)
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(`configuracao invalida: ${nome} deve ser inteiro positivo, recebeu "${valor}"`)
  }
  return n
}

export const TTL_SAUDE_PADRAO_MS = lerNumeroPositivo(process.env.ERP_SONDA_TTL_MS, 1000, 'ERP_SONDA_TTL_MS')
export const TIMEOUT_PROBE_PADRAO_MS = lerNumeroPositivo(process.env.ERP_SONDA_TIMEOUT_MS, 500, 'ERP_SONDA_TIMEOUT_MS')

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
