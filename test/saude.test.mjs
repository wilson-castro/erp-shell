import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criarCacheSaudeZona } from '../lib/saude-zonas.ts'

test('criarCacheSaudeZona: identifica zona saudavel quando a rota de saude responde 200', async () => {
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

// --- gate "Shell novo", iteração 2 (auditor_shell_2, U1–U4): o que a unidade não prendia ---
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

test('U1: entrada saudavel expira depois do TTL e a sonda roda de novo', async () => {
  const { criarCacheSaudeZona } = await import('../lib/saude-zonas.ts')
  let chamadas = 0
  const cache = criarCacheSaudeZona(50, 500, async () => { chamadas++; return { status: 200 } })
  await cache.verificar('http://z/zona2'); await esperar(80); await cache.verificar('http://z/zona2')
  assert.equal(chamadas, 2)
})

test('U2: entrada "fora" tambem expira: a zona volta sem reiniciar o shell', async () => {
  const { criarCacheSaudeZona } = await import('../lib/saude-zonas.ts')
  let viva = false
  const cache = criarCacheSaudeZona(50, 500, async () => { if (!viva) throw new Error('ECONNREFUSED'); return { status: 200 } })
  assert.equal(await cache.verificar('http://z/zona2'), false)
  viva = true; await esperar(80)
  assert.equal(await cache.verificar('http://z/zona2'), true)
})

test('U3 (auditor_b1_d1_2, L1): so 2xx da rota de saude e "no ar"; 404, 3xx e 5xx sao fora', async () => {
  const { criarCacheSaudeZona } = await import('../lib/saude-zonas.ts')
  for (const [status, noAr] of [[200, true], [204, true], [404, false], [307, false], [301, false], [502, false], [500, false]]) {
    assert.equal(await criarCacheSaudeZona(1000, 500, async () => ({ status })).verificar(`http://z/${status}`), noAr, String(status))
  }
})

test('L3: a sonda nao segue redirecionamento, nao usa cache e tem timeout', async () => {
  const { criarCacheSaudeZona } = await import('../lib/saude-zonas.ts')
  let opcoes
  await criarCacheSaudeZona(1000, 500, async (_u, o) => { opcoes = o; return { status: 200 } }).verificar('http://z/op')
  assert.equal(opcoes.redirect, 'manual')
  assert.equal(opcoes.cache, 'no-store')
  assert.ok(opcoes.signal instanceof AbortSignal)
})

test('U4: zona travada e dada como fora em ~500 ms (timeout padrao da sonda)', { timeout: 3000 }, async () => {
  const { criarCacheSaudeZona, TIMEOUT_PROBE_PADRAO_MS } = await import('../lib/saude-zonas.ts')
  assert.equal(TIMEOUT_PROBE_PADRAO_MS, 500)
  const travada = (_u, { signal } = {}) => new Promise((_, rej) => signal?.addEventListener('abort', () => rej(signal.reason)))
  const t0 = Date.now()
  assert.equal(await criarCacheSaudeZona(1000, undefined, travada).verificar('http://z/zona2'), false)
  assert.ok(Date.now() - t0 < 1000, `levou ${Date.now() - t0} ms`)
})

test('configuracao: lerNumeroPositivo aceita valores validos e lanca com formato invalido', async () => {
  const { lerNumeroPositivo } = await import('../lib/configuracao.ts')
  assert.equal(lerNumeroPositivo(undefined, 1000, 'TESTE'), 1000)
  assert.equal(lerNumeroPositivo('', 1000, 'TESTE'), 1000)
  assert.equal(lerNumeroPositivo('2000', 1000, 'TESTE'), 2000)
  assert.throws(() => lerNumeroPositivo('abc', 1000, 'TESTE'), /configuracao invalida: TESTE/)
  assert.throws(() => lerNumeroPositivo('-5', 1000, 'TESTE'), /configuracao invalida: TESTE/)
  assert.throws(() => lerNumeroPositivo('0', 1000, 'TESTE'), /configuracao invalida: TESTE/)
  assert.throws(() => lerNumeroPositivo('1.5', 1000, 'TESTE'), /configuracao invalida: TESTE/)
})

test('L2: parametros da sonda e da telemetria tem teto; acima dele, erro na subida', async () => {
  const { lerNumeroPositivo } = await import('../lib/configuracao.ts')
  assert.equal(lerNumeroPositivo('2000', 500, 'T', 2000), 2000)
  assert.throws(() => lerNumeroPositivo('2001', 500, 'ERP_SONDA_TIMEOUT_MS', 2000), /ERP_SONDA_TIMEOUT_MS deve ser no maximo 2000/)
  const { readFileSync } = await import('node:fs')
  const fonte = (f) => readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8')
  assert.match(fonte('saude-zonas.ts'), /'ERP_SONDA_TTL_MS', 10_000\)/)
  assert.match(fonte('saude-zonas.ts'), /'ERP_SONDA_TIMEOUT_MS', 2_000\)/)
  assert.match(fonte('telemetria.ts'), /'ERP_TELEMETRIA_MAX_BYTES', 1024 \* 1024\)/)
  assert.match(fonte('telemetria.ts'), /'ERP_TELEMETRIA_LOTES_POR_MINUTO', 600\)/)
})

// --- auditor_b1_d1_3 (L7: S05, S17) ---
test('S05: sem ERP_SONDA_TTL_MS o TTL da sonda e 1 s (docs/CONFIGURACAO.md), nao o teto', async () => {
  assert.equal(process.env.ERP_SONDA_TTL_MS, undefined, 'o teste precisa do ambiente sem a variavel')
  const { TTL_SAUDE_PADRAO_MS, TIMEOUT_PROBE_PADRAO_MS } = await import('../lib/saude-zonas.ts')
  assert.equal(TTL_SAUDE_PADRAO_MS, 1000)
  assert.equal(TIMEOUT_PROBE_PADRAO_MS, 500)
})

test('S17: zona "fora" tambem fica no cache durante o TTL: a zona caida nao e sondada a cada pedido', async () => {
  const { criarCacheSaudeZona } = await import('../lib/saude-zonas.ts')
  let chamadas = 0
  const cache = criarCacheSaudeZona(10_000, 500, async () => { chamadas++; throw new Error('ECONNREFUSED') })
  for (let i = 0; i < 5; i++) assert.equal(await cache.verificar('http://z/zona2'), false)
  assert.equal(chamadas, 1)
})
