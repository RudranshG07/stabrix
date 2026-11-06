'use client'

import { PRESETS } from '@stabrix/sdk'
import { useMemo, useState } from 'react'
import { OrbitMap } from '@/components/orbit-map'
import { StrategyTable } from '@/components/strategies'
import { COIN_HEX, CoinDot, Label, Panel, SectionHead, Skeleton, Stat, TokenSelect } from '@/components/ui'
import { CURRENCY } from '@/lib/coins'
import { depthBands } from '@/lib/depth'
import { formatUsd } from '@/lib/format'
import { useActivity, useMarket, useStabrix } from '@/lib/stabrix'
import { presetOf, strategyUsd, valueUsd } from '@/lib/strategy'

const DAY = 86_400
const compactUsd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`)

export default function PoolPage() {
  const { deployment, signer } = useStabrix()
  const market = useMarket()
  const activity = useActivity()
  const m = market.data

  const ranges = m?.ranges ?? []
  const backstops = m?.backstops ?? []
  const inRanges = m ? ranges.reduce((s, r) => s + strategyUsd(r, m.prices), 0) : 0
  const inBackstops = m ? backstops.reduce((s, b) => s + strategyUsd(b, m.prices), 0) : 0
  const makers = new Set([...ranges, ...backstops].map((s) => s.maker.toLowerCase())).size

  const perCoin = deployment.tokens.map((t) => {
    const usd = m
      ? ranges.reduce((s, r) => {
          const k = r.config.tokens.findIndex((x) => x.toLowerCase() === t.address.toLowerCase())
          return k < 0 ? s : s + valueUsd(r.balances[k] ?? 0n, t.decimals, m.prices.get(t.address.toLowerCase()))
        }, 0)
      : 0
    return { token: t, usd }
  })

  const byWidth = PRESETS.map((p) => {
    const own = ranges.filter((r) => presetOf(r) === p.id)
    return { p, count: own.length, usd: m ? own.reduce((s, r) => s + strategyUsd(r, m.prices), 0) : 0 }
  })
  const capTotal = backstops.reduce((s, b) => s + Number(b.config.capPerToken) / 1e18, 0)
  const widest = Math.max(1, ...byWidth.map((w) => w.usd), inBackstops)

  const [depthToken, setDepthToken] = useState<string>(deployment.tokens.find((t) => t.symbol === 'USDC')?.address ?? deployment.tokens[0]!.address)
  const depth = useMemo(() => (m ? depthBands(m.ranges, m.prices, depthToken) : null), [m, depthToken])
  const deepest = depth ? Math.max(1, ...depth.map((r) => r.tight + r.balanced + r.wide)) : 1
  const depthSymbol = deployment.tokens.find((t) => t.address === depthToken)?.symbol ?? ''

  const now = Date.now() / 1000
  const fees =
    m && activity.data
      ? activity.data.fills.reduce((s, f) => {
          if (f.time === null || now - f.time > DAY) return s
          const r = ranges.find((x) => x.hash.toLowerCase() === f.orderHash.toLowerCase())
          const t = deployment.tokens.find((x) => x.address.toLowerCase() === f.tokenIn.toLowerCase())
          if (!r || !t) return s
          const i = r.config.tokens.findIndex((x) => x.toLowerCase() === f.tokenIn.toLowerCase())
          const j = r.config.tokens.findIndex((x) => x.toLowerCase() === f.tokenOut.toLowerCase())
          const bps = r.fx[i] || r.fx[j] ? r.config.fxFeeBps : r.config.feeBps
          return s + valueUsd((f.amountIn * BigInt(bps)) / 10_000n, t.decimals, m.prices.get(t.address.toLowerCase()))
        }, 0)
      : null
  const swaps = (activity.data?.events ?? []).filter((a) => a.type === 'swap' && a.time !== null && now - a.time <= DAY)
  const volume =
    m && activity.data
      ? swaps.reduce((s, a) => {
          if (a.type !== 'swap') return s
          const t = deployment.tokens.find((x) => x.address.toLowerCase() === a.tokenIn.toLowerCase())
          return t ? s + valueUsd(a.amountIn, t.decimals, m.prices.get(t.address.toLowerCase())) : s
        }, 0)
      : null

  return (
    <div className="space-y-12">
      <SectionHead
        index="Stabrix · 03"
        title="Pool"
        aside={
          <p className="font-serif max-w-sm text-[17px] leading-snug text-muted sm:text-right">
            One curve over {deployment.tokens.length} stablecoins, made of every LP's wallet. Nothing here is deposited.
          </p>
        }
      />

      <Panel className="grid grid-cols-2 gap-6 p-5 sm:p-7 lg:grid-cols-5">
        <Stat label="In FX ranges" value={m ? formatUsd(inRanges, 0) : '…'} />
        <Stat label="Pledged to backstops" value={m ? formatUsd(inBackstops, 0) : '…'} />
        <Stat label="Makers" value={m ? String(makers) : '…'} />
        <Stat label="Volume, last 24h" value={volume === null ? '…' : `${formatUsd(volume, 0)} · ${swaps.length}`} />
        <Stat label="Fees to LPs, 24h" value={fees === null ? '…' : formatUsd(fees, 2)} />
      </Panel>

      <div className="grid grid-cols-1 gap-7 lg:grid-cols-12">
        <div className="space-y-7 lg:col-span-7">
          <Panel className="p-5 sm:p-7">
            <div className="flex items-baseline justify-between gap-3">
              <Label>Reserve mix</Label>
              <span className="num text-[16px] text-muted">{m ? formatUsd(inRanges, 0) : ''}</span>
            </div>
            {!m ? (
              <Skeleton className="mt-5 h-40" />
            ) : inRanges === 0 ? (
              <p className="font-serif mt-5 text-[17px] text-muted">No liquidity yet. Open a range on the Liquidity page.</p>
            ) : (
              <>
                <div className="mt-5 flex h-4 overflow-hidden rounded-full border-2 border-surface-line" role="img" aria-label="Share of each coin in the pool">
                  {perCoin.map(({ token, usd }) => (
                    <span key={token.address} style={{ width: `${(usd / inRanges) * 100}%`, background: COIN_HEX[token.symbol] }} />
                  ))}
                </div>
                <ul className="mt-4 divide-y-2 divide-dashed divide-line">
                  {perCoin.map(({ token, usd }) => (
                    <li key={token.address} className="flex items-center gap-3 py-2.5">
                      <CoinDot symbol={token.symbol} />
                      <span className="w-14 text-[12px] font-bold tracking-[0.06em]">{token.symbol}</span>
                      <span className="text-[10.5px] font-bold tracking-[0.12em] text-muted uppercase">{CURRENCY[token.symbol]}</span>
                      <span className="num ml-auto text-[17px]">{formatUsd(usd, 0)}</span>
                      <span className="num w-16 text-right text-[15px] text-muted">{((usd / inRanges) * 100).toFixed(1)}%</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel className="p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label>Depth</Label>
              <TokenSelect id="depth-token" label="Coin to measure" tokens={deployment.tokens} value={depthToken} onChange={setDepthToken} />
            </div>
            <p className="font-serif mt-2 text-[16px] text-muted">
              How many dollars of {depthSymbol} the pool takes in before its price falls by each step from where it trades now, replayed on every live range with the contract math.
            </p>
            {!depth ? (
              <Skeleton className="mt-5 h-44" />
            ) : (
              <>
                <div className="mt-5 grid h-44 grid-cols-8 items-end gap-2" role="img" aria-label={`Depth of ${depthSymbol} by price drop`}>
                  {depth.map((row) => {
                    const total = row.tight + row.balanced + row.wide
                    return (
                      <div key={row.band} className="flex h-full flex-col justify-end">
                        <div className="flex flex-col-reverse overflow-hidden rounded-t-[6px] border-2 border-b-0 border-surface-line" style={{ height: `${(total / deepest) * 100}%` }}>
                          {(['tight', 'balanced', 'wide'] as const).map((k) => (
                            <span
                              key={k}
                              className={k === 'tight' ? 'bg-ink' : k === 'balanced' ? 'bg-violet' : 'bg-series-lime'}
                              style={{ height: total > 0 ? `${(row[k] / total) * 100}%` : 0 }}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="grid grid-cols-8 gap-2 border-t-2 border-surface-line pt-2">
                  {depth.map((row) => (
                    <div key={row.band} className="text-center">
                      <p className="num text-[13px]">−{((1 - row.band) * 100).toFixed(2).replace(/0$/, '')}%</p>
                      <p className="num text-[12px] text-muted">{compactUsd(row.tight + row.balanced + row.wide)}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-[10.5px] font-bold tracking-[0.12em] uppercase">
                  <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-ink" />Tight</span>
                  <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-violet" />Balanced</span>
                  <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-series-lime" />Wide</span>
                </div>
              </>
            )}
          </Panel>

          <Panel className="p-5 sm:p-7">
            <Label>Liquidity by depeg tolerance</Label>
            <p className="font-serif mt-2 text-[16px] text-muted">How far a coin can fall before each range stops taking it, and the backstops that buy after.</p>
            {!m ? (
              <Skeleton className="mt-5 h-36" />
            ) : (
              <ul className="mt-5 space-y-4">
                {byWidth.map(({ p, count, usd }) => (
                  <li key={p.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12px] font-bold tracking-[0.08em] uppercase">
                        {p.label} <span className="text-muted">· edge at {(p.maxDeviationBps / 100).toFixed(1)}% · {count}</span>
                      </span>
                      <span className="num text-[17px]">{formatUsd(usd, 0)}</span>
                    </div>
                    <div className="mt-1.5 h-3 overflow-hidden rounded-full border-2 border-surface-line bg-paper">
                      <div className="h-full bg-ink" style={{ width: `${(usd / widest) * 100}%` }} />
                    </div>
                  </li>
                ))}
                <li>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12px] font-bold tracking-[0.08em] uppercase">
                      Backstops <span className="text-muted">· buy after a halt · {backstops.length}</span>
                    </span>
                    <span className="num text-[17px]">{formatUsd(inBackstops, 0)}</span>
                  </div>
                  <div className="mt-1.5 h-3 overflow-hidden rounded-full border-2 border-surface-line bg-paper">
                    <div className="h-full bg-[#f6c945]" style={{ width: `${(inBackstops / widest) * 100}%` }} />
                  </div>
                  <p className="caption mt-1.5">Combined cap {formatUsd(capTotal, 0)} per halted coin.</p>
                </li>
              </ul>
            )}
          </Panel>
        </div>

        <Panel className="p-5 sm:p-6 lg:col-span-5 lg:self-start">
          <Label>Orbit map</Label>
          <div className="mt-4">{!m ? <Skeleton className="aspect-square" /> : <OrbitMap ranges={ranges} coins={deployment.tokens} />}</div>
        </Panel>
      </div>

      <section aria-labelledby="strategies" className="space-y-5">
        <Label id="strategies">Every strategy</Label>
        <StrategyTable market={m} loading={market.isLoading} owner={signer?.address} />
      </section>
    </div>
  )
}
