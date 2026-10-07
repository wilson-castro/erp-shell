/**
 * Parâmetro numérico lido do ambiente (docs/CONFIGURACAO.md). Ausente: o padrão. Presente e
 * inválido (não inteiro, zero, negativo, acima do teto): erro na subida, nunca um valor que
 * ninguém escolheu (auditor_b1_d1_2, L2). Uma cópia só no shell.
 */
export function lerNumeroPositivo(valor: string | undefined, padrao: number, nome: string, maximo = Number.MAX_SAFE_INTEGER): number {
  if (valor === undefined || valor === '') return padrao
  const n = Number(valor)
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(`configuracao invalida: ${nome} deve ser inteiro positivo, recebeu "${valor}"`)
  }
  if (n > maximo) throw new Error(`configuracao invalida: ${nome} deve ser no maximo ${maximo}, recebeu "${valor}"`)
  return n
}

/**
 * Hosts do shell que servem a aplicação ao navegador (`SHELL_HOSTS`, separados por vírgula; padrão
 * `localhost:3000`). Espaço em volta de cada host é ignorado (`a:3000, b:3000`) e item vazio some:
 * sem isso, `' b:3000'` nunca casaria com o `host` de uma URL. Uma leitura só para `sair` e páginas.
 */
export function lerHostsDoShell(valor: string | undefined = process.env.SHELL_HOSTS): string[] {
  return (valor ?? 'localhost:3000').split(',').map((h) => h.trim()).filter((h) => h !== '')
}

/**
 * Teto de silêncio de uma zona, em ms (`ERP_ZONA_TETO_MS`, docs/CONFIGURACAO.md §2; padrão 10 s, decisão B1). Vira o
 * `experimental.proxyTimeout` do Next: a resposta repassada é cortada quando a zona passa esse tempo **sem mandar nenhum
 * byte** (inatividade do socket, não duração; streaming que segue mandando dados não é cortado). Tem de passar o timeout
 * de domínio: senão a página que espera um domínio lento seria cortada antes de degradar (D7).
 */
export function lerTetoDaZona(env: NodeJS.ProcessEnv = process.env): number {
  const teto = lerNumeroPositivo(env.ERP_ZONA_TETO_MS, 10_000, 'ERP_ZONA_TETO_MS', 120_000)
  // mesmo padrão e teto do núcleo (`interno/configuracao.ts`), que não exporta o leitor
  const destino = lerNumeroPositivo(env.ERP_DESTINO_TIMEOUT_MS, 5_000, 'ERP_DESTINO_TIMEOUT_MS', 60_000)
  if (teto <= destino) {
    throw new Error(`configuracao invalida: ERP_ZONA_TETO_MS (${teto}) deve ser maior que ERP_DESTINO_TIMEOUT_MS (${destino})`)
  }
  return teto
}

/** TTL do mapa vivo de zonas (`ERP_MAPA_ZONAS_TTL_MS`, docs/CONFIGURACAO.md §2): padrão 30 s, teto 300 s; abaixo de 1 s é recusado. */
export function lerTtlDoMapaDeZonas(env: NodeJS.ProcessEnv = process.env): number {
  const ttl = lerNumeroPositivo(env.ERP_MAPA_ZONAS_TTL_MS, 30_000, 'ERP_MAPA_ZONAS_TTL_MS', 300_000)
  if (ttl < 1000) throw new Error(`configuracao invalida: ERP_MAPA_ZONAS_TTL_MS deve ser no minimo 1000, recebeu "${env.ERP_MAPA_ZONAS_TTL_MS}"`)
  return ttl
}

/** Validade do último mapa bom guardado no Redis, em segundos (`ERP_MAPA_ZONAS_GUARDA_S`): padrão 1 dia, teto 7 dias. */
export function lerValidadeDaGuardaDoMapa(env: NodeJS.ProcessEnv = process.env): number {
  return lerNumeroPositivo(env.ERP_MAPA_ZONAS_GUARDA_S, 86_400, 'ERP_MAPA_ZONAS_GUARDA_S', 604_800)
}

/**
 * Padrões `host:porta` das origens que o mapa vivo aceita (`ERP_ZONAS_ORIGENS_PERMITIDAS`, lista por vírgula).
 * Sem a variável: `127.0.0.1:*,localhost:*` fora de produção; em produção o shell não sobe.
 */
export function lerOrigensPermitidas(env: NodeJS.ProcessEnv = process.env): string[] {
  const bruto = env.ERP_ZONAS_ORIGENS_PERMITIDAS
  const lista = (bruto ?? '').split(',').map((p) => p.trim()).filter((p) => p !== '')
  if (lista.length > 0) return lista
  if (env.NODE_ENV === 'production') {
    throw new Error('configuracao invalida: ERP_ZONAS_ORIGENS_PERMITIDAS e obrigatoria em producao (lista de host:porta)')
  }
  return ['127.0.0.1:*', 'localhost:*']
}

/** Token de serviço do shell (`ERP_TOKEN_SERVICO`); o padrão `svc.shell` só existe fora de produção. */
export function lerTokenDeServico(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.ERP_TOKEN_SERVICO || (env.NODE_ENV !== 'production' ? 'svc.shell' : undefined)
}
