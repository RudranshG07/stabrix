'use client'

import { type Market, PRESETS, edgeUtilization } from '@stabrix/sdk'
import { KindTag, Skeleton, VenueTag } from '@/components/ui'
import { formatUsd, shortAddress } from '@/lib/format'
import { type LiveStrategy, backstopFill, isMine, presetOf, strategyUsd } from '@/lib/strategy'

const small = 'text-[10.5px] font-bold tracking-[0.14em] uppercase'

export function Meter({ used, label }: { used: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(used * 100)))
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="h-2.5 w-28 overflow-hidden rounded-full border-2 border-surface-line bg-paper"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={label}
      >
        <div className={`h-full ${used > 0.85 ? 'bg-down' : 'bg-ink'} transition-[width] duration-300`} style={{ width: `${pct}%` }} />
      </div>
      <span className="num text-[14px] text-muted">{pct}%</span>
    </div>
  )
}

export function settingOf(s: LiveStrategy): string {
  if (s.kind === 'backstop') return `${s.config.startDiscountBps / 100}% → ${s.config.endDiscountBps / 100}%`
  const p = presetOf(s)
  return p ? PRESETS.find((x) => x.id === p)!.label : 'Custom'
}

export function StrategyStatus({ s, market }: { s: LiveStrategy; market: Market }) {
  if (s.kind === 'range') return <Meter used={edgeUtilization(s.balances, s.rates, s.range)} label="Share of the range edge used" />
  const fill = backstopFill(s, market.prices)
  if (fill.length === 0) return <span className="text-[12px] font-bold tracking-[0.1em] text-muted uppercase">Standing by</span>
  return <Meter used={Math.max(...fill.map((f) => f.used))} label="Share of the backstop cap used" />
}

export function StrategyTable({ market, loading, owner }: { market: Market | undefined; loading: boolean; owner?: string }) {
  const all: LiveStrategy[] = market ? [...market.ranges, ...market.backstops] : []
  return (
    <div className="ink-card overflow-x-auto">
      <table className="w-full min-w-[680px]">
        <thead>
          <tr className="border-b-2 border-dashed border-line text-left">
            {['Maker', 'Kind', 'Venue', 'Setting', 'Value', 'Status'].map((h) => (
              <th key={h} scope="col" className={`${small} px-5 py-3.5 text-muted`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {market &&
            all.map((s) => (
              <tr key={s.id} className="border-b-2 border-dashed border-line last:border-0">
                <td className="px-5 py-3 text-[12px] font-bold tracking-[0.04em]">
                  {shortAddress(s.maker)}
                  {isMine(s, owner) && <span className="ml-2 text-muted">you</span>}
                </td>
                <td className="px-5 py-3">
                  <KindTag kind={s.kind} />
                </td>
                <td className="px-5 py-3">
                  <VenueTag kind={s.venue.kind} />
                </td>
                <td className="num px-5 py-3 text-[16px]">{settingOf(s)}</td>
                <td className="num px-5 py-3 text-[16px]">{formatUsd(strategyUsd(s, market.prices), 0)}</td>
                <td className="px-5 py-3">
                  <StrategyStatus s={s} market={market} />
                </td>
              </tr>
            ))}
          {market && all.length === 0 && (
            <tr>
              <td colSpan={6} className="font-serif px-5 py-6 text-[16px] text-muted">
                No live strategies yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {loading && <Skeleton className="m-5 h-24" />}
    </div>
  )
}
