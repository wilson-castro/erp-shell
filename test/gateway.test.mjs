// Gateway de documento do shell (C3, ADR-0015 decisão 7) contra uma zona falsa numa porta efêmera.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { criarGatewayDeZona } from '../lib/gateway-zona.ts'
import { mapaFixo } from './apoio-mapa.mjs'

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const PAGINA_GZIP = gzipSync(Buffer.from('<html>' + 'conteudo da zona '.repeat(2000) + '</html>'))

let zona
let origem
/** Requisições que a zona recebeu: caminho, cabeçalhos e se a conexão já fechou. */
const recebidas = []
before(async () => {
  zona = createServer((req, res) => {
    const reg = { url: req.url, headers: req.headers, fechou: false }
    recebidas.push(reg)
    res.on('close', () => { reg.fechou = true })
    const [caminho] = req.url.split('?')
    switch (caminho) {
      case '/zona1/gzip':
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip', 'content-length': PAGINA_GZIP.length })
        return res.end(PAGINA_GZIP)
      case '/zona1/cookies':
        res.setHeader('set-cookie', ['a=1; Path=/; HttpOnly', 'b=2; Path=/zona1; Secure'])
        return res.end('ok')
      case '/zona1/hop':
        res.writeHead(200, {
          connection: 'x-privado', 'keep-alive': 'timeout=5', 'x-privado': 'segredo', 'proxy-authenticate': 'Basic',
          trailer: 'x-fim', upgrade: 'h2c', 'x-zona': 'fica',
        })
        return res.end('ok')
      case '/zona1/location-interna':
        res.writeHead(302, { location: `${origem}/zona1/destino?a=1#f` })
        return res.end()
      case '/zona1/location-barras':
        res.writeHead(302, { location: `${origem}//outro.host/x?a=1` })
        return res.end()
      case '/zona1/location-contrabarra':
        res.writeHead(302, { location: `${origem}/\\outro.host/x` })
        return res.end()
      case '/zona1/location-externa':
        res.writeHead(303, { location: 'https://idp.exemplo/sair?x=1' })
        return res.end()
      case '/zona1/eco':
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify(req.headers))
      case '/zona1/trava':
        return // aceita e nunca responde
      case '/zona1/ocioso':
        res.writeHead(200, { 'content-type': 'text/html' })
        res.write('<html>primeiro pedaco')
        return // e para no meio
      case '/zona1/lento-mas-vivo': {
        res.writeHead(200, { 'content-type': 'text/plain' })
        let i = 0
        const t = setInterval(() => { res.write(`p${i}\n`); if (++i === 6) { clearInterval(t); res.end() } }, 100)
        return
      }
      case '/zona1/infinito': {
        res.writeHead(200, { 'content-type': 'text/plain' })
        const t = setInterval(() => res.write('x'), 30)
        res.on('close', () => clearInterval(t))
        return
      }
      default:
        res.writeHead(200, { 'content-type': 'text/plain' })
        return res.end(`zona: ${req.method} ${req.url}`)
    }
  })
  await new Promise((ok) => zona.listen(0, '127.0.0.1', ok))
  origem = `http://127.0.0.1:${zona.address().port}`
})
after(() => { zona.closeAllConnections(); zona.close() })

function gateway({ tetoMs = 300, ociosidadeMs = 300, zonas } = {}) {
  const falhas = []
  const g = criarGatewayDeZona({
    mapa: mapaFixo(zonas ?? [{ id: 'zona1', origem }, { id: 'zona2', origem }]),
    tetoMs, ociosidadeMs, registrarFalha: (f) => falhas.push(f),
  })
  return { g, falhas }
}
const pedido = (caminho, init = {}) => new Request(`http://localhost:3000/_gateway${caminho}`, init)
const ultimaPara = (url) => recebidas.findLast((r) => r.url === url)
async function ateQue(cond, ms = 2000) {
  const fim = Date.now() + ms
  while (!cond()) { if (Date.now() > fim) return false; await esperar(10) }
  return true
}

test('repassa o corpo gzip da zona como veio, sem abrir, e o accept-encoding do navegador', async () => {
  const { g } = gateway()
  const r = await g(pedido('/zona1/gzip', { headers: { 'accept-encoding': 'gzip, br' } }))
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-encoding'), 'gzip')
  const corpo = Buffer.from(await r.arrayBuffer())
  assert.ok(corpo.equals(PAGINA_GZIP), `corpo de ${corpo.length} bytes; a zona mandou ${PAGINA_GZIP.length} comprimidos`)
  assert.equal(ultimaPara('/zona1/gzip').headers['accept-encoding'], 'gzip, br')
})

