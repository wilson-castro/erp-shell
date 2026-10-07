// Renovação proativa no proxy do shell (ADR-0013, decisão 4), contra a fábrica real do núcleo.
// A fábrica faz lock, releitura, renovação e gravação; o proxy decide o que a requisição faz com o
// resultado: segue, ou (sessão revogada ou ausente) apaga o cookie e manda ao login.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidirAcaoDoProxy } from '../lib/decisao-proxy.ts'
import { criarCacheSaudeZona } from '../lib/saude-zonas.ts'
import { STORES, sessaoVencendo, identidadeContada, nucleoDoShell, ateQue } from './apoio-auth.mjs'
import { mapaFixo, segue } from './apoio-mapa.mjs'

/** Páginas do próprio shell (ramo 4 da decisão): `/` e outra qualquer que não é pública nem de zona. */
const PAGINAS_DO_SHELL = ['/', '/preferencias']

const zonaNoAr = () => criarCacheSaudeZona(1000, 500, async () => ({ status: 200 }))

/** O caminho do proxy: o que `proxy.ts` passa para a decisão, com o `renovarSessao` da fábrica. */
const pedir = (nucleo, { caminho = '/zona1', idSessao = 's-1', metodo = 'GET' } = {}) =>
  decidirAcaoDoProxy(
    { caminho, temCookieSessao: idSessao !== undefined, idSessao, metodo },
    zonaNoAr(), mapaFixo(), nucleo.sessao.renovarSessao,
  )

for (const [nomeStore, criarStore] of Object.entries(STORES)) {
  test(`P0-d (${nomeStore}): 20 requisicoes concorrentes com token vencendo, 1 renovacao e 19 seguem sem esperar`, async () => {
    const store = criarStore()
    await store.escritor.gravar('s-1', sessaoVencendo())
    const idp = identidadeContada()
    const nucleo = nucleoDoShell(store, idp.identidade)

    const decisoes = new Array(20)
    let prontas = 0
    const todas = Array.from({ length: 20 }, (_, i) =>
      pedir(nucleo, { caminho: i % 2 ? '/zona1/relatorios' : '/' }).then((d) => { decisoes[i] = d; prontas++ }))

    // a renovação do vencedor está presa no IdP; as outras 19 já responderam
    await ateQue(() => prontas === 19)
    await ateQue(() => false, 20)
    assert.equal(prontas, 19, 'os perdedores do lock nao podem esperar a renovacao')
    assert.equal(idp.chamadas(), 1, 'exatamente uma ida ao IdP')
    assert.ok(decisoes.filter(Boolean).every((d) => segue(d) && !d.limparSessao))
    assert.equal((await store.leitor.ler('s-1')).accessToken, 'antigo.ana', 'antes do IdP responder, a sessao e a de antes')

    idp.liberar()
    await Promise.all(todas)
    assert.equal(idp.chamadas(), 1)
    assert.ok(decisoes.every((d) => segue(d) && !d.limparSessao))
    assert.equal((await store.leitor.ler('s-1')).accessToken, 'novo.ana', 'o vencedor gravou o token novo')
  })

  // Só páginas do shell, sem nenhuma de zona: um vencedor de zona não pode mascarar o ramo 4
  // (rotas do próprio shell) sem renovação. Quem fica numa página do shell depois do vencimento perderia a
  // sessão. Hoje o shell só tem `/`; `/preferencias` é outra página do ramo 4 (nem pública nem de zona), para
  // o teste continuar valendo quando o shell ganhar uma segunda página (auditor_d2_2, P04b).
  for (const caminhoDoShell of PAGINAS_DO_SHELL) {
    test(`paginas do shell (${nomeStore}): so requisicoes a ${caminhoDoShell} com o token na janela renovam uma vez e gravam o token novo`, async () => {
      const store = criarStore()
      await store.escritor.gravar('s-1', sessaoVencendo())
      const idp = identidadeContada()
      idp.liberar()
      const nucleo = nucleoDoShell(store, idp.identidade)

      const decisoes = await Promise.all(Array.from({ length: 5 }, () => pedir(nucleo, { caminho: caminhoDoShell })))
      assert.equal(idp.chamadas(), 1, 'a pagina do shell renova no proxy, uma vez')
      assert.ok(decisoes.every((d) => segue(d) && !d.limparSessao))
      assert.equal((await store.leitor.ler('s-1')).accessToken, 'novo.ana', 'o token novo foi gravado')
    })

    test(`pagina do shell com sessao revogada (${nomeStore}): navegacao a ${caminhoDoShell} vai ao login com o cookie apagado`, async () => {
      const store = criarStore()
      await store.escritor.gravar('s-1', sessaoVencendo())
      const idp = identidadeContada({ resultado: 'revogada' })
      idp.liberar()
      const d = await pedir(nucleoDoShell(store, idp.identidade), { caminho: caminhoDoShell })
      assert.deepEqual(d, { acao: 'redirecionar-login', destino: `/login?de=${encodeURIComponent(caminhoDoShell)}`, limparSessao: true })
      assert.equal(idp.chamadas(), 1)
    })
  }

  test(`revogada (${nomeStore}): navegacao vai ao login com o cookie apagado e a sessao some do store`, async () => {
    const store = criarStore()
    await store.escritor.gravar('s-1', sessaoVencendo())
    const idp = identidadeContada({ resultado: 'revogada' })
    idp.liberar()
    const nucleo = nucleoDoShell(store, idp.identidade)

    const d = await pedir(nucleo, { caminho: '/zona2' })
    assert.deepEqual(d, { acao: 'redirecionar-login', destino: '/login?de=%2Fzona2', limparSessao: true })
    assert.equal(await store.leitor.ler('s-1'), null)
  })

  test(`erro transitorio do IdP (${nomeStore}): a sessao fica e a requisicao segue`, async () => {
    const store = criarStore()
    await store.escritor.gravar('s-1', sessaoVencendo())
    const idp = identidadeContada({ resultado: 'lanca' })
    idp.liberar()
    const nucleo = nucleoDoShell(store, idp.identidade)

    const d = await pedir(nucleo, { caminho: '/' })
    assert.equal(d.acao, 'prosseguir')
    assert.equal(d.limparSessao, undefined, 'erro transitorio nao desloga')
    assert.equal((await store.leitor.ler('s-1')).accessToken, 'antigo.ana')
  })
}

