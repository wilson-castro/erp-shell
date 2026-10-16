import type { RevogadorDeSessoes } from './revogacao-ativa.ts'

// Só tipo: a instância da revogação ativa compartilhada no processo (`lib/revogacao-ativa.ts`).
declare global {
  var __erpRevogacaoAtiva: RevogadorDeSessoes | undefined
}

export {}

