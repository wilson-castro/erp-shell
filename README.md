# erp-shell

O **shell**: a única porta de entrada do navegador. Faz o login, é o **único escritor da sessão**, repassa cada prefixo de zona por rewrite, responde 503 quando uma zona cai e recebe a telemetria das zonas.

| | |
|---|---|
| Porta | `3000` (acessada pelo navegador **só via shell**, `http://localhost:3000`) |
| Rotas | `/`, `/login`, `/api/auth/entrar`, `/api/auth/sair`, `/api/otel/v1/traces`, `/erro-de-zona`; e os prefixos das zonas (`zonas.json`) |
| Chama | domínio `plataforma` (`:4004`) e `gestao-acesso` (`:4010`) — declarados em `lib/nucleo.ts` (registro de destinos) |
| Depende de | `@erp/nucleo`, `@erp/moldura`, `@erp/contratos` (Verdaccio local `:4873`) |

## Onde fica cada coisa

| Arquivo | Para quê |
|---|---|
| `app/` | páginas e Server Actions desta aplicação |
| `lib/nucleo.ts` | instância do núcleo: sessão, destinos permitidos, gestão de acesso |
| `lib/pagina.ts` | sessão da página, `exigirModulo`, moldura, envelope de Server Action |
| `acesso.manifesto.ts` | módulos, perfis e concessões desta aplicação (`pnpm registrar` envia) |
| `proxy.ts` | camada 1: cookie de sessão e CSP |
| `zonas.json` | mapa das zonas: id → origem. Rewrites, sonda de saúde e 503 saem daqui |
| `lib/decisao-proxy.ts` | o que o proxy decide, em ordem (função pura, testada) |
| `test/` | `pnpm test`: decisão do proxy, sonda, mapa de zonas, telemetria |

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
