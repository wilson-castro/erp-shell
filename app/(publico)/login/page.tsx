import { ATORES_DE_DESENVOLVIMENTO } from '@erp/nucleo/shell'

export default async function Login({ searchParams }: { searchParams: Promise<{ de?: string }> }) {
  const { de } = await searchParams
  return (
    <main className="moldura-conteudo">
      <h1>Entrar</h1>
      <p>Ambiente de desenvolvimento: escolha um ator. Em produção, o login é OIDC.</p>
      {ATORES_DE_DESENVOLVIMENTO.map((u) => (
        <form key={u} method="post" action="/api/auth/entrar">
          <input type="hidden" name="usuario" value={u} />
          <input type="hidden" name="de" value={de ?? '/'} />
          <button type="submit">Entrar como {u}</button>
        </form>
      ))}
    </main>
  )
}
