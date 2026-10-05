// Rotas de autenticação do shell (ADR-0013, decisão 6): entrar, retorno e sair, contra a fábrica
// real do núcleo com o provedor de desenvolvimento (o mesmo código de transação do OIDC).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { identidadeDev } from '@erp/nucleo/shell'
import { entrar, retorno, sair, registrarNoConsole } from '../lib/rotas-auth.ts'
import { lerHostsDoShell } from '../lib/configuracao.ts'
import { STORES, sessaoVencendo, identidadeContada, nucleoDoShell } from './apoio-auth.mjs'

const SHELL = 'http://localhost:3000'
const VIDA_TRANSACAO_S = 600   // padrão de ERP_LOGIN_TRANSACAO_S no núcleo

function montar(identidade = identidadeDev(), nomeStore = 'memoria') {
  const store = STORES[nomeStore]()
  const falhas = []
  const nucleo = nucleoDoShell(store, identidade)
  const deps = { sessao: nucleo.sessao, registrarFalha: (f) => falhas.push(f), hostsDoShell: ['localhost:3000'] }
  return { store, deps, falhas }
}

const req = (caminho, { metodo = 'GET', cookie, cabecalhos = {}, base = SHELL } = {}) =>
  new Request(`${base}${caminho}`, { method: metodo, headers: { ...cabecalhos, ...(cookie ? { cookie } : {}) } })

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
  // o cookie vive o mesmo que a transação: `expiraEm` de `iniciarLogin`, não um padrão do shell
  assert.match(setCookie(res, '__Host-erp-login'), /; Max-Age=60;/)
})