test('revogada numa Server Action (POST): segue sem redirecionar, para a camada 2 responder, e apaga o cookie', async () => {
  const store = STORES.memoria()
  await store.escritor.gravar('s-1', sessaoVencendo())
  const idp = identidadeContada({ resultado: 'revogada' })
  idp.liberar()
  const d = await pedir(nucleoDoShell(store, idp.identidade), { caminho: '/zona2', metodo: 'POST' })
  // POST de zona vai pelo caminho rápido (só documento vai pelo gateway)
  assert.equal(d.acao, 'zona-rapida')
  assert.equal(d.limparSessao, true)
})

test('cookie de sessao que nao existe no store (ausente): navegacao vai ao login com o cookie apagado', async () => {
  const idp = identidadeContada()
  const d = await pedir(nucleoDoShell(STORES.memoria(), idp.identidade), { caminho: '/zona1', idSessao: 'forjado' })
  assert.deepEqual(d, { acao: 'redirecionar-login', destino: '/login?de=%2Fzona1', limparSessao: true })
  assert.equal(idp.chamadas(), 0)
})

test('token em dia: nenhuma ida ao IdP e a requisicao segue', async () => {
  const store = STORES.memoria()
  await store.escritor.gravar('s-1', { ...sessaoVencendo(), tokenExpiraEm: Date.now() + 300_000 })
  const idp = identidadeContada()
  const d = await pedir(nucleoDoShell(store, idp.identidade), { caminho: '/' })
  assert.equal(d.acao, 'prosseguir')
  assert.equal(idp.chamadas(), 0)
})

test('rotas publicas, telemetria e estaticos de zona nao renovam', async () => {
  let chamadas = 0
  const renovar = async () => { chamadas++; return 'revogada' }
  for (const caminho of ['/login', '/api/auth/retorno', '/api/otel/v1/traces', '/zona1-static/x.js']) {
    const d = await decidirAcaoDoProxy({ caminho, temCookieSessao: true, idSessao: 's-1', metodo: 'GET' }, zonaNoAr(), mapaFixo(), renovar)
    assert.notEqual(d.acao, 'redirecionar-login', caminho)
  }
  assert.equal(chamadas, 0)
})

