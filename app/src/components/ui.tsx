'use client'

import type { TokenInfo } from '@stabrix/sdk'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { COIN_HEX, COIN_TONES } from '@/lib/coins'

export { COIN_HEX, COIN_TONES }

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[var(--radius-card)] border border-surface-line bg-surface ${className}`}>{children}</section>
}

export function Label({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} className="label">
      <span className="size-2 shrink-0 border-[1.5px] border-current" aria-hidden />
      {children}
    </p>
  )
}

export function SectionHead({ index, title, aside }: { index: string; title: string; aside?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="caption">// {index}</p>
        <h1 className="title mt-3 text-4xl leading-none sm:text-5xl">{title}</h1>
      </div>
      {aside}
    </header>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'up' | 'down' | 'accent' }) {
  const color = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : tone === 'accent' ? 'text-accent-text' : 'text-ink'
  return (
    <div className="min-w-0">
      <p className="caption">{label}</p>
      <p className={`num mt-1 truncate font-mono text-lg ${color}`}>{value}</p>
    </div>
  )
}

export function Button({
  busy,
  children,
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-accent text-on-accent hover:bg-accent-hover disabled:bg-surface-hover disabled:text-muted',
    ghost: 'text-ink shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-surface-hover disabled:text-muted',
    danger: 'bg-down text-tone-ink hover:brightness-110 disabled:bg-surface-hover disabled:text-muted',
  }[variant]
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function Pill({
  active,
  children,
  onClick,
  role = 'radio',
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
  role?: 'radio' | 'button'
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'radio' ? active : undefined}
      aria-pressed={role === 'button' ? active : undefined}
      onClick={onClick}
      className={`num min-h-9 rounded-full px-4 font-mono text-xs font-medium transition-colors ${
        active ? 'bg-ink text-paper' : 'bg-surface-hover text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

export function TokenSelect({
  id,
  tokens,
  value,
  onChange,
  label,
}: {
  id: string
  tokens: TokenInfo[]
  value: string
  onChange: (address: string) => void
  label: string
}) {
  const symbol = tokens.find((t) => t.address === value)?.symbol ?? ''
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span className={`pointer-events-none absolute top-1/2 left-3 size-3 -translate-y-1/2 rounded-full ${COIN_TONES[symbol] ?? 'bg-muted'}`} aria-hidden />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 cursor-pointer appearance-none rounded-full bg-surface-hover pr-9 pl-8 text-sm font-semibold transition-colors hover:bg-line"
      >
        {tokens.map((t) => (
          <option key={t.address} value={t.address}>
            {t.symbol}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-xs text-muted" aria-hidden>
        ▾
      </span>
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-hover ${className}`} aria-hidden />
}

export function Tag({ children, dot }: { children: ReactNode; dot?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-hover px-2.5 py-1 text-[11px] font-medium tracking-[0.03em]">
      {dot && <span className="size-2 rounded-full" style={{ background: dot }} aria-hidden />}
      {children}
    </span>
  )
}

export function VenueTag({ kind }: { kind: 'native' | 'official' }) {
  return kind === 'official' ? <Tag dot="var(--color-series-lime)">1inch SwapVM</Tag> : <Tag dot="var(--color-violet)">Stabrix router</Tag>
}

export function StatusTag({ halted }: { halted: boolean }) {
  return halted ? <Tag dot="var(--color-down)">Halted</Tag> : <Tag dot="var(--color-up)">Live</Tag>
}
