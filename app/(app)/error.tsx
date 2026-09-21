'use client'

import { MENSAGENS } from '@erp/contratos'

/** Erro dentro da moldura: a página falhou, o menu continua. Nada além do código público. */
export default function Erro({ error }: { error: Error & { digest?: string } }) {
  return (
    <>
      <h1>Não foi possível abrir esta página</h1>
      <p>{MENSAGENS.ERRO_INTERNO}</p>
      {error.digest && <p><small>Código de suporte: {error.digest}</small></p>}
    </>
  )
}
