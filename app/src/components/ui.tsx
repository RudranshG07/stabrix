'use client'

import type { TokenInfo } from '@stabrix/sdk'
import { ChevronDown, Loader2 } from 'lucide-react'
import Image from 'next/image'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { COIN_HEX, COIN_TONES } from '@/lib/coins'

export { COIN_HEX, COIN_TONES }

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`ink-card ${className}`}>{children}</section>
}

export function Label({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} className="label">
      {children}
    </p>
  )
}

export function SectionHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <header>
      <h1 className="title text-[24px] leading-tight">{title}</h1>
      {aside && <div className="mt-1">{aside}</div>}
    </header>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'up' | 'down' | 'accent' }) {
  const color = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : tone === 'accent' ? 'text-accent-text' : 'text-ink'
  return (
    <div className="min-w-0">
      <p className="label">{label}</p>
      <p className={`num mt-1.5 truncate text-[16px] leading-tight font-medium ${color}`}>{value}</p>
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
    primary: 'border-ink bg-ink text-on-accent hover:bg-accent-hover',
    ghost: 'border-line bg-surface text-ink hover:bg-surface-hover',
    danger: 'border-down bg-down text-on-accent hover:opacity-90',
  }[variant]
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        size === 'sm' ? 'min-h-9 px-4 text-[13px]' : 'min-h-11 px-6 text-[14px]'
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
      className={`min-h-8 rounded-full border px-3.5 text-[12px] font-medium transition-colors ${
        active ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-ink hover:bg-surface-hover'
      }`}
    >
      {children}
    </button>
  )
}

const LOGOS = new Set(['USDC', 'USDT', 'DAI', 'USDS', 'USDe', 'EURC', 'BRZ', 'IDRX'])

export function CoinDot({ symbol, className = 'size-5' }: { symbol: string; className?: string }) {
  if (!LOGOS.has(symbol)) {
    return (
      <span
        className={`inline-block shrink-0 rounded-full border border-line ${className}`}
        style={{ background: COIN_HEX[symbol] ?? 'var(--color-muted)' }}
        aria-hidden
      />
    )
  }
  return <Image src={`/coins/${symbol}.png`} alt="" aria-hidden width={40} height={40} className={`inline-block shrink-0 rounded-full ${className}`} />
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
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2">
        <CoinDot symbol={symbol} />
      </span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-10 cursor-pointer appearance-none rounded-full border border-line bg-surface pr-9 pl-9 text-[14px] font-medium transition-colors hover:bg-surface-hover"
      >
        {tokens.map((t) => (
          <option key={t.address} value={t.address}>
            {t.symbol}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-surface-hover ${className}`} aria-hidden />
}

export function Tag({ children, dot }: { children: ReactNode; dot?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap">
      {dot && <span className="size-1.5 rounded-full" style={{ background: dot }} aria-hidden />}
      {children}
    </span>
  )
}

export function VenueTag({ kind }: { kind: 'native' | 'official' }) {
  return kind === 'official' ? <Tag dot="var(--color-series-lime)">1inch router</Tag> : <Tag dot="var(--color-violet)">Stabrix router</Tag>
}

export function KindTag({ kind }: { kind: 'range' | 'backstop' }) {
  return kind === 'backstop' ? <Tag dot="#f6c945">Backstop</Tag> : <Tag dot="var(--color-ink)">FX range</Tag>
}

export function StatusTag({ halted }: { halted: boolean }) {
  return halted ? <Tag dot="var(--color-down)">Halted</Tag> : <Tag dot="var(--color-up)">Live</Tag>
}
