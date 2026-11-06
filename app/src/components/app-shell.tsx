'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { RequireDeployment, useMaybeStabrix, useOracleStatus, useStabrix } from '@/lib/stabrix'
import { DEV_ACCOUNTS } from '@/lib/config'
import { AccountMenu } from './account-menu'
import { ThemeToggle } from './theme-toggle'

const NAV = [
  { href: '/swap', label: 'Swap' },
  { href: '/liquidity', label: 'Liquidity' },
  { href: '/pool', label: 'Pool' },
  { href: '/activity', label: 'Activity' },
  { href: '/lab', label: 'Depeg' },
  { href: '/docs', label: 'Docs' },
]

export function AnchorMark({ className = 'h-[26px] w-[22px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 26 30" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className={className} aria-hidden>
      <circle cx="13" cy="4.5" r="2.8" />
      <path d="M13 7.5V28M7 12h12M2.5 19c.6 5.5 5.5 9 10.5 9s9.9-3.5 10.5-9" />
      <path d="m1 21 1.5-2.5L5 20.5M25 21l-1.5-2.5-2.5 2" />
    </svg>
  )
}

function NetworkPill() {
  const { chain } = useStabrix()
  const oracle = useOracleStatus()
  const halted = oracle.data?.filter((s) => s.halted).length ?? 0
  return (
    <div className="hidden min-h-10 items-center gap-2 rounded-full border-2 border-surface-line bg-surface px-3.5 text-[10.5px] font-bold tracking-[0.12em] uppercase lg:flex">
      <span className={`size-2 rounded-full ${halted ? 'bg-down' : 'bg-up'}`} aria-hidden />
      <span className="text-muted">{chain.name}</span>
      <span>{halted ? `${halted} halted` : 'Pegs live'}</span>
    </div>
  )
}

function Nav({ path, className }: { path: string; className: string }) {
  return (
    <nav aria-label="Primary" className={`items-center ${className}`}>
      {NAV.filter((n) => DEV_ACCOUNTS || n.href !== '/lab').map((n) => {
        const active = path.startsWith(n.href)
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            className={`relative py-2 text-[12px] font-bold tracking-[0.1em] whitespace-nowrap uppercase sm:tracking-[0.17em] transition-opacity ${
              active ? 'opacity-100' : 'opacity-60 hover:opacity-100'
            }`}
          >
            {n.label}
            {active && <span className="absolute -bottom-0.5 left-0 h-[3px] w-full rounded-full bg-ink" aria-hidden />}
          </Link>
        )
      })}
    </nav>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname()
  const ctx = useMaybeStabrix()
  if (path === '/') return <>{children}</>
  return (
    <>
      <header className="sticky top-0 z-20 border-b-[3px] border-surface-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center gap-8 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Stabrix home">
            <AnchorMark />
            <span className="font-display text-[27px] tracking-[-0.03em]">Stabrix</span>
          </Link>
          <Nav path={path} className="hidden gap-7 lg:flex" />
          <div className="ml-auto flex items-center gap-3">
            {ctx && <NetworkPill />}
            <ThemeToggle className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-surface-line bg-surface transition-colors hover:bg-surface-hover [&>svg]:size-4" />
            {ctx && <AccountMenu />}
          </div>
        </div>
        <Nav path={path} className="flex gap-3 overflow-x-auto border-t-2 border-dashed border-line px-2.5 py-1.5 sm:justify-center sm:gap-7 lg:hidden" />
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-12 pb-24 sm:px-6">
        {path === '/docs' ? children : <RequireDeployment>{children}</RequireDeployment>}
      </main>
      <footer className="border-t-[3px] border-surface-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-[10.5px] font-bold tracking-[0.14em] uppercase sm:px-6">
          <span>Stabrix · liquidity that never leaves</span>
          <span className="text-muted">1inch Aqua + SwapVM · Chainlink CRE · Base</span>
        </div>
      </footer>
    </>
  )
}
