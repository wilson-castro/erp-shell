import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerTetoDaZona, verificarConfiguracaoDoShell } from '../lib/configuracao.ts'
import { readFileSync } from 'node:fs'

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

const producao = { NODE_ENV: 'production', ERP_TOKEN_SERVICO: 'token-ficticio', ERP_ZONAS_ORIGENS_PERMITIDAS: 'zona.svc:3001' }

test('D18: producao sem IdP recusa antes de servir; somente showcase autoriza identidade dev', () => {
  for (const emissor of [undefined, '', '   ']) {
    assert.throws(() => verificarConfiguracaoDoShell({ ...producao, IDP_EMISSOR: emissor }), /IDP_EMISSOR e obrigatorio/)
  }
  assert.doesNotThrow(() => verificarConfiguracaoDoShell({ ...producao, IDP_EMISSOR: 'https://idp.example/realm' }))
  assert.doesNotThrow(() => verificarConfiguracaoDoShell({ ...producao, ERP_PERMITIR_IDENTIDADE_DEV: '1' }))
  assert.throws(() => verificarConfiguracaoDoShell({ ...producao, ERP_PERMITIR_IDENTIDADE_DEV: 'true' }), /IDP_EMISSOR/)
  assert.doesNotThrow(() => verificarConfiguracaoDoShell({ NODE_ENV: 'development' }))
})

test('D18: scripts de producao nao autorizam identidade dev implicitamente', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  for (const nome of ['build', 'start']) assert.doesNotMatch(pkg.scripts[nome], /ERP_PERMITIR_IDENTIDADE_DEV/)
})
