import 'server-only'

/**
 * Cookies do shell. `__Host-` exige `Secure` e `Path=/` e proíbe `Domain`: o cookie fica preso à
 * origem do shell. `SameSite=Lax` deixa os dois chegarem na navegação de topo que volta do IdP.
 */
export const NOME_COOKIE_SESSAO = '__Host-session'
/** Id opaco da transação de login (ADR-0013, decisão 3); `state`, verifier e nonce ficam no store. */
export const NOME_COOKIE_LOGIN = '__Host-erp-login'

/** `Set-Cookie` HttpOnly do shell. Sem `maxAgeS`, cookie de sessão do navegador. */
export function cookieDoShell(nome: string, valor: string, maxAgeS?: number): string {
  const idade = maxAgeS === undefined ? '' : `; Max-Age=${maxAgeS}`
  return `${nome}=${encodeURIComponent(valor)}; Path=/${idade}; HttpOnly; Secure; SameSite=Lax`
}

/** Remoção: mesmos atributos (sem `Secure` o navegador ignora o `Set-Cookie` de um `__Host-`). */
export const apagarCookie = (nome: string) => cookieDoShell(nome, '', 0)

/** Valor de um cookie do cabeçalho `Cookie` da requisição, ou `undefined`. */
export function lerCookie(req: Request, nome: string): string | undefined {
  for (const parte of (req.headers.get('cookie') ?? '').split(';')) {
    const i = parte.indexOf('=')
    if (i < 0 || parte.slice(0, i).trim() !== nome) continue
    const bruto = parte.slice(i + 1).trim()
    try { return decodeURIComponent(bruto) || undefined } catch { return undefined }
  }
  return undefined
}
