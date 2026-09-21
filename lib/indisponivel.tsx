import { MENSAGENS } from '@erp/contratos'

/** O que o layout mostra no lugar da página quando a gestão de acesso não responde. */
export function ServicoIndisponivel() {
  return (
    <>
      <h1>Serviço indisponível</h1>
      <p>{MENSAGENS.ERRO_INTERNO}</p>
    </>
  )
}
