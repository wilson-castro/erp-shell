import type { MapaDeZonas } from './mapa-zonas.ts'

// Só tipo: a instância do mapa vivo compartilhada no processo (lib/mapa-zonas.ts, `instancia()`).
declare global {
  var __erpMapaDeZonas: MapaDeZonas | undefined
}

export {}
