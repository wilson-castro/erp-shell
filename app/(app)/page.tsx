import { nucleo } from '@/lib/nucleo'
import { exigirModulo, modulosPermitidos, sessaoDaPagina } from '@/lib/pagina'

type Aviso = { id: string; texto: string }

export default async function Inicio() {
  await exigirModulo('shell.inicio')
  const sessao = await sessaoDaPagina()
  const [modulos, avisos] = await Promise.all([
    modulosPermitidos(),
    nucleo.destino('plataforma').get<Aviso[]>('/v1/avisos').then((r) => r.body ?? []),
  ])
  return (
    <>
      <h1>Olá, {sessao.nome}</h1>
      <section aria-labelledby="avisos">
        <h2 id="avisos">Avisos da plataforma</h2>
        <ul>{avisos.map((a) => <li key={a.id}>{a.texto}</li>)}</ul>
      </section>
      <section aria-labelledby="modulos">
        <h2 id="modulos">Seus módulos</h2>
        <ul>
          {modulos.filter((m) => m.id !== 'shell.inicio').map((m) => (
            <li key={m.id}><a href={m.prefixo}>{m.rotulo}</a> <small>({m.zona})</small></li>
          ))}
        </ul>
      </section>
    </>
  )
}