// D19-B (núcleo 0.10.3): com o token JÁ vencido, quem perde o lock espera o vencedor e segue com o token novo,
// em vez de seguir com o token morto (que o domínio recusaria, levando ao login).
for (const [nomeStore, criarStore] of Object.entries(STORES)) {
  test(`token ja vencido (${nomeStore}): 10 requisicoes concorrentes, os perdedores esperam a renovacao e todas seguem`, async () => {
    const store = criarStore()
    await store.escritor.gravar('s-1', { ...sessaoVencendo(), tokenExpiraEm: Date.now() - 1_000 })
    const idp = identidadeContada()
    const nucleo = nucleoDoShell(store, idp.identidade)

    let prontas = 0
    const todas = Array.from({ length: 10 }, (_, i) =>
      pedir(nucleo, { caminho: i % 2 ? '/zona1' : '/' }).then((d) => { prontas++; return d }))
    await ateQue(() => idp.chamadas() === 1)
    await ateQue(() => false, 20)
    assert.equal(prontas, 0, 'com o token vencido, os perdedores do lock esperam o vencedor')

    idp.liberar()
    const decisoes = await Promise.all(todas)
    assert.equal(idp.chamadas(), 1, 'exatamente uma ida ao IdP')
    assert.ok(decisoes.every((d) => segue(d) && !d.limparSessao), JSON.stringify(decisoes))
    assert.equal((await store.leitor.ler('s-1')).accessToken, 'novo.ana', 'o vencedor gravou o token novo')
  })
}

// auditor_d19b_1 (A10, A10c, A10d): o store que lança dentro de `renovarSessao` com o token vencido é erro,
// não ausência. A requisição segue e o cookie fica; `ausente` mandaria ao login com a sessão intacta (D19).
// Vale nas três leituras da fábrica: antes do lock, com o lock na mão e durante a espera do perdedor.
const MOMENTOS_DA_FALHA = [
  // [nome, leitura que lança (1 = a primeira), lock de outro dono?]
  ['antes do lock', 1, false],
  ['na releitura com o lock na mao', 2, false],
  ['durante a espera do perdedor', 2, true],
]
for (const [nomeStore, criarStore] of Object.entries(STORES)) {
  for (const [momento, falharNa, lockDeOutro] of MOMENTOS_DA_FALHA) {
    test(`store fora ${momento} (${nomeStore}): token vencido, a requisicao segue sem apagar o cookie e a sessao fica`, { timeout: 10_000 }, async () => {
      // um store novo por caminho: o lock que a primeira requisição prende mudaria o momento da segunda
      for (const caminho of ['/zona1', '/']) {
        const store = criarStore()
        await store.escritor.gravar('s-1', { ...sessaoVencendo(), tokenExpiraEm: Date.now() - 1_000 })
        if (lockDeOutro) assert.ok(await store.escritor.adquirirLockRenovacao('s-1', 60_000), 'lock de outro processo')
        let leituras = 0
        const leitor = {
          ler: async (k) => {
            if (++leituras >= falharNa) throw new Error('store fora do ar')
            return store.leitor.ler(k)
          },
        }
        const idp = identidadeContada()
        idp.liberar()
        const inicio = Date.now()
        const d = await pedir(nucleoDoShell({ leitor, escritor: store.escritor }, idp.identidade), { caminho })
        assert.equal(leituras, falharNa, 'a falha nao aconteceu no momento pedido')
        assert.ok(segue(d), `${caminho}: ${JSON.stringify(d)}`)
        assert.equal(d.limparSessao, undefined, `${caminho}: erro do store apagou o cookie`)
        assert.ok(Date.now() - inicio < 1_000, 'esperou o teto em vez de propagar o erro')
        assert.equal(idp.chamadas(), 0, 'chamou o IdP sem ter lido a sessao')
        assert.equal((await store.leitor.ler('s-1')).accessToken, 'antigo.ana', 'a sessao mudou ou sumiu')
      }
    })
  }
}
