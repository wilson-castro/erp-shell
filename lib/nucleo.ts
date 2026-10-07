import 'server-only'
import { cookies, headers } from 'next/headers'
import { acessoHttp, sessaoArquivo, sessaoRedis } from '@erp/nucleo'
// Só o shell importa este subpath (invariante 15); a verificação estática de base/verificacao reprova o import numa zona.
import {
  criarNucleoDoShell, identidadeDev, identidadeOidc, sessaoArquivoDeEscrita, sessaoRedisDeEscrita,
  type ProvedorDeIdentidade,
} from '@erp/nucleo/shell'
import { clienteRedis } from './redis'
import { registrarNoConsole } from './rotas-auth'
import { NOME_COOKIE_SESSAO } from './cookies'
import { lerTokenDeServico } from './configuracao.ts'

export { NOME_COOKIE_SESSAO }

const SESSAO_DIR = process.env.SESSAO_DIR ?? '/tmp/erp-sessoes'

/** Sem `IDP_EMISSOR`, login de desenvolvimento (atores fixos, `/login/dev`); com ele, OIDC. */
const emissor = process.env.IDP_EMISSOR
export const loginDeDesenvolvimento = !emissor

/**
 * O provedor de identidade, escolhido pelo ambiente (docs/CONFIGURACAO.md §1). Os padrões das URLs
 * são as do realm do showcase e usam `http://`, que o `identidadeOidc` recusa em produção: fora da
 * máquina local, `IDP_URL_RETORNO` e `IDP_URL_POS_LOGOUT` têm de ser configuradas. O segredo não tem
 * padrão: sem `IDP_CLIENTE_SEGREDO`, a criação falha na subida do shell.
 */
function provedorDeIdentidade(): ProvedorDeIdentidade {
  if (!emissor) return identidadeDev()
  return identidadeOidc({
    emissor,
    clienteId: process.env.IDP_CLIENTE_ID || 'erp-shell',
    clienteSegredo: process.env.IDP_CLIENTE_SEGREDO ?? '',
    urlRetorno: process.env.IDP_URL_RETORNO || 'http://localhost:3000/api/auth/retorno',
    urlPosLogout: process.env.IDP_URL_POS_LOGOUT || 'http://localhost:3000/login',
  })
}

/**
 * Raiz de composição do shell. Só configuração, lida do ambiente. O shell é a ÚNICA
 * aplicação com `criarNucleoDoShell`: grava, renova e encerra sessão; as zonas só leem (N3).
 * `ERP_RENOVACAO_JANELA_S`, `ERP_RENOVACAO_LOCK_S`, `ERP_RENOVACAO_ESPERA_MS`, `ERP_RENOVACAO_ESPERA_PASSO_MS` e
 * `ERP_LOGIN_TRANSACAO_S` são lidas pelo próprio núcleo; a vida do cookie da transação vem de `iniciarLogin`.
 * As falhas que o núcleo registra no servidor saem pelo mesmo registrador das rotas de autenticação.
 */
export const nucleo = criarNucleoDoShell({
  app: 'shell',
  registrarFalha: registrarNoConsole,
  // REDIS_URL definido: Redis (showcase, produção); senão, arquivo de desenvolvimento
  sessao: clienteRedis ? sessaoRedis({ cliente: clienteRedis }) : sessaoArquivo({ dir: SESSAO_DIR }),
  lerCookieDeSessao: async () => (await cookies()).get(NOME_COOKIE_SESSAO)?.value,
  // núcleo 8: o proxy pôs um traceparent na requisição; cada chamada ao domínio leva um filho
  lerTraceparent: async () => (await headers()).get('traceparent') ?? undefined,
  acesso: acessoHttp({ destino: 'gestao-acesso' }),
  // credencial 'servico' do destino `mapa-zonas`: `ERP_TOKEN_SERVICO`, padrão `svc.shell` só fora de produção
  tokenDeServico: () => lerTokenDeServico(),
  destinos: {
    // domínio do próprio shell (N7)
    plataforma: {
      origem: process.env.DOMINIO_PLATAFORMA_URL ?? 'http://127.0.0.1:4004',
      caminhos: ['/v1/avisos'], metodos: ['GET'], credencial: 'usuario', timeoutMs: 2000,
    },
    // gestão de acesso v2 (ADR-0014, adendo 1): só o acesso efetivo de quem está logado
    'gestao-acesso': {
      origem: process.env.ACESSO_URL ?? 'http://127.0.0.1:4020',
      caminhos: ['/v2/eu'], metodos: ['GET'], credencial: 'usuario', timeoutMs: 1000,
    },
    // mapa vivo de zonas (ADR-0015): a gestão de acesso só responde a este token de serviço
    'mapa-zonas': {
      origem: process.env.ACESSO_URL ?? 'http://127.0.0.1:4020',
      caminhos: ['/v2/zonas'], metodos: ['GET'], credencial: 'servico', timeoutMs: 2000,
    },
    // Coletor OTLP: só existe se configurado. O gateway /api/otel repassa por aqui, não por
    // `fetch` direto, para o repasse ter allowlist, timeout e nenhum redirecionamento (N8).
    ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? {
          'coletor-otel': {
            origem: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
            caminhos: ['/v1/traces'], metodos: ['POST'] as const, credencial: 'nenhuma' as const, timeoutMs: 3000,
          },
        }
      : {}),
  },
  escrita: {
    store: clienteRedis ? sessaoRedisDeEscrita({ cliente: clienteRedis }) : sessaoArquivoDeEscrita({ dir: SESSAO_DIR }),
    identidade: provedorDeIdentidade(),
  },
})
