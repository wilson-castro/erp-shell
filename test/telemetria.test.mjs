import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LimitadorDeTaxa,
  TAMANHO_MAXIMO_BYTES,
  LIMITE_LOTES_POR_MINUTO,
  processarLoteDeTelemetria,
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
