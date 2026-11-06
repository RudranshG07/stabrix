import type { Metadata } from 'next'
import { EB_Garamond, Goudy_Bookletter_1911, JetBrains_Mono, Josefin_Sans, Open_Sans } from 'next/font/google'
import type { ReactNode } from 'react'
import { AppShell } from '@/components/app-shell'
import { StabrixProvider } from '@/lib/stabrix'
import { THEME_BOOT } from '@/lib/theme-boot'
import './globals.css'

const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' })
const goudy = Goudy_Bookletter_1911({ subsets: ['latin'], weight: '400', variable: '--font-goudy', display: 'swap' })
const garamond = EB_Garamond({ subsets: ['latin'], weight: ['400', '500'], style: ['normal', 'italic'], variable: '--font-garamond', display: 'swap' })
const open = Open_Sans({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--font-open', display: 'swap' })
const josefin = Josefin_Sans({ subsets: ['latin'], weight: '600', variable: '--font-josefin', display: 'swap' })

export const metadata: Metadata = {
  title: 'Stabrix',
  description:
    'Liquidity that never leaves. One wallet balance makes FX markets on 1inch Aqua and backs every stablecoin when one breaks, guarded by Chainlink.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const fonts = [mono, goudy, garamond, open, josefin].map((f) => f.variable).join(' ')
  return (
    <html lang="en" className={fonts} suppressHydrationWarning>
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