test('GET /api/auth/entrar: Max-Age do cookie da transacao segue ERP_LOGIN_TRANSACAO_S lido pelo nucleo', async () => {
  const antes = process.env.ERP_LOGIN_TRANSACAO_S
  process.env.ERP_LOGIN_TRANSACAO_S = '90'
  try {
    const { deps, store } = montar()
    const res = await entrar(req('/api/auth/entrar'), deps)
    const c = setCookie(res, '__Host-erp-login')
    assert.match(c, /; Max-Age=90;/)
    const t = await store.escritor.consumirTransacao(valor(c))
    assert.ok(t.expiraEm - Date.now() <= 90_000 && t.expiraEm - Date.now() > 88_000, 'a transacao no store vive o mesmo')
  } finally {
    if (antes === undefined) delete process.env.ERP_LOGIN_TRANSACAO_S
    else process.env.ERP_LOGIN_TRANSACAO_S = antes
  }
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

// N2 da revisão final do D2 (logout CSRF): de outro site, 403 sem apagar o cookie nem tocar o store.
const RECUSADOS = [
  ['Sec-Fetch-Site cross-site', { 'sec-fetch-site': 'cross-site', origin: 'https://outro.exemplo' }],
  ['Sec-Fetch-Site same-site', { 'sec-fetch-site': 'same-site', origin: 'https://irmao.localhost:3000' }],
  ['Sec-Fetch-Site cross-site com Origin do shell', { 'sec-fetch-site': 'cross-site', origin: SHELL }],
  ['sem Sec-Fetch-Site, Origin de outro site', { origin: 'https://outro.exemplo' }],
  ['sem Sec-Fetch-Site, Origin de outra porta', { origin: 'http://localhost:3001' }],
  ['sem Sec-Fetch-Site, Origin null', { origin: 'null' }],
  // mesmo host, outro esquema: `https://` e `http://` são origens diferentes (menor do gate do D2)
  ['sem Sec-Fetch-Site, Origin https do mesmo host numa requisicao http', { origin: 'https://localhost:3000' }],
  ['sem Sec-Fetch-Site, Origin http do mesmo host numa requisicao https', { origin: 'http://localhost:3000' }, 'https://localhost:3000'],
]
for (const [nome, cabecalhos, base] of RECUSADOS) {
  test(`POST /api/auth/sair de outra origem (${nome}): 403 com codigo e supportId, cookie e store intactos`, async () => {
    const idp = identidadeContada({ urlLogout: 'https://idp.exemplo/logout?client_id=erp-shell' })
    let encerrou = 0
    const identidade = { ...idp.identidade, async encerrar(...a) { encerrou++; return idp.identidade.encerrar(...a) } }
    const { deps, store, falhas } = montar(identidade)
    await store.escritor.gravar('s-1', sessaoVencendo())
    const res = await sair(req('/api/auth/sair', { metodo: 'POST', cookie: '__Host-session=s-1', cabecalhos, base }), deps)
    assert.equal(res.status, 403)
    assert.deepEqual(res.headers.getSetCookie(), [], 'nenhum cookie apagado')
    assert.equal(res.headers.get('location'), null)
    const corpo = await res.clone().json()
    assert.deepEqual(Object.keys(corpo).sort(), ['codigo', 'supportId'])
    assert.equal(corpo.codigo, 'OPERACAO_NAO_PERMITIDA')
    assert.match(corpo.supportId, /^[0-9a-f-]{36}$/)
    assert.deepEqual(falhas, [{ etapa: 'sair', codigo: 'OPERACAO_NAO_PERMITIDA', supportId: corpo.supportId }])
    assert.ok(await store.leitor.ler('s-1'), 'a sessao continua no store')
    assert.equal(encerrou, 0, 'o IdP nao foi chamado')
    await semVazamento(res)
  })
}

const ACEITOS = [
  ['Sec-Fetch-Site same-origin (o botao Sair do shell)', { 'sec-fetch-site': 'same-origin', origin: SHELL }],
  ['sem Sec-Fetch-Site, Origin do shell', { origin: SHELL }],
  ['sem Sec-Fetch-Site nem Origin', {}],
  ['sem Sec-Fetch-Site, Origin https do shell numa requisicao https', { origin: 'https://localhost:3000' }, 'https://localhost:3000'],
]
for (const [nome, cabecalhos, base] of ACEITOS) {
  test(`POST /api/auth/sair da mesma origem (${nome}): encerra e apaga o cookie`, async () => {
    const { deps, store } = montar()
    await store.escritor.gravar('s-1', sessaoVencendo())
    const res = await sair(req('/api/auth/sair', { metodo: 'POST', cookie: '__Host-session=s-1', cabecalhos, base }), deps)
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('location'), '/login')
    assert.match(setCookie(res, '__Host-session'), /Max-Age=0/)
    assert.equal(await store.leitor.ler('s-1'), null)
  })
}

test('SHELL_HOSTS: espacos em volta de cada host e itens vazios nao contam; sem a variavel, localhost:3000', () => {
  assert.deepEqual(lerHostsDoShell(undefined), ['localhost:3000'])
  assert.deepEqual(lerHostsDoShell('a.exemplo, b.exemplo:8443 ,,'), ['a.exemplo', 'b.exemplo:8443'])
})

test('POST /api/auth/sair com SHELL_HOSTS com espaco: o segundo host do shell e aceito', async () => {
  const { deps, store } = montar()
  deps.hostsDoShell = lerHostsDoShell('erp.exemplo, localhost:3000')
  await store.escritor.gravar('s-1', sessaoVencendo())
  const res = await sair(req('/api/auth/sair', { metodo: 'POST', cookie: '__Host-session=s-1', cabecalhos: { origin: SHELL } }), deps)
  assert.equal(res.status, 303)
  assert.equal(await store.leitor.ler('s-1'), null)
})

test('a rota sair e as paginas leem SHELL_HOSTS por lerHostsDoShell, sem split proprio', () => {
  for (const arquivo of ['app/api/auth/sair/route.ts', 'lib/pagina.ts']) {
    const fonte = readFileSync(new URL(`../${arquivo}`, import.meta.url), 'utf8')
    assert.match(fonte, /lerHostsDoShell\(\)/, arquivo)
    assert.doesNotMatch(fonte, /SHELL_HOSTS[^\n]*split/, arquivo)
  }
})

test('registrarNoConsole: uma linha so com etapa ou motivo, codigo e supportId (rotas e nucleo)', () => {
  const linhas = []
  const original = console.error
  console.error = (...a) => linhas.push(a.join(' '))
  try {
    registrarNoConsole({ etapa: 'entrar', codigo: 'ERRO_INTERNO', supportId: 'u-1' })
    registrarNoConsole({ motivo: 'janela-de-renovacao', codigo: 'ERRO_INTERNO', supportId: 'u-2' })
  } finally { console.error = original }
  assert.deepEqual(linhas, [
    '[auth] entrar falhou: codigo=ERRO_INTERNO supportId=u-1',
    '[auth] renovacao: motivo=janela-de-renovacao codigo=ERRO_INTERNO supportId=u-2',
  ])
})

test('lib/nucleo.ts passa o registrador das rotas ao nucleo e nao le ERP_LOGIN_TRANSACAO_S', () => {
  const fonte = readFileSync(new URL('../lib/nucleo.ts', import.meta.url), 'utf8')
  // Pela árvore sintática, não pelo texto: reformatar não quebra, e um comentário não conta.
  const sf = ts.createSourceFile('nucleo.ts', fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const importado = sf.statements.some((st) => ts.isImportDeclaration(st) && st.moduleSpecifier.text === './rotas-auth'
    && st.importClause?.namedBindings?.elements?.some((e) => e.name.text === 'registrarNoConsole' && !e.propertyName))
  assert.ok(importado, "lib/nucleo.ts nao importa registrarNoConsole de './rotas-auth'")
  const registradores = []
  const visitar = (no) => {
    if (ts.isCallExpression(no) && ts.isIdentifier(no.expression) && no.expression.text === 'criarNucleoDoShell') {
      const [opcoes] = no.arguments
      if (opcoes && ts.isObjectLiteralExpression(opcoes)) {
        for (const p of opcoes.properties) {
          if (p.name && ts.isIdentifier(p.name) && p.name.text === 'registrarFalha') {
            registradores.push(ts.isPropertyAssignment(p) && ts.isIdentifier(p.initializer) ? p.initializer.text : p.getText(sf))
          }
        }
      }
    }
    ts.forEachChild(no, visitar)
  }
  visitar(sf)
  assert.deepEqual(registradores, ['registrarNoConsole'], 'criarNucleoDoShell sem registrarFalha: registrarNoConsole')
  assert.doesNotMatch(fonte, /process\.env\.ERP_LOGIN_TRANSACAO_S|vidaTransacaoS/)
})

test('lib/cookies.ts e so de servidor: fora da condicao react-server a importacao falha', () => {
  const cookies = new URL('../lib/cookies.ts', import.meta.url).href
  const sem = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(cookies)})`], { encoding: 'utf8' })
  assert.notEqual(sem.status, 0, 'lib/cookies.ts carregou num contexto de cliente')
  assert.match(sem.stderr, /server-only|Server Component/i)
  const com = spawnSync(process.execPath, ['--conditions', 'react-server', '--input-type=module', '-e', `await import(${JSON.stringify(cookies)})`], { encoding: 'utf8' })
  assert.equal(com.status, 0, com.stderr)
})
