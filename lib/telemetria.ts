import { lerNumeroPositivo } from './configuracao.ts'

export const TAMANHO_MAXIMO_BYTES = lerNumeroPositivo(process.env.ERP_TELEMETRIA_MAX_BYTES, 256 * 1024, 'ERP_TELEMETRIA_MAX_BYTES', 1024 * 1024)
export const LIMITE_LOTES_POR_MINUTO = lerNumeroPositivo(process.env.ERP_TELEMETRIA_LOTES_POR_MINUTO, 60, 'ERP_TELEMETRIA_LOTES_POR_MINUTO', 600)
export const JANELA_TAXA_MS = 60 * 1000

interface EntradaTaxa {
  contagem: number
  janelaInicio: number
}

export class LimitadorDeTaxa {
  private readonly registros = new Map<string, EntradaTaxa>()
  private readonly maximoPorJanela: number
  private readonly janelaMs: number
  private readonly limpezaAcimaDe: number

  /**
   * `limpezaAcimaDe`: quando o mapa passa deste tamanho, as entradas de janela vencida saem.
   * Sem isso, cada usuário que já mandou um lote ficava na memória do processo para sempre.
   */
  constructor(
    maximoPorJanela = LIMITE_LOTES_POR_MINUTO,
    janelaMs = JANELA_TAXA_MS,
    limpezaAcimaDe = 10_000
  ) {
    this.maximoPorJanela = maximoPorJanela
    this.janelaMs = janelaMs
    this.limpezaAcimaDe = limpezaAcimaDe
  }

  tamanho(): number {
    return this.registros.size
  }

  consumir(identificador: string, agora = Date.now()): boolean {
    if (this.registros.size >= this.limpezaAcimaDe) {
      for (const [id, e] of this.registros) {
        if (agora - e.janelaInicio >= this.janelaMs) this.registros.delete(id)
      }
    }
    const atual = this.registros.get(identificador)
    if (!atual || agora - atual.janelaInicio >= this.janelaMs) {
      this.registros.set(identificador, { contagem: 1, janelaInicio: agora })
      return true
    }

    if (atual.contagem >= this.maximoPorJanela) {
      return false
    }

    atual.contagem += 1
    return true
  }

  limpar(): void {
    this.registros.clear()
  }
}

export const limitadorTelemetria = new LimitadorDeTaxa()

export interface ContextoTelemetria {
  readonly sessaoValida: boolean
  readonly sub?: string
  readonly tamanhoBytes: number
}

export interface RespostaProcessamentoTelemetria {
  readonly status: 204 | 413 | 429
  readonly headers?: Record<string, string>
}

export function processarLoteDeTelemetria(
  contexto: ContextoTelemetria,
  limitador: LimitadorDeTaxa = limitadorTelemetria
): RespostaProcessamentoTelemetria {
  // 1. Sem sessão ativa, responde 204 e descarta em silêncio
  if (!contexto.sessaoValida) {
    return { status: 204 }
  }

  // 2. Tamanho máximo: 256 KB
  if (contexto.tamanhoBytes > TAMANHO_MAXIMO_BYTES) {
    return { status: 413 }
  }

  // 3. Limite de taxa: 60 lotes por minuto por usuário
  const chave = contexto.sub ?? 'desconhecido'
  if (!limitador.consumir(chave)) {
    return {
      status: 429,
      headers: { 'Retry-After': '60' },
    }
  }

  return { status: 204 }
}

/**
 * Lê o corpo até `limite` bytes. Passou do limite: cancela a leitura e devolve `null`. O
 * `Content-Length` não basta, porque um corpo em chunks não o tem e um cliente pode mentir;
 * ler tudo para medir depois deixava qualquer um alocar memória arbitrária no shell.
 */
export async function lerComLimite(
  corpo: ReadableStream<Uint8Array> | null,
  limite: number
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!corpo) return new Uint8Array(0)
  const leitor = corpo.getReader()
  const pedacos: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    total += value.byteLength
    if (total > limite) {
      await leitor.cancel().catch(() => {})
      return null
    }
    pedacos.push(value)
  }
  const tudo = new Uint8Array(total)
  let pos = 0
  for (const p of pedacos) { tudo.set(p, pos); pos += p.byteLength }
  return tudo
}
