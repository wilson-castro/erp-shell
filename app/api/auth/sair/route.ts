import { NextResponse, type NextRequest } from 'next/server'
import { nucleo, NOME_COOKIE_SESSAO } from '@/lib/nucleo'

/** Remove do store: a sessão acaba em todas as zonas na próxima requisição, não só no shell. */
export async function POST(req: NextRequest) {
  const id = req.cookies.get(NOME_COOKIE_SESSAO)?.value
  if (id) await nucleo.sessao.encerrar(id)
  const res = new NextResponse(null, { status: 303, headers: { Location: '/login' } })
  res.cookies.set(NOME_COOKIE_SESSAO, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
