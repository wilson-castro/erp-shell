import { NextResponse, type NextRequest } from 'next/server'
import { nucleo, NOME_COOKIE_SESSAO } from '@/lib/nucleo'
import { destinoInterno } from '@/lib/destino-interno'

/** Location relativo: a URL absoluta de `req.url` pode ser a origem interna do processo. */
const irPara = (destino: string) => new NextResponse(null, { status: 303, headers: { Location: destino } })

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const id = await nucleo.sessao.entrar({ usuario: form.get('usuario') })
  if (!id) return irPara('/login')

  const res = irPara(destinoInterno(form.get('de')))
  // O navegador guarda só o id opaco. `__Host-` exige Secure e Path=/ e proíbe Domain.
  res.cookies.set(NOME_COOKIE_SESSAO, id, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
  return res
}
