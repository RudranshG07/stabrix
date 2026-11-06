'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { RequireDeployment, useMaybeStabrix, useSentinel, useStabrix } from '@/lib/stabrix'
import { AccountMenu } from './account-menu'
import { ThemeToggle } from './theme-toggle'

const NAV = [
  { href: '/swap', label: 'Swap' },
  { href: '/liquidity', label: 'Liquidity' },
  { href: '/lab', label: 'Depeg Lab' },
]

function NetworkPill() {
  const { chain } = useStabrix()
  const sentinel = useSentinel()
  const halted = sentinel.data?.filter((s) => s.halted).length ?? 0
  return (
    <div className="hidden min-h-9 items-center gap-2 rounded-full bg-surface px-3.5 font-mono text-[11px] lg:flex">
      <span className={`size-2 rounded-full ${halted ? 'bg-down' : 'bg-up'}`} aria-hidden />
      <span className="text-muted">{chain.name.toUpperCase()}</span>
      <span>{halted ? `${halted} HALTED` : 'PEGS LIVE'}</span>
    </div>
  )
}

function Nav({ path, className }: { path: string; className: string }) {
  return (
    <nav aria-label="Primary" className={`items-center gap-1 ${className}`}>
      {NAV.map((n) => {
        const active = path.startsWith(n.href)
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            className={`min-h-9 rounded-full px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              active ? 'bg-ink text-paper' : 'text-muted hover:text-ink'
            }`}
          >
            {n.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname()
  const ctx = useMaybeStabrix()
  const landing = path === '/' || path === '/classic'
  if (landing) return <>{children}</>
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-surface-line bg-paper/85 backdrop-blur">
        <div className={`mx-auto flex h-16 items-center gap-4 px-4 sm:gap-6 sm:px-6 ${landing ? 'max-w-[88rem]' : 'max-w-6xl'}`}>
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Stabrix home">
            <span className="grid size-7 place-items-center rounded-full bg-accent" aria-hidden>
              <span className="size-2.5 rounded-full border-2 border-on-accent" />
            </span>
            <span className="title text-lg">Stabrix</span>
          </Link>
          <Nav path={path} className="hidden md:flex" />
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            {landing || !ctx ? (
              <Link
                href="/swap"
                className="inline-flex min-h-10 items-center rounded-full bg-accent px-5 text-sm font-semibold whitespace-nowrap text-on-accent transition-colors hover:bg-accent-hover"
              >
                Launch app
              </Link>
            ) : (
              <>
                <NetworkPill />
                <AccountMenu />
              </>
            )}
          </div>
        </div>
        <Nav path={path} className="flex border-t border-surface-line px-3 py-2 md:hidden" />
      </header>
      {landing ? (
        <main>{children}</main>
      ) : (
        <main className="mx-auto max-w-6xl px-4 pt-12 pb-24 sm:px-6">
          <RequireDeployment>{children}</RequireDeployment>
        </main>
      )}
      <footer className="border-t border-dashed border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 sm:px-6">
          <span className="caption min-w-0">// orbital ranges on 1inch aqua + swapvm · depeg sentinel on chainlink cre</span>
          <span className="caption">base</span>
        </div>
      </footer>
    </>
  )
}
