/**
 * Só caminho interno: `/x`, nunca `//x`, `/\x` ou URL absoluta. Um redirecionamento
 * aberto depois do login é o jeito clássico de levar o usuário a uma página falsa.
 */
export function destinoInterno(de: unknown): string {
  if (typeof de !== 'string' || !de.startsWith('/') || de.startsWith('//') || de.startsWith('/\\')) return '/'
  if (/[\u0000-\u001f\u007f]/.test(de)) return '/'
  return de
}
