import { verificarConfiguracaoDoShell } from './configuracao'

/**
 * Conferência da configuração na subida (chamada só pelo `register()` do `instrumentation.ts`, no runtime Node).
 * Fica fora do `instrumentation.ts` porque ele também é compilado para o runtime Edge, onde `process.exit` não existe.
 * O Next 16 só registra o erro do `register()` e segue no ar sem servir (conferido); por isso o processo sai.
 */
export function conferirNaSubida(): void {
  try {
    verificarConfiguracaoDoShell()
  } catch (e) {
    console.error(`[shell] nao sobe: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
