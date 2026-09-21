import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ehRotaReservada,
  carregarZonas,
  encontrarZonaPorCaminho,
  gerarRewrites,
  ROTAS_RESERVADAS,
} from '../lib/zonas.ts'

test('ehRotaReservada: identifica corretamente rotas reservadas do shell', () => {
  // Arrange & Act & Assert
  assert.equal(ehRotaReservada('/'), true)
  assert.equal(ehRotaReservada('/login'), true)
  assert.equal(ehRotaReservada('/login?de=/zona1'), true)
  assert.equal(ehRotaReservada('/erro-de-zona'), true)
  assert.equal(ehRotaReservada('/api/auth/entrar'), true)
  assert.equal(ehRotaReservada('/api/auth/sair'), true)
  assert.equal(ehRotaReservada('/api/otel/v1/traces'), true)
  assert.equal(ehRotaReservada('/api/stream'), true)

  assert.equal(ehRotaReservada('/zona1'), false)
  assert.equal(ehRotaReservada('/zona2/tarefas'), false)
  assert.equal(ehRotaReservada('/acesso'), false)
})

test('carregarZonas: rotas reservadas nao podem ser sobrescritas por zonas (Criterio 3)', () => {
  // Arrange
  const mapaComColisao = {
    login: 'http://evil.com/login',
    api: 'http://evil.com/api',
    zona1: 'http://localhost:3001',
    'erro-de-zona': 'http://evil.com/erro',
  }

  // Act
  const zonas = carregarZonas(mapaComColisao)

  // Assert
  assert.equal(zonas.length, 1)
  assert.equal(zonas[0].id, 'zona1')
  assert.equal(zonas[0].origem, 'http://localhost:3001')
  assert.equal(zonas.some((z) => z.id === 'login'), false)
  assert.equal(zonas.some((z) => z.id === 'api'), false)
  assert.equal(zonas.some((z) => z.id === 'erro-de-zona'), false)
})

test('carregarZonas: permite sobrescrever origem via variaveis de ambiente', () => {
  // Arrange
  const mapa = { zona1: 'http://localhost:3001' }
  const env = { ZONA_ZONA1_URL: 'http://cluster-interno:8080' }

  // Act
  const zonas = carregarZonas(mapa, env)

  // Assert
  assert.equal(zonas[0].origem, 'http://cluster-interno:8080')
  assert.equal(zonas[0].urlSaude, 'http://cluster-interno:8080/zona1')
})

test('gerarRewrites: deriva regras a partir do mapa central de configuracoes (Criterio 2)', () => {
  // Arrange
  const zonas = [
    {
      id: 'zona1',
      origem: 'http://localhost:3001',
      prefixo: '/zona1',
      prefixoEstatico: '/zona1-static',
      urlSaude: 'http://localhost:3001/zona1',
    },
  ]

  // Act
  const rewrites = gerarRewrites(zonas)

  // Assert
  assert.deepEqual(rewrites, [
    { source: '/zona1', destination: 'http://localhost:3001/zona1' },
    { source: '/zona1/:caminho*', destination: 'http://localhost:3001/zona1/:caminho*' },
    { source: '/zona1-static/:caminho*', destination: 'http://localhost:3001/zona1-static/:caminho*' },
  ])
})

test('encontrarZonaPorCaminho: resolve a zona correspondente para paginas e assets', () => {
  // Arrange
  const zonas = carregarZonas({ zona1: 'http://localhost:3001', zona2: 'http://localhost:3002' })

  // Act & Assert
  assert.equal(encontrarZonaPorCaminho('/zona1')?.id, 'zona1')
  assert.equal(encontrarZonaPorCaminho('/zona1/detalhes/42')?.id, 'zona1')
  assert.equal(encontrarZonaPorCaminho('/zona1-static/_next/static/chunk.js')?.id, 'zona1')
  assert.equal(encontrarZonaPorCaminho('/zona2')?.id, 'zona2')
  assert.equal(encontrarZonaPorCaminho('/login'), null)
  assert.equal(encontrarZonaPorCaminho('/'), null)
})

test('C1: busca de zona ignora maiusculas, como o rewrite do Next (senao /ZONA2 escapa da sonda)', async () => {
  const { encontrarZonaPorCaminho, carregarZonas } = await import('../lib/zonas.ts')
  const zonas = carregarZonas({ zona2: 'http://127.0.0.1:3002' }, {})
  for (const c of ['/ZONA2', '/Zona2/x', '/zONA2', '/ZONA2-STATIC/a.js', '/Zona2-Static/b.css']) {
    assert.equal(encontrarZonaPorCaminho(c, zonas)?.id, 'zona2', c)
  }
  for (const c of ['/zona20', '/zona', '/xzona2', '/ZONA2X']) assert.equal(encontrarZonaPorCaminho(c, zonas), null, c)
})

test('C1: prefixo estatico em qualquer caixa continua sendo asset, nao pagina', async () => {
  const { decidirAcaoDoProxy } = await import('../lib/decisao-proxy.ts')
  const { carregarZonas } = await import('../lib/zonas.ts')
  const zonas = carregarZonas({ zona2: 'http://127.0.0.1:3002' }, {})
  const saudavel = { verificar: async () => true, limpar() {} }
  const d = await decidirAcaoDoProxy({ caminho: '/ZONA2-STATIC/a.js', temCookieSessao: false }, saudavel, zonas)
  assert.equal(d.acao, 'zona-estatica')
})
