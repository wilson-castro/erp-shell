// Mapa de zonas fixo para os testes da decisão do proxy: a fonte devolve sempre a mesma lista e não há
// rede nem Redis. As origens são as da base (zona 1 :3001, zona 2 :3002, acesso :3003).
import { criarMapaDeZonas } from '../lib/mapa-zonas.ts'

export const ZONAS_DA_BASE = [
  { id: 'zona1', origem: 'http://127.0.0.1:3001' },
  { id: 'zona2', origem: 'http://127.0.0.1:3002' },
  { id: 'acesso', origem: 'http://127.0.0.1:3003' },
]

export const mapaFixo = (zonas = ZONAS_DA_BASE) => criarMapaDeZonas({
  fonte: async () => zonas, ttlMs: 60_000, origensPermitidas: ['127.0.0.1:*', 'localhost:*'],
})

/** A requisição seguiu (página do shell ou zona, pelo gateway ou pelo caminho rápido). */
export const segue = (d) => ['prosseguir', 'zona-documento', 'zona-rapida'].includes(d.acao)
