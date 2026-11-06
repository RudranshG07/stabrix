'use client'

import type { TokenInfo } from '@stabrix/sdk'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { COIN_HEX, COIN_TONES } from '@/lib/coins'

export { COIN_HEX, COIN_TONES }

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`ink-card ${className}`}>{children}</section>
}

export function Label({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} className="label">
      <span className="size-2 shrink-0 rotate-45 border-2 border-current" aria-hidden />
      {children}
    </p>
  )
}

export function SectionHead({ index, title, aside }: { index: string; title: string; aside?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="num text-[16px] tracking-[0.2em] uppercase">{index}</p>
        <h1 className="title mt-3 text-[44px] leading-[0.95] sm:text-[60px]">{title}</h1>
      </div>
      {aside}
    </header>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'up' | 'down' | 'accent' }) {
  const color = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : tone === 'accent' ? 'text-accent-text' : 'text-ink'
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-bold tracking-[0.14em] text-muted uppercase">{label}</p>
      <p className={`num mt-1.5 truncate text-[22px] leading-none ${color}`}>{value}</p>
    </div>
  )
}

export function Button({
  busy,
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: 'primary' | 'ghost' | 'danger'; size?: 'md' | 'sm' }) {
  const styles = {
    primary: 'bg-ink text-on-accent shadow-[0_6px_0_-1px_var(--color-paper),0_6px_0_2px_var(--color-surface-line)] hover:translate-y-[2px] hover:shadow-[0_4px_0_-1px_var(--color-paper),0_4px_0_2px_var(--color-surface-line)]',
    ghost: 'bg-surface text-ink shadow-[0_6px_0_-1px_var(--color-paper),0_6px_0_2px_var(--color-surface-line)] hover:translate-y-[2px] hover:shadow-[0_4px_0_-1px_var(--color-paper),0_4px_0_2px_var(--color-surface-line)]',
    danger: 'bg-down text-on-accent shadow-[0_6px_0_-1px_var(--color-paper),0_6px_0_2px_var(--color-surface-line)] hover:translate-y-[2px]',
  }[variant]
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={`font-pill inline-flex items-center justify-center gap-2 rounded-full border-[3px] border-surface-line pt-[3px] tracking-[0.02em] whitespace-nowrap uppercase transition-[transform,box-shadow] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 ${
        size === 'sm' ? 'min-h-10 px-5 text-[13px]' : 'min-h-12 px-7 text-[15px]'
      } ${styles} ${className}`}
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
      className={`min-h-9 rounded-full border-2 border-surface-line px-4 text-[11px] font-bold tracking-[0.12em] uppercase transition-colors ${
        active ? 'bg-ink text-paper' : 'bg-surface text-ink hover:bg-surface-hover'
      }`}
    >
      {children}
    </button>
  )
}

export function CoinDot({ symbol, className = 'size-3.5' }: { symbol: string; className?: string }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full border-2 border-surface-line ${className}`}
      style={{ background: COIN_HEX[symbol] ?? 'var(--color-muted)' }}
      aria-hidden
    />
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
      <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2">
        <CoinDot symbol={symbol} />
      </span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-12 cursor-pointer appearance-none rounded-full border-[3px] border-surface-line bg-surface pr-10 pl-10 text-[13px] font-bold tracking-[0.08em] uppercase transition-colors hover:bg-surface-hover"
      >
        {tokens.map((t) => (
          <option key={t.address} value={t.address}>
            {t.symbol}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-xs" aria-hidden>
        ▾
      </span>
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-surface-hover ${className}`} aria-hidden />
}

export function Tag({ children, dot }: { children: ReactNode; dot?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-surface-line bg-surface px-2.5 py-[3px] text-[10.5px] font-bold tracking-[0.1em] uppercase">
      {dot && <span className="size-2 rounded-full border border-surface-line" style={{ background: dot }} aria-hidden />}
      {children}
    </span>
  )
}

export function VenueTag({ kind }: { kind: 'native' | 'official' }) {
  return kind === 'official' ? <Tag dot="#b07a12">1inch router</Tag> : <Tag dot="#1d2944">Stabrix router</Tag>
}

export function KindTag({ kind }: { kind: 'range' | 'backstop' }) {
  return kind === 'backstop' ? <Tag dot="#f6c945">Backstop</Tag> : <Tag dot="#ece7d8">FX range</Tag>
}

export function StatusTag({ halted }: { halted: boolean }) {
  return halted ? <Tag dot="var(--color-down)">Halted</Tag> : <Tag dot="var(--color-up)">Live</Tag>
}
