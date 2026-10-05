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
