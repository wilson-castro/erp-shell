import type { NextConfig } from 'next'
import { gerarRewrites } from './lib/zonas'

const config: NextConfig = {
  poweredByHeader: false, // 06-seguranca.md: fingerprinting de framework
  async rewrites() {
    // Rewrites gerados a partir do mapa central de zonas.
    // Rotas reservadas do shell (/api/auth, /api/otel, /login, /erro-de-zona, /) não são sobrescritas.
    return gerarRewrites()
  },
}

export default config
