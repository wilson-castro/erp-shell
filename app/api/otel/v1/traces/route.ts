import { NextResponse, type NextRequest } from 'next/server'
import { nucleo } from '@/lib/nucleo'
import {
  TAMANHO_MAXIMO_BYTES,
  lerComLimite,
  processarLoteDeTelemetria,
} from '@/lib/telemetria'

const vazia = (status: number, headers?: Record<string, string>) =>
  new NextResponse(null, { status, ...(headers ? { headers } : {}) })

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Sem sessão: 204 e descarta, sem ler o corpo e sem repassar (a rota não exige cookie no proxy).
  const sessao = await nucleo.sessao.atual().catch(() => null)
  if (!sessao) return vazia(204)

  const declarado = Number(req.headers.get('content-length'))
  if (Number.isFinite(declarado) && declarado > TAMANHO_MAXIMO_BYTES) return vazia(413)
  const corpo = await lerComLimite(req.body, TAMANHO_MAXIMO_BYTES)
  if (corpo === null) return vazia(413)

  const resultado = processarLoteDeTelemetria({
    sessaoValida: true,
    sub: sessao.sub,
    tamanhoBytes: corpo.byteLength,
  })
  if (resultado.status !== 204) return vazia(resultado.status, resultado.headers)

  // OTLP/HTTP em JSON. O repasse passa pelo registro de destinos, que serializa JSON.
  let lote: unknown
  try { lote = JSON.parse(new TextDecoder().decode(corpo)) } catch { return vazia(400) }
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    try {
      await nucleo.destino('coletor-otel').post('/v1/traces', { corpo: lote })
    } catch {
      // coletor fora não derruba a página de quem mandou o lote
    }
  }
  return vazia(204)
}
