import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderizarPaginaErroDeZona } from '../lib/pagina-erro-zona.ts'

test('pagina de erro: id de zona valido aparece; id hostil e supportId hostil nunca sao ecoados', () => {
  assert.match(renderizarPaginaErroDeZona('zona1', 'abc-123'), /Zona "zona1"/)
  for (const hostil of ['<script>x</script>', 'zona"><img src=x>', "a' onerror='x"]) {
    const html = renderizarPaginaErroDeZona(hostil, hostil)
    assert.ok(!html.includes(hostil), `ecoou ${hostil}`)
    assert.ok(!html.includes('<script>x'), 'script injetado')
    assert.ok(!html.includes('<img src=x'), 'img injetada')
    assert.ok(!html.includes('onerror'), 'atributo injetado')
  }
})
