'use client'

import { MENSAGENS } from '@erp/contratos'

/**
 * Último recurso: erro no layout raiz (ex.: gestão de acesso fora). Sem moldura, porque
 * foi ela que falhou. Só a mensagem pública e o `digest`, que é opaco (invariante 12).
 */
export default function ErroGlobal({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="pt-BR">
      <body>
        <main className="moldura-conteudo">
          <h1>Serviço indisponível</h1>
          <p>{MENSAGENS.ERRO_INTERNO}</p>
          {error.digest && <p><small>Código de suporte: {error.digest}</small></p>}
          <p><a href="/">Voltar ao início</a></p>
        </main>
      </body>
    </html>
  )
}
