import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LimitadorDeTaxa,
  TAMANHO_MAXIMO_BYTES,
  LIMITE_LOTES_POR_MINUTO,
  processarLoteDeTelemetria,
  lerComLimite,
} from '../lib/telemetria.ts'

test('telemetria: limitador permite ate 60 lotes por minuto por usuario', () => {
  // Arrange
  const limitador = new LimitadorDeTaxa(LIMITE_LOTES_POR_MINUTO, 60_000)
  const usuario = 'ana-operadora'
  const t0 = 1000

  // Act & Assert
  for (let i = 0; i < 60; i++) {
    assert.equal(limitador.consumir(usuario, t0), true, `lote ${i + 1} deve ser permitido`)
  }

  // 61o lote na mesma janela deve ser recusado
  assert.equal(limitador.consumir(usuario, t0), false, '61o lote deve ser bloqueado')
})

test('telemetria: limitador reseta a contagem apos expirar a janela', () => {
  // Arrange
  const limitador = new LimitadorDeTaxa(2, 1000)
  const usuario = 'bruno'

  // Act & Assert
  assert.equal(limitador.consumir(usuario, 0), true)
  assert.equal(limitador.consumir(usuario, 100), true)
  assert.equal(limitador.consumir(usuario, 200), false)

  // Apos 1000ms da janela inicial
  assert.equal(limitador.consumir(usuario, 1100), true)
})

test('telemetria: tamanho maximo e 256 KB', () => {
  assert.equal(TAMANHO_MAXIMO_BYTES, 262144)
})

test('processarLoteDeTelemetria: sem sessao valida descarta silenciosamente com 204', () => {
  // Arrange
  const contexto = { sessaoValida: false, tamanhoBytes: 1024 }

  // Act
  const res = processarLoteDeTelemetria(contexto)

  // Assert
  assert.equal(res.status, 204)
})

test('processarLoteDeTelemetria: payload acima de 256 KB retorna 413', () => {
  // Arrange
  const contexto = {
    sessaoValida: true,
    sub: 'ana',
    tamanhoBytes: TAMANHO_MAXIMO_BYTES + 1,
  }

  // Act
  const res = processarLoteDeTelemetria(contexto)

  // Assert
  assert.equal(res.status, 413)
})

test('processarLoteDeTelemetria: taxa excedida retorna 429 com Retry-After', () => {
  // Arrange
  const limitador = new LimitadorDeTaxa(1, 60_000)
  const contexto = {
    sessaoValida: true,
    sub: 'carla',
    tamanhoBytes: 512,
  }

  // Act
  const r1 = processarLoteDeTelemetria(contexto, limitador)
  const r2 = processarLoteDeTelemetria(contexto, limitador)

  // Assert
  assert.equal(r1.status, 204)
  assert.equal(r2.status, 429)
  assert.equal(r2.headers?.['Retry-After'], '60')
})

const fluxo = (...pedacos) => new ReadableStream({
  start(c) { for (const p of pedacos) c.enqueue(new Uint8Array(p)); c.close() },
})

test('lerComLimite: le o corpo inteiro quando cabe no limite', async () => {
  const corpo = await lerComLimite(fluxo(100, 200), 1024)
  assert.equal(corpo.byteLength, 300)
})

// timeout: uma regressão que lesse tudo travaria aqui para sempre em vez de reprovar (auditor_shell_2)
test('lerComLimite: para de ler e devolve null assim que passa do limite (sem Content-Length)', { timeout: 2000 }, async () => {
  let puxados = 0
  const infinito = new ReadableStream({ pull(c) { puxados++; c.enqueue(new Uint8Array(64 * 1024)) } })
  assert.equal(await lerComLimite(infinito, 256 * 1024), null)
  assert.ok(puxados <= 6, `leu ${puxados} pedacos de 64 KB para um limite de 256 KB`)
})

test('lerComLimite: corpo ausente e corpo vazio', async () => {
  assert.equal((await lerComLimite(null, 10)).byteLength, 0)
  assert.equal((await lerComLimite(fluxo(), 10)).byteLength, 0)
})

test('limitador: entradas de janela vencida sao descartadas, o mapa nao cresce sem limite', () => {
  const limitador = new LimitadorDeTaxa(60, 60_000, 100)
  for (let i = 0; i < 1000; i++) limitador.consumir(`u${i}`, i * 1000)   // cada um numa janela que vence
  assert.ok(limitador.tamanho() <= 100, `mapa com ${limitador.tamanho()} entradas`)
})

test('limitador: descartar vencidos nao zera quem ainda esta na janela', () => {
  const limitador = new LimitadorDeTaxa(2, 60_000, 3)
  assert.equal(limitador.consumir('ana', 0), true)
  assert.equal(limitador.consumir('ana', 1), true)
  for (let i = 0; i < 10; i++) limitador.consumir(`u${i}`, 2)            // força a limpeza
  assert.equal(limitador.consumir('ana', 3), false, 'a limpeza zerou a contagem de quem estava na janela')
})

test('configuracao: lerNumeroPositivo em telemetria valida numeros inteiros positivos', async () => {
  const { lerNumeroPositivo } = await import('../lib/configuracao.ts')
  assert.equal(lerNumeroPositivo(undefined, 60, 'TESTE'), 60)
  assert.equal(lerNumeroPositivo('', 60, 'TESTE'), 60)
  assert.equal(lerNumeroPositivo('120', 60, 'TESTE'), 120)
  assert.throws(() => lerNumeroPositivo('invalido', 60, 'TESTE'), /configuracao invalida: TESTE/)
  assert.throws(() => lerNumeroPositivo('0', 60, 'TESTE'), /configuracao invalida: TESTE/)
  assert.throws(() => lerNumeroPositivo('-10', 60, 'TESTE'), /configuracao invalida: TESTE/)
})
