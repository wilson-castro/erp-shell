import { MENSAGENS, type CodigoErro } from '@erp/contratos'
import { loginDeDesenvolvimento } from '@/lib/nucleo'

const ehCodigo = (v: unknown): v is CodigoErro => typeof v === 'string' && Object.hasOwn(MENSAGENS, v)
const ehSuporte = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)

/**
 * Link, não formulário (ADR-0013, decisão 6): `GET /api/auth/entrar` manda ao IdP com um 303, que a
 * CSP (`form-action 'self'`) barraria depois de um POST. Erro de login chega como `{ codigo, supportId }`.
 */
export default async function Login({ searchParams }: { searchParams: Promise<{ de?: string; erro?: string; suporte?: string }> }) {
  const { de, erro, suporte } = await searchParams
  const entrar = `/api/auth/entrar?${new URLSearchParams({ de: typeof de === 'string' ? de : '/' })}`
  return (
    <main className="moldura-conteudo">
      <h1>Entrar</h1>
      {ehCodigo(erro) && (
        <p role="alert">
          {MENSAGENS[erro]}
          {ehSuporte(suporte) && <><br /><small>Código de suporte: {suporte}</small></>}
        </p>
      )}
      {loginDeDesenvolvimento && <p>Ambiente de desenvolvimento: no próximo passo você escolhe um ator. Em produção, o login é OIDC.</p>}
      <p><a href={entrar}>Entrar</a></p>
    </main>
  )
}
