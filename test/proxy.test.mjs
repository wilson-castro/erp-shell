import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidirAcaoDoProxy } from '../lib/decisao-proxy.ts'
import { criarCacheSaudeZona } from '../lib/saude-zonas.ts'

test('Cenario 1: acessar uma rota de zona inativa apresenta status 503 e pagina de erro', async () => {
  // Arrange
  const cacheSaudeInativa = criarCacheSaudeZona(1000, 500, async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:3001')
  })
  const contexto = { caminho: '/zona1', temCookieSessao: true }

  // Act
  const decisao = await decidirAcaoDoProxy(contexto, cacheSaudeInativa)

  // Assert
  assert.equal(decisao.acao, 'zona-inativa')
  assert.equal(decisao.status, 503)
  assert.equal(decisao.headers['content-type'], 'text/html; charset=utf-8')
  assert.equal(decisao.headers['retry-after'], '5')
  assert.equal(decisao.headers['cache-control'], 'no-store')
  assert.match(decisao.html, /Zona temporariamente indisponível/)
  assert.match(decisao.html, /Zona "zona1" Offline/)
  assert.match(decisao.html, /Voltar ao início/)
})

test('rotas publicas do shell nao exigem cookie e retornam acao publica', async () => {
  // Arrange & Act & Assert
  for (const rota of ['/login', '/login/algo', '/api/auth/entrar', '/erro-de-zona']) {
    const decisao = await decidirAcaoDoProxy({ caminho: rota, temCookieSessao: false })
    assert.equal(decisao.acao, 'publico')
    assert.ok('nonce' in decisao && typeof decisao.nonce === 'string')
  }
})

test('rotas de telemetria passam para o gateway do shell', async () => {
  // Arrange
  const decisao = await decidirAcaoDoProxy({ caminho: '/api/otel/v1/traces', temCookieSessao: true })

  // Assert
  assert.equal(decisao.acao, 'telemetria')
})

test('rota raiz do shell sem cookie redireciona para login', async () => {
  // Arrange
  const decisao = await decidirAcaoDoProxy({ caminho: '/', temCookieSessao: false })

  // Assert
  assert.equal(decisao.acao, 'redirecionar-login')
  assert.equal(decisao.destino, '/login?de=%2F')
})

test('rota raiz do shell com cookie prossegue', async () => {
  // Arrange
  const decisao = await decidirAcaoDoProxy({ caminho: '/', temCookieSessao: true })

  // Assert
  assert.equal(decisao.acao, 'prosseguir')
  assert.ok('nonce' in decisao)
})

test('zona ativa sem cookie redireciona para login', async () => {
  // Arrange
  const cacheAtiva = criarCacheSaudeZona(1000, 500, async () => ({ status: 200 }))
  const decisao = await decidirAcaoDoProxy({ caminho: '/zona1/recursos', temCookieSessao: false }, cacheAtiva)

  // Assert
  assert.equal(decisao.acao, 'redirecionar-login')
  assert.equal(decisao.destino, '/login?de=%2Fzona1%2Frecursos')
})

test('zona ativa com cookie prossegue', async () => {
  // Arrange
  const cacheAtiva = criarCacheSaudeZona(1000, 500, async () => ({ status: 200 }))
  const decisao = await decidirAcaoDoProxy({ caminho: '/zona1/recursos', temCookieSessao: true }, cacheAtiva)

  // Assert
  assert.equal(decisao.acao, 'prosseguir')
  assert.ok('nonce' in decisao)
})

// --- gate "Shell novo", iteração 2 (auditor_shell_2, U5–U6) ---
test('U5: zona fora e asset estatico dela da 503 (a sonda vem antes do corte de asset)', async () => {
  const { decidirAcaoDoProxy } = await import('../lib/decisao-proxy.ts')
  const { carregarZonas } = await import('../lib/zonas.ts')
  const zonas = carregarZonas({ zona2: 'http://127.0.0.1:3002' }, {})
  const d = await decidirAcaoDoProxy({ caminho: '/zona2-static/_next/a.js', temCookieSessao: false }, { verificar: async () => false, limpar() {} }, zonas)
  assert.equal(d.acao, 'zona-inativa')
})

test('U6: /api fora de /api/otel e /api/auth continua exigindo cookie', async () => {
  const { decidirAcaoDoProxy } = await import('../lib/decisao-proxy.ts')
  for (const caminho of ['/api/stream', '/api/qualquer', '/api/otelx', '/api/authx', '/api/auth-falso/x']) {
    const d = await decidirAcaoDoProxy({ caminho, temCookieSessao: false }, { verificar: async () => true, limpar() {} }, [])
    assert.equal(d.acao, 'redirecionar-login', caminho)
  }
})

// --- C1 (ADR-0011, decisao 8): fragmento e servidor->servidor; do navegador, nao existe ---
test('C1: /{zona}/_fragmento/ e 404 no shell, com ou sem cookie, em qualquer grafia, sem consultar a sonda', async () => {
  const sondaProibida = { verificar: async () => { throw new Error('a sonda nao deveria rodar') }, limpar() {} }
  const caminhos = [
    '/zona2/_fragmento/tarefas/pendentes', '/ZONA2/_FRAGMENTO/tarefas/pendentes', '/zona1/_fragmento/x/y',
    '/zona2/%5Ffragmento/tarefas/pendentes', '/zona2/%5ffragmento/x', '/zona2/_fragmento', '/zona2/_fragmento/',
  ]
  for (const caminho of caminhos) {
    for (const temCookieSessao of [true, false]) {
      const d = await decidirAcaoDoProxy({ caminho, temCookieSessao }, sondaProibida)
      assert.equal(d.acao, 'nao-encontrado', `${caminho} cookie=${temCookieSessao}`)
    }
  }
})

test('C1: so o segmento _fragmento logo depois do prefixo da zona e recusado (dentes do teste acima)', async () => {
  const sondaOk = { verificar: async () => true, limpar() {} }
  for (const caminho of ['/zona2/_fragmentos/x', '/zona2/x/_fragmento/y', '/zona2/tarefas_fragmento', '/zona2/%zz/_fragmento']) {
    const d = await decidirAcaoDoProxy({ caminho, temCookieSessao: true }, sondaOk)
    assert.equal(d.acao, 'prosseguir', caminho)
  }
  // fora de zona nao ha fragmento a proteger: o shell segue a regra de sempre
  assert.equal((await decidirAcaoDoProxy({ caminho: '/_fragmento/x', temCookieSessao: false }, sondaOk)).acao, 'redirecionar-login')
})
