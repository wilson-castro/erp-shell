import type { NextConfig } from 'next'
import { ZONAS } from './lib/zonas'

const config: NextConfig = {
  poweredByHeader: false,   // 06-seguranca.md: fingerprinting de framework
  async rewrites() {
    // Gerados do mapa de zonas. Cada zona serve páginas sob /<id> e assets sob /<id>-static
    // (limitação 5: duas zonas em /_next colidiriam). /api/auth/* nunca é delegado.
    return ZONAS.flatMap(({ id, origem }) => [
      { source: `/${id}`, destination: `${origem}/${id}` },
      { source: `/${id}/:caminho*`, destination: `${origem}/${id}/:caminho*` },
      { source: `/${id}-static/:caminho*`, destination: `${origem}/${id}-static/:caminho*` },
    ])
  },
}

export default config
