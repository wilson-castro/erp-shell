import 'server-only'
import { formularioDoLogout, politicaDeSeguranca } from '@erp/nucleo/proxy'

/**
 * CSP do shell (ADR-0012), com a origem do IdP em `form-action` quando há OIDC (ADR-0013, decisão 6):
 * o "Sair" da moldura é um POST e `/api/auth/sair` responde 303 para o logout do IdP. Emissor
 * inválido falha na subida.
 */
export function criarCspDoShell(emissor: string | undefined): (nonce: string) => string {
  const formularioPara = formularioDoLogout(emissor)
  return (nonce) => politicaDeSeguranca(nonce, { formularioPara })
}

export const cspDoShell = criarCspDoShell(process.env.IDP_EMISSOR)
