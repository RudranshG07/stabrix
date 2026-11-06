'use client'

import { ArrowUpRight } from 'lucide-react'
import { useState } from 'react'
import type { Hex } from 'viem'
import { CoinDot, Label, Panel, Pill, SectionHead, Skeleton, Tag } from '@/components/ui'
import { type Activity, activityGroup } from '@/lib/activity'
import { DEV_ACCOUNTS } from '@/lib/config'
import { formatAmount, formatRate, shortAddress } from '@/lib/format'
import { useActivity, useStabrix } from '@/lib/stabrix'

type Filter = 'all' | 'swaps' | 'liquidity' | 'oracle'

const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['swaps', 'Swaps'],
  ['liquidity', 'Liquidity'],
  ['oracle', 'Oracle'],
]

const EXPLORERS: Record<number, string> = { 8453: 'https://basescan.org', 84532: 'https://sepolia.basescan.org' }

type Report = Extract<Activity, { type: 'cre' }>
type Row = { key: string; hash: Hex; time: number | null; group: Exclude<Filter, 'all'> } & ({ a: Activity } | { reports: Report[] })

const link = 'underline decoration-line underline-offset-2 hover:decoration-ink'

function ago(t: number | null): string {
  if (t === null) return ''
  const s = Math.max(0, Math.round(Date.now() / 1000 - t))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86_400)} d ago`
}

function TagFor({ a }: { a: Activity }) {
  if (a.type === 'swap') return <Tag dot="var(--color-violet)">Swap</Tag>
  if (a.type === 'cre') return <Tag dot={a.halted ? 'var(--color-down)' : 'var(--color-up)'}>Chainlink CRE</Tag>
  if (a.type === 'guardian') return <Tag dot={a.halted ? 'var(--color-down)' : 'var(--color-up)'}>Guardian</Tag>
  return <Tag dot={a.strategy === 'backstop' ? '#f6c945' : 'var(--color-ink)'}>{a.strategy === 'backstop' ? 'Backstop' : 'FX range'}</Tag>
}

export default function ActivityPage() {
  const { deployment } = useStabrix()
  const activity = useActivity()
  const [filter, setFilter] = useState<Filter>('all')
  const explorer = DEV_ACCOUNTS ? undefined : EXPLORERS[deployment.chainId]
  const token = (a: string) => deployment.tokens.find((t) => t.address.toLowerCase() === a.toLowerCase())

  const Addr = ({ address }: { address: string }) =>
    explorer ? (
      <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" className={link}>
        {shortAddress(address)}
      </a>
    ) : (
      <>{shortAddress(address)}</>
    )

  const order = (a: string) => deployment.tokens.findIndex((t) => t.address.toLowerCase() === a.toLowerCase())

  const describeReport = (reports: Report[]) => {
    const halted = reports.filter((r) => r.halted)
    const sorted = [...reports].sort((x, y) => Number(y.halted) - Number(x.halted) || order(x.token) - order(y.token))
    return (
      <>
        {halted.length > 0
          ? `Halted ${halted.map((r) => token(r.token)?.symbol ?? shortAddress(r.token)).join(', ')}`
          : `Report for ${reports.length} coin${reports.length > 1 ? 's' : ''}`}
        <span className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-muted">
          {sorted.map((r) => {
            const symbol = token(r.token)?.symbol ?? shortAddress(r.token)
            return (
              <span key={r.id} className={`inline-flex items-center gap-1.5 ${r.halted ? 'text-down' : ''}`}>
                <CoinDot symbol={symbol} className="size-3.5" />
                {symbol} <span className={`num ${r.halted ? '' : 'text-ink'}`}>{formatRate(r.priceE18, 4)}</span>
              </span>
            )
          })}
        </span>
      </>
    )
  }

  const describe = (a: Activity) => {
    if (a.type === 'swap') {
      const tin = token(a.tokenIn)
      const tout = token(a.tokenOut)
      return (
        <>
          <span className="num">
            {tin ? formatAmount(a.amountIn, tin.decimals, 2) : '?'} {tin?.symbol}
          </span>{' '}
          →{' '}
          <span className="num">
            {tout ? formatAmount(a.amountOut, tout.decimals, 2) : '?'} {tout?.symbol}
          </span>
          <span className="text-muted">
            {' '}
            · {String(a.legs)} leg{a.legs > 1n ? 's' : ''} · <Addr address={a.sender} />
          </span>
        </>
      )
    }
    if (a.type === 'cre') {
      const t = token(a.token)
      return (
        <>
          {a.halted ? 'Halted' : 'Priced'} {t?.symbol ?? shortAddress(a.token)} at <span className="num">{formatRate(a.priceE18, 5)}</span>
        </>
      )
    }
    if (a.type === 'guardian') {
      const t = token(a.token)
      return <>{`${a.halted ? 'Halted' : 'Resumed'} ${t?.symbol ?? shortAddress(a.token)} by hand`}</>
    }
    const what = a.strategy === 'backstop' ? 'Backstop' : a.strategy === 'range' ? 'FX range' : 'Strategy'
    const venue = a.app.toLowerCase() === deployment.officialRouter.toLowerCase() ? '1inch router' : 'Stabrix router'
    return (
      <>
        {what} {a.type === 'ship' ? (a.strategy === 'backstop' ? 'pledged' : 'opened') : 'closed'} by <Addr address={a.maker} />
        <span className="text-muted"> · {venue}</span>
      </>
    )
  }

  const grouped: Row[] = []
  const byReport = new Map<string, Report[]>()
  for (const a of activity.data?.events ?? []) {
    if (a.type === 'cre') {
      const existing = byReport.get(a.hash)
      if (existing) {
        existing.push(a)
        continue
      }
      const reports = [a]
      byReport.set(a.hash, reports)
      grouped.push({ key: a.id, hash: a.hash, time: a.time, group: 'oracle', reports })
    } else {
      grouped.push({ key: a.id, hash: a.hash, time: a.time, group: activityGroup(a), a })
    }
  }
  const rows = grouped.filter((r) => filter === 'all' || r.group === filter)
  const count = (f: Filter) => grouped.filter((r) => f === 'all' || r.group === f).length

  return (
    <div className="space-y-12">
      <SectionHead
        title="Activity"
        aside={
          <p className="max-w-2xl text-[14px] leading-snug text-muted">
            Every swap, every strategy opened or closed, and every Chainlink CRE report, read straight from the chain.
          </p>
        }
      />

      <Panel className="p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label>Latest on-chain events</Label>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filter events">
            {FILTERS.map(([f, text]) => (
              <Pill key={f} active={filter === f} onClick={() => setFilter(f)}>
                {text} {activity.data ? count(f) : ''}
              </Pill>
            ))}
          </div>
        </div>

        {activity.isLoading ? (
          <div className="mt-5 space-y-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : activity.isError ? (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <p className="text-[13.5px] text-down">Could not read events from the RPC.</p>
            <Pill role="button" active={false} onClick={() => activity.refetch()}>
              Retry
            </Pill>
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-5 text-[14px] text-muted">Nothing here yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {rows.map((row) => (
              <li key={row.key} className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[150px_1fr_auto_auto]">
                <span>
                  {'a' in row ? (
                    <TagFor a={row.a} />
                  ) : (
                    <Tag dot={row.reports.some((r) => r.halted) ? 'var(--color-down)' : 'var(--color-up)'}>Chainlink CRE</Tag>
                  )}
                </span>
                <span className="min-w-0 text-[13.5px] leading-snug">{'a' in row ? describe(row.a) : describeReport(row.reports)}</span>
                <span className="num col-start-2 text-[13px] text-muted sm:col-start-auto">{ago(row.time)}</span>
                <span className="col-start-2 sm:col-start-auto">
                  {explorer ? (
                    <a
                      href={`${explorer}/tx/${row.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 font-mono text-[12px] underline decoration-line underline-offset-2 hover:decoration-ink"
                    >
                      {shortAddress(row.hash)}
                      <ArrowUpRight className="size-3" aria-hidden />
                    </a>
                  ) : (
                    <span className="font-mono text-[12px] text-muted">{shortAddress(row.hash)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
