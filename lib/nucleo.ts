import 'server-only'
import { cookies, headers } from 'next/headers'
import { acessoHttp, sessaoArquivo, sessaoRedis } from '@erp/nucleo'
// Só o shell importa este subpath (invariante 15); a verificação estática de base/verificacao reprova o import numa zona.
import { criarNucleoDoShell, identidadeDev, sessaoArquivoDeEscrita, sessaoRedisDeEscrita } from '@erp/nucleo/shell'
import { clienteRedis } from './redis'

const SESSAO_DIR = process.env.SESSAO_DIR ?? '/tmp/erp-sessoes'
export const NOME_COOKIE_SESSAO = '__Host-session'

/**
 * Raiz de composição do shell. Só configuração, lida do ambiente. O shell é a ÚNICA
 * aplicação com `criarNucleoDoShell`: grava e encerra sessão; as zonas só leem (N3).
 */
export const nucleo = criarNucleoDoShell({
  app: 'shell',
  // REDIS_URL definido: Redis (showcase, produção); senão, arquivo de desenvolvimento
  sessao: clienteRedis ? sessaoRedis({ cliente: clienteRedis }) : sessaoArquivo({ dir: SESSAO_DIR }),
  lerCookieDeSessao: async () => (await cookies()).get(NOME_COOKIE_SESSAO)?.value,
  // núcleo 8: o proxy pôs um traceparent na requisição; cada chamada ao domínio leva um filho
  lerTraceparent: async () => (await headers()).get('traceparent') ?? undefined,
  acesso: acessoHttp({ destino: 'gestao-acesso' }),
  destinos: {
    // domínio do próprio shell (N7)
    plataforma: {
      origem: process.env.DOMINIO_PLATAFORMA_URL ?? 'http://127.0.0.1:4004',
      caminhos: ['/v1/avisos'], metodos: ['GET'], credencial: 'usuario', timeoutMs: 2000,
    },
    'gestao-acesso': {
      origem: process.env.ACESSO_URL ?? 'http://127.0.0.1:4010',
      caminhos: ['/v1/modulos-permitidos', '/v2/eu'], metodos: ['GET'], credencial: 'usuario', timeoutMs: 1000,
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
    identidade: identidadeDev(),
  },
})
