import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criarMapaDeZonas, origemPermitida } from '../lib/mapa-zonas.ts'
import { lerOrigensPermitidas, lerTtlDoMapaDeZonas, lerTokenDeServico } from '../lib/configuracao.ts'

const PERMITIDAS = ['127.0.0.1:*', 'localhost:*']
const entrada = (id, porta = 4001, host = '127.0.0.1') => ({ id, origem: `http://${host}:${porta}` })

function ambiente({ fonte, guarda, ttlMs = 1000, permitidas = PERMITIDAS } = {}) {
  const relogio = { t: 0 }
  const falhas = []
  const mapa = criarMapaDeZonas({
    fonte, guarda, ttlMs, origensPermitidas: permitidas,
    agora: () => relogio.t, registrarFalha: (m) => falhas.push(m),
  })
  return { mapa, relogio, falhas }
}
const ids = (zonas) => zonas.map((z) => z.id)
const solta = () => new Promise((r) => setImmediate(r))

test('origemPermitida: * dentro do host nao deixa 127.0.0.1.evil casar 127.0.0.1:*', () => {
  assert.equal(origemPermitida('http://127.0.0.1:80', ['127.0.0.1:*']), true)
  assert.equal(origemPermitida('http://127.0.0.1.evil:80', ['127.0.0.1:*']), false)
  assert.equal(origemPermitida('http://127.0.0.1:80', ['127.0.0.1*']), false)
  assert.equal(origemPermitida('http://a.b-c.local:8080', ['*.local:*']), true)
  assert.equal(origemPermitida('http://x:80', ['*:*']), true)
  assert.equal(origemPermitida('http://a:b@h:80', ['*:*']), false)
  assert.equal(origemPermitida('http://evil.com:80/x.local:80', ['*.local:*']), false)
  assert.equal(origemPermitida('http://h:81', ['h:80']), false)
  // o * do host nao casa ':' nem '[' (IPv6 literal), so letras, digitos, ponto e hifen
  assert.equal(origemPermitida('http://[::1]:80', ['*:*']), false)
  assert.equal(origemPermitida('http://h:80', ['h:*x']), false)
})

test('entrada com origem fora dos padroes e descartada e as outras seguem', async () => {
  const { mapa, falhas } = ambiente({ fonte: async () => [entrada('a'), entrada('b', 80, 'evil.com'), entrada('c')] })
  assert.deepEqual(ids(await mapa.zonas()), ['a', 'c'])
  assert.equal(falhas.length, 1)
})

test('entrada invalida nao derruba o mapa: id, origem malformada, credencial, caminho, query', async () => {
  const lixo = [
    { id: 'login', origem: 'http://127.0.0.1:1' }, { id: 'api', origem: 'http://127.0.0.1:1' },
    { id: 'Maiuscula', origem: 'http://127.0.0.1:1' }, { id: 'x-static', origem: 'http://127.0.0.1:1' },
    { id: 'd', origem: 'ftp://127.0.0.1:1' }, { id: 'e', origem: 'http://u:p@127.0.0.1:1' },
    { id: 'f', origem: 'http://127.0.0.1:1/caminho' }, { id: 'g', origem: 'http://127.0.0.1:1/?q=1' },
    { id: 'h', origem: 'http://127.0.0.1:1#x' }, { id: 'i' }, null, 'texto', { id: 7, origem: 'http://127.0.0.1:1' },
  ]
  const { mapa, falhas } = ambiente({ fonte: async () => [entrada('ok1'), ...lixo, entrada('ok2')] })
  assert.deepEqual(ids(await mapa.zonas()), ['ok1', 'ok2'])
  assert.equal(falhas.length, lixo.length)
})

test('zona montada: prefixos, urlSaude e origem sem barra final', async () => {
  const { mapa } = ambiente({ fonte: async () => [{ id: 'zona1', origem: 'http://127.0.0.1:4001/' }] })
  assert.deepEqual((await mapa.zonas())[0], {
    id: 'zona1', origem: 'http://127.0.0.1:4001', prefixo: '/zona1', prefixoEstatico: '/zona1-static',
    urlSaude: 'http://127.0.0.1:4001/zona1/api/health',
  })
})

test('TTL respeitado: nao rele antes, rele depois', async () => {
  let n = 0
  const { mapa, relogio } = ambiente({ ttlMs: 1000, fonte: async () => { n++; return [entrada('a')] } })
  await mapa.zonas()
  relogio.t = 999
  await mapa.zonas()
  assert.equal(n, 1)
  relogio.t = 1000
  await mapa.zonas()
  await solta()
  assert.equal(n, 2)
})

test('releitura nao bloqueia: quem chega com TTL vencido recebe o ultimo bom e a releitura atualiza', async () => {
  let versao = 1
  let liberar
  const { mapa, relogio } = ambiente({
    fonte: async () => { const v = versao; if (v === 2) await new Promise((r) => { liberar = r }); return [entrada(`v${v}`)] },
  })
  assert.deepEqual(ids(await mapa.zonas()), ['v1'])
  versao = 2
  relogio.t = 5000
  assert.deepEqual(ids(await mapa.zonas()), ['v1'])
  liberar(); await solta(); await solta()
  assert.deepEqual(ids(await mapa.zonas()), ['v2'])
})

