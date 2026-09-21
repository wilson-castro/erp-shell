import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criarCacheSaudeZona } from '../lib/saude-zonas.ts'

test('criarCacheSaudeZona: identifica zona saudavel quando fetch retorna status < 500', async () => {
  // Arrange
  let chamadas = 0
  const fetchFake = async () => {
    chamadas++
    return { status: 200 }
  }
  const cache = criarCacheSaudeZona(1000, 500, fetchFake)

  // Act
  const saudavel = await cache.verificar('http://localhost:3001/zona1')

  // Assert
  assert.equal(saudavel, true)
  assert.equal(chamadas, 1)
})

test('criarCacheSaudeZona: identifica zona inativa quando fetch falha (Cenário 1)', async () => {
  // Arrange
  let chamadas = 0
  const fetchFake = async () => {
    chamadas++
    throw new Error('connect ECONNREFUSED 127.0.0.1:3001')
  }
  const cache = criarCacheSaudeZona(1000, 500, fetchFake)

  // Act
  const saudavel = await cache.verificar('http://localhost:3001/zona1')

  // Assert
  assert.equal(saudavel, false)
  assert.equal(chamadas, 1)
})

test('criarCacheSaudeZona: utiliza cache durante a janela de TTL sem repetir I/O', async () => {
  // Arrange
  let chamadas = 0
  const fetchFake = async () => {
    chamadas++
    return { status: 200 }
  }
  const cache = criarCacheSaudeZona(1000, 500, fetchFake)

  // Act
  const r1 = await cache.verificar('http://localhost:3001/zona1')
  const r2 = await cache.verificar('http://localhost:3001/zona1')

  // Assert
  assert.equal(r1, true)
  assert.equal(r2, true)
  assert.equal(chamadas, 1)
})

test('criarCacheSaudeZona: chamadas concorrentes compartilham a mesma probe em andamento', async () => {
  // Arrange
  let chamadas = 0
  const fetchFake = async () => {
    chamadas++
    await new Promise((r) => setTimeout(r, 20))
    return { status: 200 }
  }
  const cache = criarCacheSaudeZona(1000, 500, fetchFake)

  // Act
  const [r1, r2] = await Promise.all([
    cache.verificar('http://localhost:3001/zona1'),
    cache.verificar('http://localhost:3001/zona1'),
  ])

  // Assert
  assert.equal(r1, true)
  assert.equal(r2, true)
  assert.equal(chamadas, 1)
})
