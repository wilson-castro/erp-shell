export const TITULO_ERRO_ZONA = 'Zona temporariamente indisponível'
export const MENSAGEM_ERRO_ZONA = 'Não foi possível conectar a esta zona no momento. O processo da zona pode estar inativo ou reiniciando.'
export const DICA_RETRY = 'Tente novamente em alguns instantes.'

export function renderizarPaginaErroDeZona(idZona?: string): string {
  const nomeZona = idZona ? `Zona "${idZona}"` : 'Zona'
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${TITULO_ERRO_ZONA}</title>
<style>
  :root {
    --bg-color: #030712;
    --card-bg: #111827;
    --text-color: #f9fafb;
    --text-muted: #9ca3af;
    --border-color: #1f2937;
    --accent: #38bdf8;
    --danger: #ef4444;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background-color: var(--bg-color);
    color: var(--text-color);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }
  .card {
    max-width: 32rem;
    width: 100%;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 2rem;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: var(--danger);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    margin-bottom: 1rem;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger);
  }
  h1 { font-size: 1.4rem; color: var(--accent); margin-bottom: 0.75rem; }
  p { color: var(--text-muted); line-height: 1.5; margin-bottom: 0.75rem; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<main>
  <div class="card">
    <div class="badge"><span class="dot"></span>${nomeZona} Offline</div>
    <h1>${TITULO_ERRO_ZONA}</h1>
    <p>${MENSAGEM_ERRO_ZONA}</p>
    <p>${DICA_RETRY}</p>
    <p><a href="/">Voltar ao início</a></p>
  </div>
</main>
</body>
</html>`
}
