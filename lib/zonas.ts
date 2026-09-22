import mapa from '../zonas.json' with { type: 'json' }

export const ROTAS_RESERVADAS = [
  '/',
  '/login',
  '/erro-de-zona',
  '/api',
  '/api/auth',
  '/api/otel',
  '/api/stream',
] as const

export interface DefinicaoDeZona {
  readonly id: string
  readonly origem: string
  readonly prefixo: string
  readonly prefixoEstatico: string
  readonly urlSaude: string
}

export function ehRotaReservada(caminho: string): boolean {
  if (!caminho || caminho === '/') return true
  const semQuery = caminho.split('?')[0] ?? ''
  const normalizado = semQuery.startsWith('/') ? semQuery : `/${semQuery}`
  return ROTAS_RESERVADAS.some((reservada) =>
    reservada === '/'
      ? normalizado === '/'
      : normalizado === reservada || normalizado.startsWith(`${reservada}/`)
  )
}

export function carregarZonas(
  mapaEntrada: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env
): readonly DefinicaoDeZona[] {
  const zonasValidas: DefinicaoDeZona[] = []

  for (const [id, origemPadrao] of Object.entries(mapaEntrada)) {
    // Só minúsculas, dígitos e hífen: a busca de zona compara o caminho em minúsculas, e um id
    // com maiúscula nunca casaria, deixando o caminho sem sonda (reviewer_shell_2). Falha no
    // boot, não na requisição.
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      throw new Error(`zonas.json: id de zona invalido "${id}" (use minusculas, digitos e hifen)`)
    }
    if (ehRotaReservada(`/${id}`)) {
      continue
    }

    const envOrigem = env[`ZONA_${id.toUpperCase().replaceAll('-', '_')}_URL`]
    const origem = envOrigem ?? origemPadrao
    const envSaude = env[`ZONA_${id.toUpperCase().replaceAll('-', '_')}_HEALTH_URL`]
    const urlSaude = envSaude ?? `${origem}/${id}/api/health`

    zonasValidas.push({
      id,
      origem,
      prefixo: `/${id}`,
      prefixoEstatico: `/${id}-static`,
      urlSaude,
    })
  }

  return Object.freeze(zonasValidas)
}

export const ZONAS: readonly DefinicaoDeZona[] = carregarZonas(mapa)

export const PREFIXOS_DE_ZONA: readonly string[] = ZONAS.flatMap(({ prefixo, prefixoEstatico }) => [
  prefixo,
  prefixoEstatico,
])

export function encontrarZonaPorCaminho(
  caminho: string,
  zonas: readonly DefinicaoDeZona[] = ZONAS
): DefinicaoDeZona | null {
  const semQuery = caminho.split('?')[0] ?? ''
  // O rewrite do Next casa o prefixo sem diferenciar maiúsculas: /ZONA2 chega à zona 2. A
  // busca aqui tem de casar igual, senão o caminho em outra caixa escapa da sonda (gate
  // "Shell novo", challenger_shell_1 C1).
  const normalizado = (semQuery.startsWith('/') ? semQuery : `/${semQuery}`).toLowerCase()
  for (const zona of zonas) {
    if (normalizado === zona.prefixo || normalizado.startsWith(`${zona.prefixo}/`)) {
      return zona
    }
    if (normalizado === zona.prefixoEstatico || normalizado.startsWith(`${zona.prefixoEstatico}/`)) {
      return zona
    }
  }
  return null
}

export function gerarRewrites(zonas: readonly DefinicaoDeZona[] = ZONAS) {
  return zonas.flatMap(({ id, origem }) => [
    { source: `/${id}`, destination: `${origem}/${id}` },
    { source: `/${id}/:caminho*`, destination: `${origem}/${id}/:caminho*` },
    { source: `/${id}-static/:caminho*`, destination: `${origem}/${id}-static/:caminho*` },
  ])
}
