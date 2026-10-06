import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerTetoDaZona } from '../lib/configuracao.ts'

test('lerTetoDaZona: sem variavel, 10 s (decisao B1)', () => {
  assert.equal(lerTetoDaZona({}), 10_000)
})

test('lerTetoDaZona: le ERP_ZONA_TETO_MS', () => {
  assert.equal(lerTetoDaZona({ ERP_ZONA_TETO_MS: '6000' }), 6_000)
})

test('lerTetoDaZona: valor invalido falha na subida, nunca vira o padrao', () => {
  for (const v of ['0', '-1', '1.5', 'dez', '120001']) {
    assert.throws(() => lerTetoDaZona({ ERP_ZONA_TETO_MS: v }), /configuracao invalida: ERP_ZONA_TETO_MS/, `aceitou "${v}"`)
  }
})

test('lerTetoDaZona: aceita o teto de 120 s', () => {
  assert.equal(lerTetoDaZona({ ERP_ZONA_TETO_MS: '120000' }), 120_000)
})

test('lerTetoDaZona: recusa teto igual ou menor que o timeout de dominio (padrao 5000)', () => {
  assert.throws(() => lerTetoDaZona({ ERP_ZONA_TETO_MS: '5000' }), /maior que ERP_DESTINO_TIMEOUT_MS \(5000\)/)
  assert.throws(
    () => lerTetoDaZona({ ERP_ZONA_TETO_MS: '8000', ERP_DESTINO_TIMEOUT_MS: '8000' }),
    /maior que ERP_DESTINO_TIMEOUT_MS \(8000\)/,
  )
  assert.equal(lerTetoDaZona({ ERP_ZONA_TETO_MS: '4000', ERP_DESTINO_TIMEOUT_MS: '3000' }), 4_000)
})

test('lerTetoDaZona: ERP_DESTINO_TIMEOUT_MS invalido tambem falha (mesma validacao do nucleo)', () => {
  assert.throws(() => lerTetoDaZona({ ERP_DESTINO_TIMEOUT_MS: '60001' }), /configuracao invalida: ERP_DESTINO_TIMEOUT_MS/)
})
