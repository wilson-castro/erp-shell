import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { criarRevogacaoAtiva } from '../lib/revogacao-ativa.ts'
import { lerIntervaloDeEventos, lerLockDeEventos, verificarConfiguracaoDoShell } from '../lib/configuracao.ts'

function coordenadorMemoria({ cursorInicial = 0, lockDisponivel = true } = {}) {
  let cursor = cursorInicial
  let leiturasCursor = 0
  const locks = []
  return {
    cursor: () => cursor,
    leiturasCursor: () => leiturasCursor,
    locks,
    async adquirirLock(ttlMs) {
      locks.push(ttlMs)
      return lockDisponivel
    },
    async lerCursor() {
      leiturasCursor++
      return cursor
    },
    async gravarCursor(seq) { cursor = seq },
  }
}

test('revogacaoAtiva: PESSOA_DESLIGADA e PESSOA_SUSPENSA removem sessoes dos sujeitos em ordem de seq e avancam cursor', async () => {
  let t = 10_000
  const buscou = []
  const removidos = []
  const coordenador = coordenadorMemoria()
  const rev = criarRevogacaoAtiva({
    intervaloMs: 5_000,
    lockMs: 10_000,
    agora: () => t,
    coordenador,
    fonte: async (desde) => {
      buscou.push(desde)
      if (desde === 0) {
        return [
          { seq: 5, tipo: 'PESSOA_SUSPENSA', alvo: 'p-13', sujeitos: ['idp-norte2', 'norte2'] },
          { seq: 2, tipo: 'PESSOA_DESLIGADA', alvo: 'p-20', sujeitos: ['00000000-0000-4000-8000-00000000a004', 'davi'] },
        ]
      }
      return []
    },
    removerPorSujeito: async (sub) => { removidos.push(sub); return 1 },
  })

  await rev.sincronizarSePreciso()
  assert.deepEqual(buscou, [0])
  assert.equal(coordenador.cursor(), 5)
  assert.deepEqual(coordenador.locks, [10_000])
  assert.deepEqual(removidos, [
    '00000000-0000-4000-8000-00000000a004', 'davi', 'p-20',
    'idp-norte2', 'norte2', 'p-13',
  ])

  // Dentro do intervalo (intervaloMs - 1): nao busca de novo
  t += 4_999
  await rev.sincronizarSePreciso()
  assert.deepEqual(buscou, [0])

  // Exatamente em intervaloMs: busca com desde = 5
  t += 1
  await rev.sincronizarSePreciso()
  assert.deepEqual(buscou, [0, 5])
})

test('revogacaoAtiva: ACESSO_REVOGADO avanca o cursor mas NAO encerra sessao, e evento repetido com seq <= desde e ignorado', async () => {
  const removidos = []
  const coordenador = coordenadorMemoria({ cursorInicial: 3 })
  const rev = criarRevogacaoAtiva({
    intervaloMs: 5_000,
    lockMs: 10_000,
    coordenador,
    fonte: async (desde) => {
      assert.equal(desde, 3)
      return [
        // Evento repetido com seq === desde (3) ou menor (2) deve ser ignorado mesmo se for PESSOA_DESLIGADA
        { seq: 2, tipo: 'PESSOA_DESLIGADA', alvo: 'p-10', sujeitos: ['antigo2'] },
        { seq: 3, tipo: 'PESSOA_DESLIGADA', alvo: 'p-11', sujeitos: ['antigo3'] },
        { seq: 4, tipo: 'ACESSO_REVOGADO', alvo: 'p-20', sujeitos: ['00000000-0000-4000-8000-00000000a004', 'davi'] },
      ]
    },
    removerPorSujeito: async (sub) => { removidos.push(sub); return 1 },
  })

  await rev.sincronizarAgora()
  assert.deepEqual(removidos, [])
  assert.equal(coordenador.cursor(), 4)
})

test('revogacaoAtiva: voo unico no processo e lock distribuido evitam tempestade em /v2/eventos', async () => {
  let chamadas = 0
  const coordenador = coordenadorMemoria()
  const rev = criarRevogacaoAtiva({
    intervaloMs: 5_000,
    lockMs: 10_000,
    coordenador,
    fonte: async () => {
      chamadas++
      await new Promise((r) => setTimeout(r, 20))
      return [{ seq: 1, tipo: 'ACESSO_REVOGADO', alvo: 'p-20' }]
    },
    removerPorSujeito: async () => 0,
  })

  await Promise.all(Array.from({ length: 10 }, () => rev.sincronizarSePreciso()))
  assert.equal(chamadas, 1)
  assert.equal(coordenador.cursor(), 1)

  // Quando outra instancia do shell detem o lock no Redis, nao le cursor, nao chama a fonte e nao remove sessao
  let chamadasPerdedor = 0
  const coordPerdedor = coordenadorMemoria({ lockDisponivel: false })
  const revPerdedor = criarRevogacaoAtiva({
    intervaloMs: 5_000,
    lockMs: 10_000,
    coordenador: coordPerdedor,
    fonte: async () => { chamadasPerdedor++; return [] },
    removerPorSujeito: async () => 0,
  })
  await revPerdedor.sincronizarSePreciso()
  assert.equal(chamadasPerdedor, 0)
  assert.equal(coordPerdedor.leiturasCursor(), 0)
})

