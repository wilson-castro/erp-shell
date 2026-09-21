import mapa from '../zonas.json' with { type: 'json' }

/**
 * Mapa de zonas: id da zona -> origem. O prefixo de rota é sempre `/<id>` — o manifesto
 * da zona só é aceito pelo domínio de gestão de acesso se os módulos dele viverem sob esse
 * prefixo, então rewrites, menu e manifesto não divergem. A origem pode ser trocada por
 * ambiente: ZONA_<ID>_URL (ex.: ZONA_ZONA1_URL).
 */
export const ZONAS: ReadonlyArray<{ id: string; origem: string }> = Object.entries(mapa).map(([id, origem]) => ({
  id,
  origem: process.env[`ZONA_${id.toUpperCase().replaceAll('-', '_')}_URL`] ?? origem,
}))

/** Prefixos que pertencem a outra aplicação: o proxy do shell não opina sobre eles. */
export const PREFIXOS_DE_ZONA: readonly string[] = ZONAS.flatMap(({ id }) => [`/${id}`, `/${id}-static`])
