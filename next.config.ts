import type { NextConfig } from 'next'
import { lerTetoDaZona } from './lib/configuracao'
import { gerarRewrites } from './lib/zonas'

const config: NextConfig = {
  poweredByHeader: false, // 06-seguranca.md: fingerprinting de framework
  experimental: {
    // D7: zona que passa o teto sem mandar nenhum byte solta a requisição. Quem responde é o Next (500 cru), sem gancho
    // para a página da base; a página dentro do teto vem com o C3. Lido em todo `next start`.
    proxyTimeout: lerTetoDaZona(),
  },
  async rewrites() {
    // Rewrites gerados a partir do mapa central de zonas.
    // Rotas reservadas do shell (/api/auth, /api/otel, /login, /erro-de-zona, /) não são sobrescritas.
    return gerarRewrites()
  },
}

export default config
