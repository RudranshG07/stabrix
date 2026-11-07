'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { RequireDeployment, useMaybeStabrix, useNetwork, useOracleStatus, useStabrix } from '@/lib/stabrix'
import { DEV_ACCOUNTS, NETWORK_LABELS } from '@/lib/config'
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
    <div className="hidden min-h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[12.5px] lg:flex">
      <span className={`size-2 rounded-full ${halted ? 'bg-down' : 'bg-up'}`} aria-hidden />
      <span className="text-muted">{chain.name}</span>
      <span>{halted ? `${halted} halted` : 'Pegs live'}</span>
    </div>
  )
}

function NetworkSwitch({ className = '' }: { className?: string }) {
  const { current, available, select } = useNetwork()
  if (available.length < 2) return null
  return (
    <div role="radiogroup" aria-label="Network" className={`${className} min-h-9 shrink-0 items-center rounded-lg border border-line bg-surface p-0.5 text-[12.5px]`}>
      {available.map((n) => {
        const on = n === current
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => !on && select(n)}
            className={`rounded-md px-2.5 py-1.5 transition-colors ${on ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}
          >
            {NETWORK_LABELS[n] ?? n}
          </button>
        )
      })}
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
            className={`py-2 text-[14px] whitespace-nowrap transition-colors ${active ? 'text-ink' : 'text-muted hover:text-ink'}`}
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
  if (path === '/') return <>{children}</>
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Stabrix home">
            <AnchorMark className="h-[21px] w-[18px]" />
            <span className="text-[18px] font-semibold tracking-[-0.02em]">Stabrix</span>
          </Link>
          <Nav path={path} className="hidden gap-7 lg:flex" />
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <NetworkSwitch className="hidden sm:flex" />
            {ctx && <NetworkPill />}
            <ThemeToggle className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-surface transition-colors hover:bg-surface-hover [&>svg]:size-4" />
            {ctx && <AccountMenu />}
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-1 lg:hidden">
          <Nav path={path} className="flex min-w-0 flex-1 gap-4 overflow-x-auto sm:justify-center sm:gap-7" />
          <NetworkSwitch className="flex sm:hidden" />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-10 pb-24 sm:px-6">
        {path === '/docs' ? children : <RequireDeployment>{children}</RequireDeployment>}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 font-mono text-[10.5px] tracking-[0.06em] uppercase sm:px-6">
          <span>Stabrix · liquidity that never leaves</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted">
            <span className="flex items-center gap-1.5">
              <Image src="/brand/1inch.png" alt="" width={32} height={32} className="size-4 rounded-full" />
              1inch Aqua + SwapVM
            </span>
            <span className="flex items-center gap-1.5">
              <Image src="/brand/chainlink.png" alt="" width={32} height={32} className="size-4 rounded-full" />
              Chainlink CRE
            </span>
            <span>Base</span>
          </span>
        </div>
      </footer>
    </>
  )
}
