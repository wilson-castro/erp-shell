// Rotas de autenticação do shell (ADR-0013, decisão 6): entrar, retorno e sair, contra a fábrica
// real do núcleo com o provedor de desenvolvimento (o mesmo código de transação do OIDC).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { identidadeDev } from '@erp/nucleo/shell'
import { entrar, retorno, sair } from '../lib/rotas-auth.ts'
import { STORES, sessaoVencendo, identidadeContada, nucleoDoShell } from './apoio-auth.mjs'

const SHELL = 'http://localhost:3000'
const VIDA_TRANSACAO_S = 600

function montar(identidade = identidadeDev(), nomeStore = 'memoria') {
  const store = STORES[nomeStore]()
  const falhas = []
  const nucleo = nucleoDoShell(store, identidade)
  const deps = { sessao: nucleo.sessao, vidaTransacaoS: VIDA_TRANSACAO_S, registrarFalha: (f) => falhas.push(f) }
  return { store, deps, falhas }
}

const req = (caminho, { metodo = 'GET', cookie } = {}) =>
  new Request(`${SHELL}${caminho}`, { method: metodo, headers: cookie ? { cookie } : {} })

/** Set-Cookie de um nome, ou `undefined`. */
const setCookie = (res, nome) => res.headers.getSetCookie().find((c) => c.startsWith(`${nome}=`))
const valor = (c) => c?.split(';')[0].split('=').slice(1).join('=')

