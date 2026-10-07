/**
 * Conferência da configuração na subida (C3). O Next chama `register()` no `next start` (e no `next dev`), não no
 * `next build` (`NEXT_PHASE=phase-production-build`, `next/dist/server/lib/router-utils/instrumentation-globals`).
 * Shell de produção sem `ERP_ZONAS_ORIGENS_PERMITIDAS` ou `ERP_TOKEN_SERVICO`, ou com tempo fora do teto, não sobe:
 * o erro aparece na subida, não a cada requisição (`lib/subida.ts`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { conferirNaSubida } = await import('./lib/subida')
    conferirNaSubida()
  }
}
