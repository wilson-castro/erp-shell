import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Zona Indisponível — ERP',
}

export default async function PaginaErroDeZona({
  searchParams,
}: {
  searchParams: Promise<{ zona?: string }>
}) {
  const { zona } = await searchParams
  return (
    <main className="moldura-conteudo">
      <div style={{ padding: '2rem', maxWidth: '32rem' }}>
        <h1 style={{ color: '#ef4444' }}>Zona temporariamente indisponível</h1>
        {zona && <p><strong>Zona afetada:</strong> {zona}</p>}
        <p>Não foi possível conectar a esta zona no momento.</p>
        <p>Tente novamente em alguns instantes.</p>
        <p style={{ marginTop: '1rem' }}><a href="/">Voltar ao início</a></p>
      </div>
    </main>
  )
}
