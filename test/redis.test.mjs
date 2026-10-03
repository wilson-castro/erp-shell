// O invólucro do cliente Redis do shell passa ao node-redis o que o store de escrita do núcleo
// 0.10.0 usa: GETDEL (transação de login, uso único) e SET com PX e NX ou XX (lock e regravação).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adaptarCliente } from '../lib/redis.ts'

function nodeRedisFalso() {
  const chamadas = []
  return {
    chamadas,
    get: async (...a) => { chamadas.push(['get', ...a]); return 'v' },
    set: async (...a) => { chamadas.push(['set', ...a]); return 'OK' },
    del: async (...a) => { chamadas.push(['del', ...a]); return 1 },
    getDel: async (...a) => { chamadas.push(['getDel', ...a]); return 'lido' },
  }
}

test('SET com PX, NX e XX vira a forma de opcoes do node-redis, sem perder a condicao', async () => {
  const r = nodeRedisFalso()
  const c = adaptarCliente(async () => r)
  await c.set('k', 'v', { PX: 1500 })
  await c.set('lock', '1', { PX: 15000, NX: true })
  await c.set('s', 'x', { PX: 900, XX: true })
  assert.deepEqual(r.chamadas, [
    ['set', 'k', 'v', { expiration: { type: 'PX', value: 1500 } }],
    ['set', 'lock', '1', { expiration: { type: 'PX', value: 15000 }, condition: 'NX' }],
    ['set', 's', 'x', { expiration: { type: 'PX', value: 900 }, condition: 'XX' }],
  ])
})

test('SET devolve a resposta do Redis: OK so quando gravou', async () => {
  const r = nodeRedisFalso()
  r.set = async () => null
  assert.equal(await adaptarCliente(async () => r).set('lock', '1', { PX: 1, NX: true }), null)
})

test('GETDEL, GET e DEL passam direto', async () => {
  const r = nodeRedisFalso()
  const c = adaptarCliente(async () => r)
  assert.equal(await c.getDel('t'), 'lido')
  assert.equal(await c.get('k'), 'v')
  await c.del('k')
  assert.deepEqual(r.chamadas.map((x) => x[0]), ['getDel', 'get', 'del'])
})