test('repassa cada Set-Cookie separado', async () => {
  const { g } = gateway()
  const r = await g(pedido('/zona1/cookies'))
  assert.deepEqual(r.headers.getSetCookie(), ['a=1; Path=/; HttpOnly', 'b=2; Path=/zona1; Secure'])
})

test('tira os hop-by-hop da resposta (inclusive os nomeados em Connection) e da requisicao', async () => {
  const { g } = gateway()
  const r = await g(pedido('/zona1/hop'))
  await r.text()
  for (const h of ['connection', 'keep-alive', 'x-privado', 'proxy-authenticate', 'trailer', 'upgrade', 'transfer-encoding']) {
    assert.equal(r.headers.get(h), null, h)
  }
  assert.equal(r.headers.get('x-zona'), 'fica')

  const e = await g(pedido('/zona1/eco', {
    headers: {
      connection: 'x-do-navegador', 'x-do-navegador': 'v', te: 'trailers', trailer: 'x', upgrade: 'websocket',
      'proxy-authorization': 'Basic segredo', 'keep-alive': 'timeout=1', 'x-segue': 'sim', cookie: '__Host-session=s1',
    },
  }))
  const vistos = await e.json()
  for (const h of ['te', 'trailer', 'upgrade', 'proxy-authorization', 'x-do-navegador']) assert.equal(vistos[h], undefined, h)
  assert.notEqual(vistos.connection, 'x-do-navegador')
  assert.notEqual(vistos['keep-alive'], 'timeout=1')
  assert.equal(vistos['x-segue'], 'sim')
  assert.equal(vistos.cookie, '__Host-session=s1', 'o cookie da sessao chega a zona (ela le a sessao)')
})

test('Location da origem interna com // ou /\\ no inicio nao vira URL sem protocolo (redirecionamento aberto)', async () => {
  const { g } = gateway()
  for (const c of ['/zona1/location-barras', '/zona1/location-contrabarra']) {
    const r = await g(pedido(c))
    const loc = r.headers.get('location')
    assert.ok(!/^[/\\]{2}/.test(loc), `${c}: Location ${loc} comeca com duas barras`)
    assert.ok(loc.startsWith('/'), `${c}: Location ${loc}`)
  }
  assert.equal((await g(pedido('/zona1/location-barras'))).headers.get('location'), '/outro.host/x?a=1')
})

test('Location com a origem interna vira caminho relativo; Location de fora fica', async () => {
  const { g } = gateway()
  const r = await g(pedido('/zona1/location-interna'))
  assert.equal(r.status, 302)
  assert.equal(r.headers.get('location'), '/zona1/destino?a=1#f')
  const f = await g(pedido('/zona1/location-externa'))
  assert.equal(f.headers.get('location'), 'https://idp.exemplo/sair?x=1')
})

test('poe x-forwarded-host, x-forwarded-proto e o traceparent do proxy; Host da zona e a origem do mapa', async () => {
  const { g } = gateway()
  const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
  const r = await g(pedido('/zona1/eco?q=1', { headers: { host: 'localhost:3000', traceparent: tp } }))
  const vistos = await r.json()
  assert.equal(vistos['x-forwarded-host'], 'localhost:3000')
  assert.equal(vistos['x-forwarded-proto'], 'http')
  assert.equal(vistos.traceparent, tp)
  assert.equal(vistos.host, new URL(origem).host)
  assert.equal(ultimaPara('/zona1/eco?q=1')?.url, '/zona1/eco?q=1', 'caminho e busca originais, sem /_gateway')
})

test('alvo so do mapa: Host, X-Forwarded-Host e a URL da requisicao nao escolhem para onde vai', async () => {
  const { g } = gateway()
  const req = new Request('http://evil.invalid:1/_gateway/zona1/alvo', { headers: { host: 'evil.invalid:1', 'x-forwarded-host': 'evil.invalid:1' } })
  const r = await g(req)
  assert.equal(r.status, 200)
  assert.equal(await r.text(), 'zona: GET /zona1/alvo')
})

test('aceita o caminho com ou sem o prefixo interno /_gateway', async () => {
  const { g } = gateway()
  assert.equal(await (await g(new Request('http://localhost:3000/zona1/sem-prefixo'))).text(), 'zona: GET /zona1/sem-prefixo')
})

test('teto: zona que nao manda cabecalhos da 503 com a pagina da base e supportId, sem deixar a conexao pendurada', async () => {
  const { g, falhas } = gateway({ tetoMs: 300 })
  const t0 = Date.now()
  const r = await g(pedido('/zona1/trava'))
  const ms = Date.now() - t0
  assert.equal(r.status, 503)
  assert.ok(ms >= 280 && ms < 800, `respondeu em ${ms} ms com teto de 300`)
  assert.equal(r.headers.get('cache-control'), 'no-store')
  assert.ok(r.headers.get('retry-after'))
  assert.match(r.headers.get('content-type'), /text\/html/)
  const html = await r.text()
  assert.match(html, /Zona temporariamente indisponível/)
  const supportId = html.match(/data-support-id="([0-9a-f-]{36})"/)?.[1]
  assert.ok(supportId, 'a pagina traz o supportId')
  assert.equal(falhas.at(-1).supportId, supportId, 'a falha registrada tem o mesmo supportId')
  assert.equal(falhas.at(-1).zona, 'zona1')
  assert.ok(await ateQue(() => ultimaPara('/zona1/trava')?.fechou), 'a conexao com a zona ficou aberta depois do teto')
})

