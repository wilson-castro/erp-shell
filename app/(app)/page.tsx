import { nucleo } from '@/lib/nucleo'
import { modulosPermitidos, sessaoDaPagina } from '@/lib/pagina'

type Aviso = { id: string; texto: string }

/**
 * Início do shell. Não é módulo: toda sessão válida a vê. Continua fail-closed pela consulta ao
 * acesso efetivo: com a gestão de acesso fora, `modulosPermitidos()` lança (D4).
 */
export default async function Inicio() {
  const sessao = await sessaoDaPagina()
  const [modulos, avisos] = await Promise.all([
    modulosPermitidos(),
    // avisos são acessórios: domínio da plataforma fora apaga o bloco, não a página
    nucleo.destino('plataforma').get<Aviso[]>('/v1/avisos').then((r) => r.body ?? [], () => null),
  ])
  return (
    <>
      <h1>Olá, {sessao.nome}</h1>
      <section aria-labelledby="avisos">
        <h2 id="avisos">Avisos da plataforma</h2>
        {avisos ? <ul>{avisos.map((a) => <li key={a.id}>{a.texto}</li>)}</ul> : <p>Avisos indisponíveis no momento.</p>}
      </section>
      <section aria-labelledby="modulos">
        <h2 id="modulos">Seus módulos</h2>
        <ul>
          {modulos.map((m) => <li key={m.id}><a href={m.prefixo}>{m.rotulo}</a></li>)}
        </ul>
      </section>
    </>
  )
}
