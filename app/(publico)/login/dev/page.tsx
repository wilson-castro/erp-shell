import { notFound } from 'next/navigation'
import { ATORES_DE_DESENVOLVIMENTO } from '@erp/nucleo/shell'
import { loginDeDesenvolvimento } from '@/lib/nucleo'

/**
 * O "IdP" de desenvolvimento (contrato do `identidadeDev`): recebe `state` e `nonce` da transação
 * e devolve o navegador ao retorno do shell com eles e o ator escolhido. Com `IDP_EMISSOR`, não existe.
 */
export default async function LoginDev({ searchParams }: { searchParams: Promise<{ state?: string; nonce?: string }> }) {
  if (!loginDeDesenvolvimento) notFound()
  const { state, nonce } = await searchParams
  if (typeof state !== 'string' || typeof nonce !== 'string') notFound()
  return (
    <main className="moldura-conteudo">
      <h1>Entrar</h1>
      <p>Ambiente de desenvolvimento: escolha um ator. Em produção, o login é OIDC.</p>
      <ul>
        {ATORES_DE_DESENVOLVIMENTO.map((usuario) => (
          <li key={usuario}>
            <a href={`/api/auth/retorno?${new URLSearchParams({ state, nonce, usuario })}`}>Entrar como {usuario}</a>
          </li>
        ))}
      </ul>
    </main>
  )
}
