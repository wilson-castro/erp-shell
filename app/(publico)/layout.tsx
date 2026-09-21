import '@erp/moldura/estilo.css'
import type { ReactNode } from 'react'

export const metadata = { title: 'ERP — entrar' }

export default function LayoutPublico({ children }: { children: ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>
}