test('leituras simultaneas com TTL vencido fazem uma releitura so', async () => {
  let n = 0
  let liberar
  const { mapa, relogio } = ambiente({
    fonte: async () => { n++; if (n > 1) await new Promise((r) => { liberar = r }); return [entrada('a')] },
  })
  await mapa.zonas()
  relogio.t = 5000
  await Promise.all([mapa.zonas(), mapa.zonas(), mapa.zonas(), mapa.encontrar('/a')])
  assert.equal(n, 2)
  liberar(); await solta()
})

test('boot frio com leituras simultaneas tambem faz uma leitura so', async () => {
  let n = 0
  const { mapa } = ambiente({ fonte: async () => { n++; await solta(); return [entrada('a')] } })
  await Promise.all([mapa.zonas(), mapa.zonas(), mapa.zonas()])
  assert.equal(n, 1)
})

test('fonte fora mantem o ultimo bom e registra; resposta invalida tambem', async () => {
  let modo = 'ok'
  const { mapa, relogio, falhas } = ambiente({
    fonte: async () => { if (modo === 'cai') throw new Error('fora'); if (modo === 'lixo') return { nao: 'lista' }; return [entrada('a')] },
  })
  assert.deepEqual(ids(await mapa.zonas()), ['a'])
  modo = 'cai'; relogio.t = 2000
  await mapa.zonas(); await solta()
  assert.deepEqual(ids(await mapa.zonas()), ['a'])
  modo = 'lixo'; relogio.t = 4000
  await mapa.zonas(); await solta()
  assert.deepEqual(ids(await mapa.zonas()), ['a'])
  assert.equal(falhas.length, 2)
})

test('boot frio com fonte fora usa a guarda (validada de novo)', async () => {
  const guarda = {
    ler: async () => JSON.stringify([entrada('g1'), entrada('mau', 80, 'evil.com')]),
    gravar: async () => { throw new Error('nao deveria gravar') },
  }
  const { mapa } = ambiente({ fonte: async () => { throw new Error('fora') }, guarda })
  assert.deepEqual(ids(await mapa.zonas()), ['g1'])
})

test('boot frio sem fonte nem guarda da mapa vazio; guarda com lixo tambem', async () => {
  const fora = async () => { throw new Error('fora') }
  const a = ambiente({ fonte: fora })
  assert.deepEqual(await a.mapa.zonas(), [])
  const b = ambiente({ fonte: fora, guarda: { ler: async () => '{lixo', gravar: async () => {} } })
  assert.deepEqual(await b.mapa.zonas(), [])
  const c = ambiente({ fonte: fora, guarda: { ler: async () => { throw new Error('redis') }, gravar: async () => {} } })
  assert.deepEqual(await c.mapa.zonas(), [])
  assert.equal(await c.mapa.encontrar('/a'), null)
})

test('leitura boa grava na guarda o que a fonte devolveu; guarda fora nao quebra', async () => {
  const gravados = []
  const a = ambiente({ fonte: async () => [entrada('a')], guarda: { ler: async () => null, gravar: async (j) => { gravados.push(j) } } })
  await a.mapa.zonas()
  assert.deepEqual(JSON.parse(gravados[0]).map((z) => z.id), ['a'])
  const b = ambiente({ fonte: async () => [entrada('a')], guarda: { ler: async () => null, gravar: async () => { throw new Error('redis') } } })
  assert.deepEqual(ids(await b.mapa.zonas()), ['a'])
})

test('encontrar: casa /ZONA1/x e /zona1-static/a.js, nao casa /zona10 nem /zona1x', async () => {
  const { mapa } = ambiente({ fonte: async () => [entrada('zona1')] })
  assert.equal((await mapa.encontrar('/ZONA1/x'))?.id, 'zona1')
  assert.equal((await mapa.encontrar('/zona1'))?.id, 'zona1')
  assert.equal((await mapa.encontrar('/zona1?x=1'))?.id, 'zona1')
  assert.equal((await mapa.encontrar('/zona1-static/a.js'))?.id, 'zona1')
  assert.equal(await mapa.encontrar('/zona10'), null)
  assert.equal(await mapa.encontrar('/zona10/x'), null)
  assert.equal(await mapa.encontrar('/outra'), null)
})

test('configuracao: origens permitidas, TTL e token de servico', () => {
  assert.deepEqual(lerOrigensPermitidas({}), ['127.0.0.1:*', 'localhost:*'])
  assert.deepEqual(lerOrigensPermitidas({ ERP_ZONAS_ORIGENS_PERMITIDAS: ' a:1 , b:* ,' }), ['a:1', 'b:*'])
  assert.throws(() => lerOrigensPermitidas({ NODE_ENV: 'production' }), /ERP_ZONAS_ORIGENS_PERMITIDAS/)
  assert.equal(lerTtlDoMapaDeZonas({}), 30000)
  assert.equal(lerTtlDoMapaDeZonas({ ERP_MAPA_ZONAS_TTL_MS: '1000' }), 1000)
  assert.throws(() => lerTtlDoMapaDeZonas({ ERP_MAPA_ZONAS_TTL_MS: '999' }))
  assert.throws(() => lerTtlDoMapaDeZonas({ ERP_MAPA_ZONAS_TTL_MS: '300001' }))
  assert.equal(lerTokenDeServico({}), 'svc.shell')
  assert.equal(lerTokenDeServico({ NODE_ENV: 'production' }), undefined)
  assert.equal(lerTokenDeServico({ NODE_ENV: 'production', ERP_TOKEN_SERVICO: 'x' }), 'x')
})
