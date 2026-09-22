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
