import '@erp/moldura/estilo.css'
import type { ReactNode } from 'react'
import { Moldura } from '@erp/moldura'
import { dadosDaMoldura } from '@/lib/pagina'

export const metadata = { title: 'ERP' }

export default async function LayoutDoShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body><Moldura {...await dadosDaMoldura()}>{children}</Moldura></body>
    </html>
  )
}
