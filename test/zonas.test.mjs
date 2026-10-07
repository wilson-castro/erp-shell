import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ehRotaReservada, ehFragmento, temFormaDeZona, ROTAS_RESERVADAS } from '../lib/zonas.ts'
import { mapaFixo } from './apoio-mapa.mjs'

test('ehRotaReservada: identifica corretamente rotas reservadas do shell', () => {
  // Arrange & Act & Assert
  assert.equal(ehRotaReservada('/'), true)
  assert.equal(ehRotaReservada('/login'), true)
  assert.equal(ehRotaReservada('/login?de=/zona1'), true)
  assert.equal(ehRotaReservada('/erro-de-zona'), true)
  assert.equal(ehRotaReservada('/api/auth/entrar'), true)
  assert.equal(ehRotaReservada('/api/auth/sair'), true)
  assert.equal(ehRotaReservada('/api/otel/v1/traces'), true)
  assert.equal(ehRotaReservada('/api/stream'), true)
  // C3: a rota interna do gateway de documento
  assert.equal(ehRotaReservada('/_gateway'), true)
  assert.equal(ehRotaReservada('/_gateway/zona1'), true)

  assert.equal(ehRotaReservada('/zona1'), false)
  assert.equal(ehRotaReservada('/zona2/tarefas'), false)
  assert.equal(ehRotaReservada('/acesso'), false)
})

test('C3: /_gateway esta entre as rotas reservadas (nenhuma zona registra esse prefixo)', () => {
  assert.ok(ROTAS_RESERVADAS.includes('/_gateway'))
})

test('C3: forma de zona e o primeiro segmento no formato do id, fora das reservadas', () => {
  for (const c of ['/zona1', '/zona1/x', '/ZONA1', '/zona1-static/a.js', '/a', '/nova-zona/x?y=1']) assert.equal(temFormaDeZona(c), true, c)
  for (const c of ['/', '', '/login', '/api/x', '/erro-de-zona', '/_gateway/zona1', '/_next/x', '/-x', '/zona_1', '/%7Ezona']) {
    assert.equal(temFormaDeZona(c), false, c)
  }
})

test('C1: ehFragmento so no segundo segmento, em qualquer caixa e grafia', () => {
  for (const c of ['/zona2/_fragmento/x', '/ZONA2/_FRAGMENTO', '/zona2/%5Ffragmento/x', '/zona2/%5ffragmento']) assert.equal(ehFragmento(c), true, c)
  for (const c of ['/zona2/_fragmentos/x', '/zona2/x/_fragmento', '/_fragmento/x', '/zona2/%zz/_fragmento']) assert.equal(ehFragmento(c), false, c)
})

test('C1: busca de zona ignora maiusculas, como o rewrite do Next (senao /ZONA2 escapa da sonda)', async () => {
  const mapa = mapaFixo([{ id: 'zona2', origem: 'http://127.0.0.1:3002' }])
  for (const c of ['/ZONA2', '/Zona2/x', '/zONA2', '/ZONA2-STATIC/a.js', '/Zona2-Static/b.css']) {
    assert.equal((await mapa.encontrar(c))?.id, 'zona2', c)
  }
  for (const c of ['/zona20', '/zona', '/xzona2', '/ZONA2X']) assert.equal(await mapa.encontrar(c), null, c)
})

test('C1: prefixo estatico em qualquer caixa continua sendo asset (caminho rapido), nao documento', async () => {
  const { decidirAcaoDoProxy } = await import('../lib/decisao-proxy.ts')
  const mapa = mapaFixo([{ id: 'zona2', origem: 'http://127.0.0.1:3002' }])
  const saudavel = { verificar: async () => true, limpar() {} }
  const d = await decidirAcaoDoProxy({ caminho: '/ZONA2-STATIC/a.js', temCookieSessao: false }, saudavel, mapa)
  assert.equal(d.acao, 'zona-rapida')
  assert.equal(d.destino.origin, 'http://127.0.0.1:3002')
})