test('revogacaoAtiva: falha parcial em removerPorSujeito no segundo evento grava o cursor do primeiro e reprocessa o segundo depois', async () => {
  const falhas = []
  const removidos = []
  const coordenador = coordenadorMemoria({ cursorInicial: 0 })
  let falharNoSegundo = true
  const rev = criarRevogacaoAtiva({
    intervaloMs: 5_000,
    lockMs: 10_000,
    coordenador,
    registrarFalha: (m) => falhas.push(m),
    fonte: async (desde) => {
      const todos = [
        { seq: 1, tipo: 'PESSOA_DESLIGADA', sujeitos: ['ana'] },
        { seq: 2, tipo: 'PESSOA_SUSPENSA', sujeitos: ['bruno'] },
      ]
      return todos.filter((ev) => ev.seq > desde)
    },
    removerPorSujeito: async (sub) => {
      if (sub === 'bruno' && falharNoSegundo) throw new Error('redis indisponivel no meio')
      removidos.push(sub)
      return 1
    },
  })

  await rev.sincronizarAgora()
  assert.equal(coordenador.cursor(), 1, 'cursor deve parar no primeiro evento concluido')
  assert.deepEqual(removidos, ['ana'])
  assert.equal(falhas.length, 1)

  falharNoSegundo = false
  await rev.sincronizarAgora()
  assert.equal(coordenador.cursor(), 2, 'segunda rodada deve concluir o segundo evento')
  assert.deepEqual(removidos, ['ana', 'bruno'])
})

test('revogacaoAtiva: falha na fonte nao derruba a requisicao nem avanca o cursor', async () => {
  let t = 1_000
  const falhas = []
  const coordenador = coordenadorMemoria({ cursorInicial: 7 })
  let falhar = true
  const rev = criarRevogacaoAtiva({
    intervaloMs: 5_000,
    lockMs: 10_000,
    agora: () => t,
    coordenador,
    registrarFalha: (m) => falhas.push(m),
    fonte: async () => {
      if (falhar) throw new Error('gestao de acesso indisponivel')
      return [{ seq: 8, tipo: 'PESSOA_DESLIGADA', alvo: 'p-20', sujeitos: ['davi'] }]
    },
    removerPorSujeito: async () => 1,
  })

  await rev.sincronizarSePreciso()
  assert.equal(coordenador.cursor(), 7)
  assert.equal(falhas.length, 1)

  falhar = false
  t += 5_000
  await rev.sincronizarSePreciso()
  assert.equal(coordenador.cursor(), 8)
})

test('configuracao de eventos: padroes, fronteiras exatas (100, 60000, 1000, 120000) e validacao na subida do shell', () => {
  assert.equal(lerIntervaloDeEventos({}), 5_000)
  assert.equal(lerIntervaloDeEventos({ ERP_EVENTOS_ACESSO_INTERVALO_MS: '100' }), 100)
  assert.equal(lerIntervaloDeEventos({ ERP_EVENTOS_ACESSO_INTERVALO_MS: '60000' }), 60_000)
  assert.equal(lerLockDeEventos({}), 10_000)
  assert.equal(lerLockDeEventos({ ERP_EVENTOS_ACESSO_INTERVALO_MS: '100', ERP_EVENTOS_ACESSO_LOCK_MS: '1000' }), 1_000)
  assert.equal(lerLockDeEventos({ ERP_EVENTOS_ACESSO_LOCK_MS: '120000' }), 120_000)

  for (const invalido of ['0', '-5', '99', '60001', 'abc']) {
    assert.throws(() => lerIntervaloDeEventos({ ERP_EVENTOS_ACESSO_INTERVALO_MS: invalido }), /ERP_EVENTOS_ACESSO_INTERVALO_MS/, invalido)
  }
  for (const invalido of ['0', '-5', '999', '120001', 'abc']) {
    assert.throws(
      () => lerLockDeEventos({ ERP_EVENTOS_ACESSO_INTERVALO_MS: '100', ERP_EVENTOS_ACESSO_LOCK_MS: invalido }),
      /ERP_EVENTOS_ACESSO_LOCK_MS/,
      invalido,
    )
  }
  // lock <= intervalo reprova
  assert.throws(
    () => lerLockDeEventos({ ERP_EVENTOS_ACESSO_INTERVALO_MS: '5000', ERP_EVENTOS_ACESSO_LOCK_MS: '5000' }),
    /deve ser maior que ERP_EVENTOS_ACESSO_INTERVALO_MS/,
  )
  assert.throws(
    () => verificarConfiguracaoDoShell({ NODE_ENV: 'development', ERP_EVENTOS_ACESSO_INTERVALO_MS: '99' }),
    /ERP_EVENTOS_ACESSO_INTERVALO_MS/,
  )
})

test('lib/revogacao-ativa.ts e server-only: fora de react-server a importacao falha', () => {
  const r = spawnSync(
    process.execPath,
    ['-e', "import('./lib/revogacao-ativa.ts')"],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
  )
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /Client Component|server-only/)
})

