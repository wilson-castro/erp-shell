import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidirAcaoDoProxy } from '../lib/decisao-proxy.ts'
import { criarCacheSaudeZona } from '../lib/saude-zonas.ts'
import { mapaFixo } from './apoio-mapa.mjs'

test('Cenario 1: acessar uma rota de zona inativa apresenta status 503 e pagina de erro', async () => {
  // Arrange
  const cacheSaudeInativa = criarCacheSaudeZona(1000, 500, async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:3001')
  })
  const contexto = { caminho: '/zona1', temCookieSessao: true }

  // Act
  const decisao = await decidirAcaoDoProxy(contexto, cacheSaudeInativa, mapaFixo())

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
    const decisao = await decidirAcaoDoProxy({ caminho: rota, temCookieSessao: false }, undefined, mapaFixo())
    assert.equal(decisao.acao, 'publico')
    assert.ok('nonce' in decisao && typeof decisao.nonce === 'string')
  }
})

test('rotas de telemetria passam para o gateway do shell', async () => {
  // Arrange
  const decisao = await decidirAcaoDoProxy({ caminho: '/api/otel/v1/traces', temCookieSessao: true }, undefined, mapaFixo())

  // Assert
  assert.equal(decisao.acao, 'telemetria')
})

test('rota raiz do shell sem cookie redireciona para login', async () => {
  // Arrange
  const decisao = await decidirAcaoDoProxy({ caminho: '/', temCookieSessao: false }, undefined, mapaFixo())

  // Assert
  assert.equal(decisao.acao, 'redirecionar-login')
  assert.equal(decisao.destino, '/login?de=%2F')
})

test('rota raiz do shell com cookie prossegue', async () => {
  // Arrange
  const decisao = await decidirAcaoDoProxy({ caminho: '/', temCookieSessao: true }, undefined, mapaFixo())

  // Assert
  assert.equal(decisao.acao, 'prosseguir')
  assert.ok('nonce' in decisao)
})

test('zona ativa sem cookie redireciona para login', async () => {
  // Arrange
  const cacheAtiva = criarCacheSaudeZona(1000, 500, async () => ({ status: 200 }))
  const decisao = await decidirAcaoDoProxy({ caminho: '/zona1/recursos', temCookieSessao: false }, cacheAtiva, mapaFixo())

  // Assert
  assert.equal(decisao.acao, 'redirecionar-login')
  assert.equal(decisao.destino, '/login?de=%2Fzona1%2Frecursos')
})

test('zona ativa com cookie prossegue', async () => {
  // Arrange
  const cacheAtiva = criarCacheSaudeZona(1000, 500, async () => ({ status: 200 }))
  const decisao = await decidirAcaoDoProxy({ caminho: '/zona1/recursos', temCookieSessao: true }, cacheAtiva, mapaFixo())

  // Assert: documento vai pelo gateway interno, com o caminho original
  assert.deepEqual(decisao, { acao: 'zona-documento', caminhoInterno: '/_gateway/zona1/recursos' })
})

// --- gate "Shell novo", iteração 2 (auditor_shell_2, U5–U6) ---
test('U5: zona fora e asset estatico dela da 503 (a sonda vem antes do corte de asset)', async () => {
  const { decidirAcaoDoProxy } = await import('../lib/decisao-proxy.ts')
  const zonas = mapaFixo([{ id: 'zona2', origem: 'http://127.0.0.1:3002' }])
  const d = await decidirAcaoDoProxy({ caminho: '/zona2-static/_next/a.js', temCookieSessao: false }, { verificar: async () => false, limpar() {} }, zonas)
  assert.equal(d.acao, 'zona-inativa')
})

test('U6: /api fora de /api/otel e /api/auth continua exigindo cookie', async () => {
  const { decidirAcaoDoProxy } = await import('../lib/decisao-proxy.ts')
  for (const caminho of ['/api/stream', '/api/qualquer', '/api/otelx', '/api/authx', '/api/auth-falso/x']) {
    const d = await decidirAcaoDoProxy({ caminho, temCookieSessao: false }, { verificar: async () => true, limpar() {} }, mapaFixo())
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
      const d = await decidirAcaoDoProxy({ caminho, temCookieSessao }, sondaProibida, mapaFixo())
      assert.equal(d.acao, 'nao-encontrado', `${caminho} cookie=${temCookieSessao}`)
    }
  }
})

