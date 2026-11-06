import type { Metadata } from 'next'
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google'
import type { ReactNode } from 'react'
import { AppShell } from '@/components/app-shell'
import { THEME_BOOT } from '@/components/theme-toggle'
import { StabrixProvider } from '@/lib/stabrix'
import './globals.css'

const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-grotesk', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' })

export const metadata: Metadata = {
  title: 'Stabrix',
  description: 'Multi-stablecoin Orbital ranges on 1inch Aqua. LP funds stay in the wallet; depegs cannot drain them.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${grotesk.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh">
        <StabrixProvider>
          <AppShell>{children}</AppShell>
        </StabrixProvider>
      </body>
    </html>
  )
}
