'use client'

import { ArrowUpRight } from 'lucide-react'
import { useState } from 'react'
import { Label, Panel, Pill, SectionHead, Skeleton, Tag } from '@/components/ui'
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

const EXPLORERS: Record<number, string> = { 8453: 'https://basescan.org/tx/', 84532: 'https://sepolia.basescan.org/tx/' }

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
  return <Tag dot={a.strategy === 'backstop' ? '#f6c945' : '#ece7d8'}>{a.strategy === 'backstop' ? 'Backstop' : 'FX range'}</Tag>
}

export default function ActivityPage() {
  const { deployment } = useStabrix()
  const activity = useActivity()
  const [filter, setFilter] = useState<Filter>('all')
  const explorer = DEV_ACCOUNTS ? undefined : EXPLORERS[deployment.chainId]
  const token = (a: string) => deployment.tokens.find((t) => t.address.toLowerCase() === a.toLowerCase())

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
            · {String(a.legs)} leg{a.legs > 1n ? 's' : ''} · {shortAddress(a.sender)}
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
        {what} {a.type === 'ship' ? (a.strategy === 'backstop' ? 'pledged' : 'opened') : 'closed'} by {shortAddress(a.maker)}
        <span className="text-muted"> · {venue}</span>
      </>
    )
  }

  const rows = (activity.data?.events ?? []).filter((a) => filter === 'all' || activityGroup(a) === filter)
  const count = (f: Filter) => (activity.data?.events ?? []).filter((a) => f === 'all' || activityGroup(a) === f).length

  return (
    <div className="space-y-12">
      <SectionHead
        index="Stabrix · 04"
        title="Activity"
        aside={
          <p className="font-serif max-w-sm text-[17px] leading-snug text-muted sm:text-right">
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
            <p className="text-[15px] text-down">Could not read events from the RPC.</p>
            <Pill role="button" active={false} onClick={() => activity.refetch()}>
              Retry
            </Pill>
          </div>
        ) : rows.length === 0 ? (
          <p className="font-serif mt-5 text-[17px] text-muted">Nothing here yet.</p>
        ) : (
          <ul className="mt-4 divide-y-2 divide-dashed divide-line">
            {rows.map((a) => (
              <li key={a.id} className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[150px_1fr_auto_auto]">
                <span>
                  <TagFor a={a} />
                </span>
                <span className="min-w-0 text-[15px] leading-snug">{describe(a)}</span>
                <span className="num col-start-2 text-[14px] text-muted sm:col-start-auto sm:text-right">{ago(a.time)}</span>
                <span className="col-start-2 sm:col-start-auto">
                  {explorer ? (
                    <a
                      href={`${explorer}${a.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 font-mono text-[12px] underline decoration-line underline-offset-2 hover:decoration-ink"
                    >
                      {shortAddress(a.hash)}
                      <ArrowUpRight className="size-3" aria-hidden />
                    </a>
                  ) : (
                    <span className="font-mono text-[12px] text-muted">{shortAddress(a.hash)}</span>
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