/** Nada de token, classe de erro ou pilha no que vai ao navegador (invariantes 1 e 12). */
async function semVazamento(res) {
  const tudo = `${[...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n')}\n${await res.clone().text()}`
  for (const proibido of [/eyJ/, /id_token/i, /refresh/i, /antigo\./, /novo\./, /\bat\s+\S+\s+\(/, /Error/]) {
    assert.doesNotMatch(tudo, proibido)
  }
}

/** O ciclo do login de desenvolvimento, como o navegador: entrar → página de dev → retorno. */
async function cicloDev(deps, { de = '/', usuario = 'ana', mexer = (p) => p } = {}) {
  const ini = await entrar(req(`/api/auth/entrar?de=${encodeURIComponent(de)}`), deps)
  const login = valor(setCookie(ini, '__Host-erp-login'))
  deps.ultimaUrl = ini.headers.get('location')
  const dev = new URL(deps.ultimaUrl, SHELL)
  const params = mexer({ state: dev.searchParams.get('state'), nonce: dev.searchParams.get('nonce'), usuario })
  const fim = await retorno(req(`/api/auth/retorno?${new URLSearchParams(params)}`, { cookie: `__Host-erp-login=${login}` }), deps)
  return { ini, fim, login, params }
}

test('GET /api/auth/entrar grava a transacao, poe o id em __Host-erp-login e manda ao IdP', async () => {
  const { deps } = montar()
  const res = await entrar(req('/api/auth/entrar?de=%2Fzona2'), deps)
  assert.equal(res.status, 303)
  const local = new URL(res.headers.get('location'), SHELL)
  assert.equal(local.pathname, '/login/dev')
  assert.ok(local.searchParams.get('state') && local.searchParams.get('nonce'))
  const c = setCookie(res, '__Host-erp-login')
  assert.ok(valor(c), 'cookie da transacao')
  assert.match(c, /HttpOnly/i); assert.match(c, /Secure/i); assert.match(c, /SameSite=Lax/i)
  assert.match(c, /Path=\//); assert.match(c, new RegExp(`Max-Age=${VIDA_TRANSACAO_S}`))
  assert.doesNotMatch(c, /Domain=/i)
  assert.equal(setCookie(res, '__Host-session'), undefined)
  await semVazamento(res)
})

test('GET /api/auth/entrar com IdP de verdade: Location e a URL do IdP', async () => {
  const idp = {
    ...identidadeContada().identidade,
    async iniciar(destino) {
      return { url: 'https://idp.exemplo/auth?state=s1', transacao: { id: 't1', state: 's1', codeVerifier: 'v'.repeat(43), nonce: 'n1', destino, expiraEm: Date.now() + 60_000 } }
    },
  }
  const { deps } = montar(idp)
  const res = await entrar(req('/api/auth/entrar'), deps)
  assert.equal(res.headers.get('location'), 'https://idp.exemplo/auth?state=s1')
  assert.equal(valor(setCookie(res, '__Host-erp-login')), 't1')
})

test('GET /api/auth/entrar com o IdP fora: volta ao login com codigo e supportId, sem cookie e sem detalhe', async () => {
  const idp = { ...identidadeContada().identidade, async iniciar() { throw new TypeError('fetch failed: ECONNREFUSED 10.0.0.1') } }
  const { deps, falhas } = montar(idp)
  const res = await entrar(req('/api/auth/entrar'), deps)
  assert.equal(res.status, 303)
  const local = new URL(res.headers.get('location'), SHELL)
  assert.equal(local.pathname, '/login')
  assert.equal(local.searchParams.get('erro'), 'ERRO_INTERNO')
  assert.match(local.searchParams.get('suporte'), /^[A-Za-z0-9_-]{1,64}$/)
  assert.equal(setCookie(res, '__Host-erp-login'), undefined)
  assert.doesNotMatch(res.headers.get('location'), /ECONNREFUSED|TypeError/)
  assert.equal(falhas.length, 1)
  assert.equal(falhas[0].supportId, local.searchParams.get('suporte'))
  await semVazamento(res)
})

test('GET /api/auth/retorno com retorno valido: sessao nova em __Host-session e __Host-erp-login apagado', async () => {
  const { deps, store } = montar()
  const { fim, login } = await cicloDev(deps, { de: '/zona2' })
  assert.equal(fim.status, 303)
  assert.equal(fim.headers.get('location'), '/zona2')
  const sessao = setCookie(fim, '__Host-session')
  const id = valor(sessao)
  assert.match(id, /^[0-9a-f-]{36}$/)
  assert.notEqual(id, login, 'o id da sessao e novo, nunca o da transacao')
  assert.match(sessao, /HttpOnly/i); assert.match(sessao, /Secure/i); assert.match(sessao, /SameSite=Lax/i); assert.match(sessao, /Path=\//)
  assert.match(setCookie(fim, '__Host-erp-login'), /Max-Age=0/)
  assert.equal((await store.leitor.ler(id)).sub, 'ana')
  await semVazamento(fim)
})

test('GET /api/auth/retorno com state ou nonce divergente: login de novo, sem sessao, e a transacao morre', async () => {
  for (const campo of ['state', 'nonce']) {
    const { deps } = montar()
    const { fim, login, params } = await cicloDev(deps, { mexer: (p) => ({ ...p, [campo]: 'x'.repeat(43) }) })
    assert.equal(fim.status, 303, campo)
    assert.equal(fim.headers.get('location'), '/login', campo)
    assert.equal(setCookie(fim, '__Host-session'), undefined, campo)
    assert.match(setCookie(fim, '__Host-erp-login'), /Max-Age=0/, campo)

    // a recusa consumiu a transacao: nem o mesmo cookie com a URL que o IdP mandou conclui depois
    const original = new URL(deps.ultimaUrl, SHELL)
    const certos = new URLSearchParams({ state: original.searchParams.get('state'), nonce: original.searchParams.get('nonce'), usuario: params.usuario })
    const outra = await retorno(req(`/api/auth/retorno?${certos}`, { cookie: `__Host-erp-login=${login}` }), deps)
    assert.equal(outra.headers.get('location'), '/login', `${campo}: transacao reaproveitada`)
    assert.equal(setCookie(outra, '__Host-session'), undefined, `${campo}: transacao reaproveitada`)
  }
})

test('GET /api/auth/retorno consome a transacao: o segundo retorno com o mesmo cookie e recusado', async () => {
  const { deps } = montar()
  const ini = await entrar(req('/api/auth/entrar'), deps)
  const login = valor(setCookie(ini, '__Host-erp-login'))
  const dev = new URL(ini.headers.get('location'), SHELL)
  const busca = new URLSearchParams({ state: dev.searchParams.get('state'), nonce: dev.searchParams.get('nonce'), usuario: 'ana' })
  const primeiro = await retorno(req(`/api/auth/retorno?${busca}`, { cookie: `__Host-erp-login=${login}` }), deps)
  assert.ok(valor(setCookie(primeiro, '__Host-session')))
  const segundo = await retorno(req(`/api/auth/retorno?${busca}`, { cookie: `__Host-erp-login=${login}` }), deps)
  assert.equal(segundo.headers.get('location'), '/login')
  assert.equal(setCookie(segundo, '__Host-session'), undefined)
})

test('GET /api/auth/retorno sem o cookie da transacao: login de novo', async () => {
  const { deps } = montar()
  const res = await retorno(req('/api/auth/retorno?state=a&nonce=b&usuario=ana'), deps)
  assert.equal(res.headers.get('location'), '/login')
  assert.equal(setCookie(res, '__Host-session'), undefined)
  assert.match(setCookie(res, '__Host-erp-login'), /Max-Age=0/)
})

test('GET /api/auth/retorno com usuario fora dos atores de dev: login de novo', async () => {
  const { deps } = montar()
  const { fim } = await cicloDev(deps, { usuario: 'intruso' })
  assert.equal(fim.headers.get('location'), '/login')
  assert.equal(setCookie(fim, '__Host-session'), undefined)
})

test('login nao vira redirecionamento aberto', async () => {
  for (const de of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
    const { deps } = montar()
    assert.equal((await cicloDev(deps, { de })).fim.headers.get('location'), '/', de)
  }
  // o destino vem da transacao, nunca da URL de retorno
  const { deps } = montar()
  const { fim } = await cicloDev(deps, { de: '/zona1', mexer: (p) => ({ ...p, de: 'https://evil.com' }) })
  assert.equal(fim.headers.get('location'), '/zona1')
})

test('GET /api/auth/retorno com o IdP fora (concluir lanca): login de novo com codigo e supportId, cookie da transacao apagado', async () => {
  const idp = { ...identidadeContada().identidade, async concluir() { throw new Error('ErroDoIdP: socket hang up') } }
  const { deps, store, falhas } = montar(idp)
  const t = { id: 'tx-1', state: 's'.repeat(43), codeVerifier: 'v'.repeat(43), nonce: 'n'.repeat(43), destino: '/', expiraEm: Date.now() + 60_000 }
  await store.escritor.gravarTransacao(t)
  const res = await retorno(req(`/api/auth/retorno?code=c&state=${t.state}`, { cookie: '__Host-erp-login=tx-1' }), deps)
  assert.equal(res.status, 303)
  const local = new URL(res.headers.get('location'), SHELL)
  assert.equal(local.pathname, '/login')
  assert.equal(local.searchParams.get('erro'), 'ERRO_INTERNO')
  assert.match(local.searchParams.get('suporte'), /^[A-Za-z0-9_-]{1,64}$/)
  assert.equal(setCookie(res, '__Host-session'), undefined)
  assert.match(setCookie(res, '__Host-erp-login'), /Max-Age=0/)
  assert.equal(falhas.length, 1)
  assert.equal(await store.escritor.consumirTransacao('tx-1'), null, 'a transacao ja foi consumida')
  await semVazamento(res)
})

test('POST /api/auth/sair encerra a sessao, apaga o cookie e manda ao logout do IdP', async () => {
  const idp = identidadeContada({ urlLogout: 'https://idp.exemplo/logout?client_id=erp-shell' })
  const { deps, store } = montar(idp.identidade)
  await store.escritor.gravar('s-1', sessaoVencendo())
  const res = await sair(req('/api/auth/sair', { metodo: 'POST', cookie: '__Host-session=s-1' }), deps)
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), 'https://idp.exemplo/logout?client_id=erp-shell')
  const c = setCookie(res, '__Host-session')
  assert.match(c, /Max-Age=0/); assert.match(c, /Secure/i); assert.match(c, /Path=\//)
  assert.equal(await store.leitor.ler('s-1'), null)
  await semVazamento(res)
})

test('POST /api/auth/sair sem logout no IdP (dev) vai ao login do shell', async () => {
  const { deps, store } = montar()
  await store.escritor.gravar('s-1', sessaoVencendo())
  const res = await sair(req('/api/auth/sair', { metodo: 'POST', cookie: '__Host-session=s-1' }), deps)
  assert.equal(res.headers.get('location'), '/login')
  assert.match(setCookie(res, '__Host-session'), /Max-Age=0/)
  assert.equal(await store.leitor.ler('s-1'), null)
})

test('POST /api/auth/sair com o IdP fora (encerrar lanca): sessao local encerrada, cookie apagado, login do shell', async () => {
  const idp = { ...identidadeContada().identidade, async encerrar() { throw new Error('discovery falhou') } }
  const { deps, store, falhas } = montar(idp)
  await store.escritor.gravar('s-1', sessaoVencendo())
  const res = await sair(req('/api/auth/sair', { metodo: 'POST', cookie: '__Host-session=s-1' }), deps)
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/login')
  assert.match(setCookie(res, '__Host-session'), /Max-Age=0/)
  assert.equal(await store.leitor.ler('s-1'), null)
  assert.equal(falhas.length, 1)
  await semVazamento(res)
})

test('POST /api/auth/sair sem cookie: so apaga e vai ao login', async () => {
  const { deps } = montar()
  const res = await sair(req('/api/auth/sair', { metodo: 'POST' }), deps)
  assert.equal(res.headers.get('location'), '/login')
  assert.match(setCookie(res, '__Host-session'), /Max-Age=0/)
})
