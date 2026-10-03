// ADR-0013, decisão 6: com OIDC, o "Sair" (formulário POST da moldura) segue o 303 do shell para o
// logout do IdP; a CSP do shell tem de aceitar a origem do IdP em `form-action`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

// `@erp/nucleo/proxy` importa `next/server`, que sem extensão não resolve sob ESM fora do Next
registerHooks({
  resolve: (esp, ctx, prox) => (esp === 'next/server' ? prox('next/server.js', ctx) : prox(esp, ctx)),
})
const { criarCspDoShell } = await import('../lib/csp.ts')

const formAction = (csp) => csp.split('; ').find((d) => d.startsWith('form-action'))

test('shell com OIDC (IDP_EMISSOR): form-action aceita a origem do IdP, para o logout', () => {
  const csp = criarCspDoShell('http://localhost:8080/realms/erp')('n1')
  assert.equal(formAction(csp), "form-action 'self' http://localhost:8080")
  assert.match(csp, /'nonce-n1'/)
})

test('shell sem OIDC: form-action continua so self', () => {
  assert.equal(formAction(criarCspDoShell(undefined)('n1')), "form-action 'self'")
})

test('o proxy do shell monta a CSP por cspDoShell, nunca por politicaDeSeguranca direto', () => {
  const fonte = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8')
  assert.ok(!/politicaDeSeguranca\s*\(/.test(fonte), 'proxy.ts chama politicaDeSeguranca sem a origem do IdP')
  assert.equal(fonte.match(/cspDoShell\(/g)?.length, 2, 'CSP da requisicao e da resposta')
})
