export const TAMANHO_MAXIMO_BYTES = 256 * 1024 // 256 KB
export const LIMITE_LOTES_POR_MINUTO = 60
export const JANELA_TAXA_MS = 60 * 1000

interface EntradaTaxa {
  contagem: number
  janelaInicio: number
}

export class LimitadorDeTaxa {
  private readonly registros = new Map<string, EntradaTaxa>()
  private readonly maximoPorJanela: number
  private readonly janelaMs: number

  constructor(
    maximoPorJanela = LIMITE_LOTES_POR_MINUTO,
    janelaMs = JANELA_TAXA_MS
  ) {
    this.maximoPorJanela = maximoPorJanela
    this.janelaMs = janelaMs
  }

  consumir(identificador: string, agora = Date.now()): boolean {
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