test('zona que recusa a conexao tambem da a pagina da base com supportId', async () => {
  const fechado = createServer()
  await new Promise((ok) => fechado.listen(0, '127.0.0.1', ok))
  const porta = fechado.address().port
  await new Promise((ok) => fechado.close(ok))
  const { g, falhas } = gateway({ zonas: [{ id: 'zona1', origem: `http://127.0.0.1:${porta}` }] })
  const r = await g(pedido('/zona1'))
  assert.equal(r.status, 503)
  assert.match(await r.text(), /data-support-id=/)
  assert.equal(falhas.length, 1)
})

test('ociosidade: depois do primeiro byte, a resposta parada e cortada sem pagina e a zona e solta', async () => {
  const { g, falhas } = gateway({ tetoMs: 300, ociosidadeMs: 300 })
  const r = await g(pedido('/zona1/ocioso'))
  assert.equal(r.status, 200, 'os cabecalhos ja sairam: o status e o da zona')
  const t0 = Date.now()
  await assert.rejects(r.text())
  const ms = Date.now() - t0
  assert.ok(ms >= 250 && ms < 900, `cortou em ${ms} ms com ociosidade de 300`)
  assert.ok(await ateQue(() => ultimaPara('/zona1/ocioso')?.fechou), 'a conexao com a zona ficou aberta')
  assert.ok(falhas.at(-1)?.supportId, 'o corte foi registrado')
})

test('o teto conta so ate os cabecalhos: resposta que segue mandando dados passa do teto inteira', async () => {
  const { g } = gateway({ tetoMs: 300, ociosidadeMs: 300 })
  const r = await g(pedido('/zona1/lento-mas-vivo'))
  const t0 = Date.now()
  assert.equal(await r.text(), 'p0\np1\np2\np3\np4\np5\n')
  assert.ok(Date.now() - t0 >= 400, 'o corpo levou mais que o teto e chegou inteiro')
})

test('navegador que fecha a conexao solta a zona (corpo cancelado e requisicao abortada)', async () => {
  const { g } = gateway({ ociosidadeMs: 5000 })
  const r = await g(pedido('/zona1/infinito'))
  const leitor = r.body.getReader()
  await leitor.read()
  await leitor.cancel()
  assert.ok(await ateQue(() => ultimaPara('/zona1/infinito')?.fechou), 'cancelar o corpo nao soltou a zona')

  const ctl = new AbortController()
  const antes = recebidas.length
  const p = g(pedido('/zona1/trava?abortada', { signal: ctl.signal }))
  await ateQue(() => recebidas.length > antes)
  ctl.abort()
  await p.catch(() => {})
  assert.ok(await ateQue(() => ultimaPara('/zona1/trava?abortada')?.fechou), 'abortar antes dos cabecalhos nao soltou a zona')
})

test('recusa _fragmento em qualquer grafia, sem chamar a zona', async () => {
  const { g } = gateway()
  const antes = recebidas.length
  for (const c of ['/zona2/_fragmento/x', '/ZONA2/_FRAGMENTO/x', '/zona2/%5Ffragmento/x']) {
    const r = await g(pedido(c))
    assert.equal(r.status, 404, c)
  }
  assert.equal(recebidas.length, antes, 'a zona recebeu o pedido de fragmento')
})

test('mapa vazio: 503 com a pagina da base; zona fora do mapa cheio: 404', async () => {
  const vazio = gateway({ zonas: [] })
  const r = await vazio.g(pedido('/zona1'))
  assert.equal(r.status, 503)
  assert.match(await r.text(), /data-support-id=/)
  const cheio = gateway()
  assert.equal((await cheio.g(pedido('/zona7/x'))).status, 404)
})

test('HEAD: cabecalhos da zona, sem corpo', async () => {
  const { g } = gateway()
  const r = await g(pedido('/zona1/head', { method: 'HEAD' }))
  assert.equal(r.status, 200)
  assert.equal(r.body, null)
})

test('prefixo em outra caixa chega a zona na grafia canonica (como o rewrites() fazia)', async () => {
  const { g } = gateway()
  assert.equal(await (await g(pedido('/ZONA1/Caixa'))).text(), 'zona: GET /zona1/Caixa')
})
