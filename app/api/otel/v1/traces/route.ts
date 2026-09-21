import { NextResponse, type NextRequest } from 'next/server'
import { nucleo } from '@/lib/nucleo'
import {
  TAMANHO_MAXIMO_BYTES,
  processarLoteDeTelemetria,
} from '@/lib/telemetria'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const sessao = await nucleo.sessao.atual().catch(() => null)
  const tamanhoCabecalho = req.headers.get('content-length')
  let tamanhoBytes = tamanhoCabecalho ? Number(tamanhoCabecalho) : 0

  let corpo: ArrayBuffer | null = null
  if (tamanhoBytes <= TAMANHO_MAXIMO_BYTES) {
    corpo = await req.arrayBuffer()
    tamanhoBytes = corpo.byteLength
  }

  const sub = sessao?.sub
  const resultado = processarLoteDeTelemetria({
    sessaoValida: Boolean(sessao),
    ...(sub !== undefined ? { sub } : {}),
    tamanhoBytes,
  })

  if (resultado.status !== 204) {
    const init: ResponseInit = {
      status: resultado.status,
      ...(resultado.headers ? { headers: resultado.headers } : {}),
    }
    return new NextResponse(
      resultado.status === 413 ? 'Payload Too Large' : 'Too Many Requests',
      init
    )
  }

  const upstream = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (upstream && corpo) {
    try {
      const despachar = globalThis['fetch']
      await despachar(`${upstream}/v1/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': req.headers.get('content-type') ?? 'application/json',
        },
        body: corpo,
        signal: AbortSignal.timeout(3000),
      })
    } catch {
      // Repasse silencioso
    }
  }

  return new NextResponse(null, { status: 204 })
}
