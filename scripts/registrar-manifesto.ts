// Registra o manifesto desta aplicação no domínio de gestão de acesso. Passo de deploy,
// não de runtime: roda antes de a aplicação receber tráfego, e de novo a cada versão.
import manifesto from '../acesso.manifesto.ts'

const url = process.env.ACESSO_URL ?? 'http://127.0.0.1:4010'
// Token de serviço de desenvolvimento. O domínio só aceita o manifesto cuja zona é a do token.
const token = process.env.ERP_TOKEN_SERVICO ?? 'svc.shell'

const r = await fetch(`${url}/v1/manifestos`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(manifesto),
})
if (r.status !== 204) {
  console.error(`registro do manifesto de ${manifesto.zona} falhou: HTTP ${r.status}`)
  process.exit(1)
}
console.log(`manifesto de ${manifesto.zona} registrado`)