test('C1: so o segmento _fragmento logo depois do prefixo da zona e recusado (dentes do teste acima)', async () => {
  const sondaOk = { verificar: async () => true, limpar() {} }
  for (const caminho of ['/zona2/_fragmentos/x', '/zona2/x/_fragmento/y', '/zona2/tarefas_fragmento', '/zona2/%zz/_fragmento']) {
    const d = await decidirAcaoDoProxy({ caminho, temCookieSessao: true }, sondaOk, mapaFixo())
    assert.equal(d.acao, 'zona-documento', caminho)
  }
  // fora de zona nao ha fragmento a proteger: o shell segue a regra de sempre
  assert.equal((await decidirAcaoDoProxy({ caminho: '/_fragmento/x', temCookieSessao: false }, sondaOk, mapaFixo())).acao, 'redirecionar-login')
})

// --- C3 (ADR-0015, decisão 1): roteamento híbrido. Documento pelo gateway; RSC, Server Action, outros métodos e
// estático pelo caminho rápido (`NextResponse.rewrite` para a origem do mapa) ---
const sondaOk = () => ({ verificar: async () => true, limpar() {} })
const decidir = (ctx, mapa = mapaFixo()) => decidirAcaoDoProxy({ temCookieSessao: true, ...ctx }, sondaOk(), mapa)

test('C3: decisao por tipo de requisicao (documento, HEAD, RSC, Next-Action, POST, estatico)', async () => {
  // documento: GET ou HEAD sem RSC e sem Next-Action
  for (const metodo of ['GET', 'HEAD', undefined]) {
    assert.deepEqual(await decidir({ caminho: '/zona1/x', metodo, busca: '?a=1' }),
      { acao: 'zona-documento', caminhoInterno: '/_gateway/zona1/x?a=1' }, String(metodo))
  }
  const rapida = async (ctx, esperado) => {
    const d = await decidir(ctx)
    assert.equal(d.acao, 'zona-rapida', JSON.stringify(ctx))
    assert.ok(d.destino instanceof URL, 'destino e URL')
    assert.equal(d.destino.href, esperado, JSON.stringify(ctx))
  }
  // RSC (navegação do cliente e prefetch) e Server Action vão pelo caminho rápido, inclusive em GET
  await rapida({ caminho: '/zona1/x', metodo: 'GET', rsc: true, busca: '?_rsc=abc' }, 'http://127.0.0.1:3001/zona1/x?_rsc=abc')
  await rapida({ caminho: '/zona2', metodo: 'POST', acaoDoServidor: true }, 'http://127.0.0.1:3002/zona2')
  await rapida({ caminho: '/zona2', metodo: 'GET', acaoDoServidor: true }, 'http://127.0.0.1:3002/zona2')
  for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    await rapida({ caminho: '/acesso/api/bff/x', metodo }, 'http://127.0.0.1:3003/acesso/api/bff/x')
  }
  // estático da zona: caminho rápido, sem cookie
  await rapida({ caminho: '/zona1-static/_next/a.js', metodo: 'GET', temCookieSessao: false }, 'http://127.0.0.1:3001/zona1-static/_next/a.js')
  // prefixo em outra caixa chega à zona na grafia canônica, como o rewrites() fazia
  await rapida({ caminho: '/ZONA1-static/_next/a.js', metodo: 'GET' }, 'http://127.0.0.1:3001/zona1-static/_next/a.js')
  await rapida({ caminho: '/Zona2/X', metodo: 'POST' }, 'http://127.0.0.1:3002/zona2/X')
})

test('C3: o alvo do caminho rapido sai so da origem do mapa, nunca do caminho nem da busca', async () => {
  for (const [caminho, busca] of [['/zona1//evil.com/x', ''], ['/zona1/x', '?@evil.com'], ['/zona1/x', '#//evil.com']]) {
    const d = await decidir({ caminho, metodo: 'POST', busca })
    assert.equal(d.acao, 'zona-rapida')
    assert.equal(d.destino.origin, 'http://127.0.0.1:3001', `${caminho}${busca}`)
  }
})

