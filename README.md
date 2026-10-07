# erp-shell

O **shell**: a única porta de entrada do navegador. Faz o login (OIDC com PKCE, ou o de desenvolvimento sem `IDP_EMISSOR`), é o **único escritor da sessão** (inclusive a renovação proativa do token, no proxy), roteia cada prefixo de zona pelo mapa vivo (documento pelo gateway interno, o resto pelo rewrite do proxy), responde 503 com a página da base quando uma zona cai ou trava e recebe a telemetria das zonas.

| | |
|---|---|
| Porta | `3000` (acessada pelo navegador **só via shell**, `http://localhost:3000`) |
| Rotas | `/`, `/login`, `/login/dev` (só sem `IDP_EMISSOR`), `GET /api/auth/entrar`, `GET /api/auth/retorno`, `POST /api/auth/sair`, `/api/otel/v1/traces`, `/erro-de-zona`; e os prefixos das zonas (mapa vivo, `GET /v2/zonas` da gestão de acesso); `/_gateway` é interna (404 do navegador) |
| Chama | domínio `plataforma` (`:4004`) e `gestao-acesso` (`:4010`) — declarados em `lib/nucleo.ts` (registro de destinos) |
| Depende de | `@erp/nucleo`, `@erp/moldura`, `@erp/contratos` (Verdaccio local `:4873`); `openid-client` (peer do `@erp/nucleo/shell`, usado só dentro do núcleo) |

## Responsabilidades

O que esta parte faz, o que nunca faz e o vocabulário usado aqui (BFF, zona, Server Action…), explicados
do zero: [`docs/RESPONSABILIDADES.md`](https://github.com/ArtroxGabriel/nextjs-mfe/blob/bff-multizone/docs/RESPONSABILIDADES.md)
no repositório principal, seção 4.1.

## Onde fica cada coisa

| Arquivo | Para quê |
|---|---|
| `app/` | páginas e Server Actions desta aplicação |
| `lib/nucleo.ts` | instância do núcleo: sessão, provedor de identidade (OIDC ou dev), destinos permitidos, gestão de acesso |
| `lib/rotas-auth.ts` | entrar, retorno e sair (ADR-0013): transação em `__Host-erp-login`, sessão em `__Host-session`, erro como `{ codigo, supportId }` |
| `lib/cookies.ts` | nomes e atributos dos cookies `__Host-` do shell |
| `lib/pagina.ts` | liga ao Next o kit do núcleo (`criarPaginas`: sessão, `exigirModulo`, `acaoProtegida`) e da moldura (menu, toast); igual nas quatro apps |
| `lib/redis.ts` | cliente do store de sessão, usado só se `REDIS_URL` estiver definido (senão, arquivo) |
| `acesso.manifesto.ts` | módulos, perfis e concessões desta aplicação (`pnpm registrar` envia) |
| `proxy.ts` | camada 1: cookie de sessão, renovação proativa (`nucleo.sessao.renovarSessao`) e CSP |
| `lib/mapa-zonas.ts` | mapa vivo das zonas (ADR-0015): id → origem, lido da gestão de acesso com `svc.shell`, validado, com TTL e último mapa bom em memória e no Redis |
| `lib/gateway-zona.ts`, `app/%5Fgateway/` | gateway de documento: repassa a navegação à zona com `node:http` e, no teto, responde a página da base com `supportId` |
| `lib/zonas.ts` | rotas reservadas e formas de caminho (zona, fragmento, gateway) |
| `instrumentation.ts`, `lib/subida.ts` | confere a configuração na subida do `next start` (não no `next build`); mal configurado, o shell não sobe |
| `lib/decisao-proxy.ts` | o que o proxy decide, em ordem (função pura, testada) |
| `test/` | `pnpm test`: decisão do proxy, renovação concorrente, rotas de autenticação, cliente Redis, sonda, mapa de zonas, telemetria |

## Comandos

```bash
pnpm install
pnpm dev          # desenvolvimento, porta 3000
pnpm typecheck
pnpm test
pnpm registrar    # registra o manifesto na gestão de acesso
```

A base inteira (subir, verificar ponta a ponta) é operada pelo repositório principal `nextjs-mfe`: veja o README de lá.

## Regras

Invariantes do projeto: `AGENTS.md` no repositório principal. Nesta
aplicação, o que mais importa: toda página chama `exigirModulo` e toda Server Action usa
`acaoProtegida`; domínio só por `nucleo.destino(...)`, nunca `fetch` direto.
