import type { NextConfig } from 'next'
import { lerTetoDaZona } from './lib/configuracao'

const config: NextConfig = {
  poweredByHeader: false, // 06-seguranca.md: fingerprinting de framework
  experimental: {
    // Caminho rápido das zonas (RSC, Server Action, estático; ADR-0015): o `proxy.ts` reescreve para a origem do mapa e
    // o Next repassa. Zona que passa o teto sem mandar nenhum byte solta a requisição com o 500 cru do Next (D7). O
    // documento não passa por aqui: vai ao gateway interno, que responde a página da base no teto. Lido em todo `next start`.
    proxyTimeout: lerTetoDaZona(),
  },
  // O `proxy.ts` decide o caminho pela requisição como veio (ADR-0015, decisão 1). Sem esta opção o Next tira do
  // `proxy.ts` os cabeçalhos de voo (`RSC`, `Next-Router-State-Tree`, prefetch) e o `?_rsc` da URL: a busca de RSC
  // pareceria documento e iria ao gateway, nunca ao caminho rápido (conferido em `next/dist/server/web/adapter.js`).
  skipProxyUrlNormalize: true,
  // Sem `rewrites()`: seriam congelados no build. Quem é cada zona e onde ela está vem do mapa vivo (lib/mapa-zonas.ts).
}

export default config