test('C3: /_gateway do navegador da 404, com e sem cookie, em qualquer grafia', async () => {
  const sondaProibida = { verificar: async () => { throw new Error('a sonda nao deveria rodar') }, limpar() {} }
  for (const caminho of ['/_gateway', '/_gateway/', '/_gateway/zona1', '/_GATEWAY/zona1/x', '/%5Fgateway/zona1', '/%5fgateway', '/_gateway/_gateway/zona1']) {
    for (const temCookieSessao of [true, false]) {
      for (const metodo of ['GET', 'POST']) {
        const d = await decidirAcaoDoProxy({ caminho, temCookieSessao, metodo }, sondaProibida, mapaFixo())
        assert.equal(d.acao, 'nao-encontrado', `${caminho} cookie=${temCookieSessao} ${metodo}`)
      }
    }
  }
  // dentes: um caminho parecido que nao e o gateway segue a regra de sempre
  assert.equal((await decidirAcaoDoProxy({ caminho: '/_gatewayx', temCookieSessao: false }, sondaProibida, mapaFixo())).acao, 'redirecionar-login')
})

test('C3: mapa vazio e caminho com forma de zona da 503 com a pagina da base e supportId, nao 404', async () => {
  const vazio = mapaFixo([])
  for (const caminho of ['/zona1', '/zona1/x', '/ZONA1/x', '/zona1-static/a.js', '/qualquer-coisa']) {
    for (const temCookieSessao of [true, false]) {
      const d = await decidirAcaoDoProxy({ caminho, temCookieSessao }, sondaOk(), vazio)
      assert.equal(d.acao, 'zona-inativa', `${caminho} cookie=${temCookieSessao}`)
      assert.equal(d.status, 503)
      assert.equal(d.headers['cache-control'], 'no-store')
      assert.match(d.html, /Zona temporariamente indisponível/)
      assert.match(d.supportId, /^[0-9a-f-]{36}$/)
      assert.ok(d.html.includes(d.supportId), 'a pagina mostra o supportId')
    }
  }
  // sem forma de zona: reservadas e a raiz seguem a regra de sempre
  assert.equal((await decidirAcaoDoProxy({ caminho: '/', temCookieSessao: false }, sondaOk(), vazio)).acao, 'redirecionar-login')
  assert.equal((await decidirAcaoDoProxy({ caminho: '/login', temCookieSessao: false }, sondaOk(), vazio)).acao, 'publico')
  assert.equal((await decidirAcaoDoProxy({ caminho: '/api/stream', temCookieSessao: false }, sondaOk(), vazio)).acao, 'redirecionar-login')
  assert.equal((await decidirAcaoDoProxy({ caminho: '/_next/data/x', temCookieSessao: false }, sondaOk(), vazio)).acao, 'redirecionar-login')
  // dentes: com o mapa cheio, caminho com forma de zona que nao e zona e pagina do shell (o Next responde 404)
  assert.equal((await decidirAcaoDoProxy({ caminho: '/qualquer-coisa', temCookieSessao: true }, sondaOk(), mapaFixo())).acao, 'prosseguir')
})

test('C3: zona nova no mapa roteia sem nada no codigo; zona fora do mapa nao', async () => {
  const mapa = mapaFixo([{ id: 'zona9', origem: 'http://127.0.0.1:3009' }])
  assert.deepEqual(await decidir({ caminho: '/zona9' }, mapa), { acao: 'zona-documento', caminhoInterno: '/_gateway/zona9' })
  assert.equal((await decidir({ caminho: '/zona1' }, mapa)).acao, 'prosseguir')
})

test('C3: renovacao vem antes da escolha do caminho; sessao revogada em documento vai ao login', async () => {
  const d = await decidirAcaoDoProxy({ caminho: '/zona1', temCookieSessao: true, idSessao: 's', metodo: 'GET' }, sondaOk(), mapaFixo(), async () => 'revogada')
  assert.deepEqual(d, { acao: 'redirecionar-login', destino: '/login?de=%2Fzona1', limparSessao: true })
  const p = await decidirAcaoDoProxy({ caminho: '/zona1', temCookieSessao: true, idSessao: 's', metodo: 'POST', acaoDoServidor: true }, sondaOk(), mapaFixo(), async () => 'ausente')
  assert.equal(p.acao, 'zona-rapida')
  assert.equal(p.limparSessao, true)
})
