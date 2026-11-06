'use client'

import type { Quote } from '@stabrix/sdk'
import { ArrowDownUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { OrbitMap } from '@/components/orbit-map'
import { TxStatus } from '@/components/tx-status'
import { Button, Label, Panel, Pill, SectionHead, Skeleton, TokenSelect, VenueTag } from '@/components/ui'
import { formatAmount, formatPct, shortAddress, toUnits } from '@/lib/format'
import { useBalances, useMarket, useSentinel, useStabrix } from '@/lib/stabrix'
import { useTx } from '@/lib/tx'

const SLIPPAGES = [10, 30, 100]

export default function SwapPage() {
  const { deployment, client, signer, wallet } = useStabrix()
  const market = useMarket()
  const sentinel = useSentinel()
  const balances = useBalances(signer?.address)
  const tokens = deployment.tokens

  const [tokenIn, setTokenIn] = useState(tokens[0]!.address as string)
  const [tokenOut, setTokenOut] = useState(tokens[2]!.address as string)
  const [text, setText] = useState('1000')
  const [slippage, setSlippage] = useState(30)
  const tx = useTx()

  const tIn = tokens.find((t) => t.address === tokenIn)!
  const tOut = tokens.find((t) => t.address === tokenOut)!
  const amount = toUnits(text, tIn.decimals)
  const halted = useMemo(
    () => new Set((sentinel.data ?? []).filter((s) => s.halted).map((s) => s.token.toLowerCase())),
    [sentinel.data],
  )
  const inHalted = halted.has(tIn.address.toLowerCase())

  const quote: Quote | null = useMemo(() => {
    if (!market.data || !amount || amount === 0n || tokenIn === tokenOut) return null
    return client.quoteExactIn(market.data, tIn.address, tOut.address, amount)
  }, [market.data, amount, tokenIn, tokenOut, client, tIn.address, tOut.address])

  const mid = market.data ? client.midPrice(market.data, tIn.address, tOut.address) : null
  const impact =
    quote && mid && quote.filled > 0n ? (1 - Number((quote.amountOut * 10n ** 18n) / quote.filled) / Number(mid)) * 100 : null
  const minOut = quote ? (quote.amountOut * BigInt(10_000 - slippage)) / 10_000n : 0n
  const balanceIn = balances.data?.[tokens.indexOf(tIn)]
  const rate =
    quote && quote.filled > 0n
      ? Number(formatAmount(quote.amountOut, tOut.decimals, 8).replace(/,/g, '')) /
        Number(formatAmount(quote.filled, tIn.decimals, 8).replace(/,/g, ''))
      : null

  const flip = () => {
    setTokenIn(tokenOut)
    setTokenOut(tokenIn)
    if (quote && quote.amountOut > 0n) setText(formatAmount(quote.amountOut, tOut.decimals, 6).replace(/,/g, ''))
  }

  let cta = 'Swap'
  let blocked = false
  if (!signer || !wallet) [cta, blocked] = ['Connect an account', true]
  else if (tokenIn === tokenOut) [cta, blocked] = ['Pick two different coins', true]
  else if (!amount || amount === 0n) [cta, blocked] = ['Enter an amount', true]
  else if (inHalted) [cta, blocked] = [`${tIn.symbol} is halted`, true]
  else if (balanceIn !== undefined && amount > balanceIn) [cta, blocked] = [`Not enough ${tIn.symbol}`, true]
  else if (quote && quote.filled < quote.amountIn) [cta, blocked] = ['Not enough liquidity', true]
  else if (!quote || quote.legs.length === 0) [cta, blocked] = ['No route', true]

  const swap = () =>
    tx.run('Routing', async (progress) => {
      if (!wallet || !quote) throw new Error('No quote')
      progress(`Swapping across ${quote.legs.length} range${quote.legs.length > 1 ? 's' : ''}`)
      const done = await client.swap(wallet, quote, slippage)
      return { message: `Received ${formatAmount(done.amountOut, tOut.decimals, 4)} ${tOut.symbol}`, hash: done.hash }
    })

  return (
    <div className="space-y-12">
      <SectionHead
        index="stabrix · 01 · swap"
        title="Swap stables"
        aside={<p className="max-w-xs text-sm text-muted sm:text-right">One pool for every pair, split across LP ranges on both venues in one transaction.</p>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Panel className="p-5 sm:p-6 lg:col-span-7">
          <div className="rounded-2xl bg-paper p-5">
            <div className="flex items-center justify-between">
              <label htmlFor="amount-in" className="caption">
                YOU PAY
              </label>
              <button
                type="button"
                className="caption transition-colors hover:text-ink disabled:hover:text-muted"
                disabled={balanceIn === undefined}
                onClick={() => balanceIn !== undefined && setText(formatAmount(balanceIn, tIn.decimals, 6).replace(/,/g, ''))}
              >
                BAL {balanceIn === undefined ? '—' : formatAmount(balanceIn, tIn.decimals)}
              </button>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <input
                id="amount-in"
                size={1}
                inputMode="decimal"
                autoComplete="off"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="0.00"
                aria-invalid={text !== '' && amount === null}
                className="num min-w-0 flex-1 bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-muted/50 sm:text-4xl"
              />
              <TokenSelect id="token-in" label="Coin to pay" tokens={tokens} value={tokenIn} onChange={setTokenIn} />
            </div>
          </div>

          <div className="relative z-10 -my-3.5 flex justify-center">
            <button
              type="button"
              onClick={flip}
              aria-label="Swap direction"
              className="grid size-11 place-items-center rounded-full border-4 border-surface bg-surface-hover transition-colors hover:bg-line"
            >
              <ArrowDownUp className="size-4" aria-hidden />
            </button>
          </div>

          <div className="rounded-2xl bg-paper p-5">
            <p className="caption">YOU RECEIVE</p>
            <div className="mt-3 flex items-center gap-3">
              <output aria-live="polite" className="num min-w-0 flex-1 truncate text-3xl font-semibold tracking-tight sm:text-4xl">
                {market.isLoading ? <Skeleton className="h-10 w-40" /> : quote ? formatAmount(quote.amountOut, tOut.decimals, 4) : '0'}
              </output>
              <TokenSelect id="token-out" label="Coin to receive" tokens={tokens} value={tokenOut} onChange={setTokenOut} />
            </div>
          </div>

          <dl className="mt-6 space-y-3 font-mono text-xs">
            <div className="flex justify-between">
              <dt className="text-muted">RATE</dt>
              <dd className="num">{rate ? `1 ${tIn.symbol} = ${rate.toFixed(5)} ${tOut.symbol}` : '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">PRICE IMPACT</dt>
              <dd className={`num ${impact !== null && impact > 1 ? 'text-down' : ''}`}>
                {impact === null ? '—' : formatPct(-Math.max(impact, 0), 3)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">MIN RECEIVED</dt>
              <dd className="num">{quote ? `${formatAmount(minOut, tOut.decimals, 4)} ${tOut.symbol}` : '—'}</dd>
            </div>
          </dl>
          <div className="rule my-5" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="caption">SLIPPAGE LIMIT</span>
            <div className="flex gap-1.5" role="radiogroup" aria-label="Slippage limit">
              {SLIPPAGES.map((s) => (
                <Pill key={s} active={slippage === s} onClick={() => setSlippage(s)}>
                  {(s / 100).toFixed(1)}%
                </Pill>
              ))}
            </div>
          </div>

          <Button className="mt-6 w-full" disabled={blocked} busy={tx.state.status === 'pending'} onClick={swap}>
            {cta}
          </Button>
          <TxStatus state={tx.state} />
        </Panel>

        <div className="space-y-6 lg:col-span-5">
          <Panel className="p-5 sm:p-6">
            <Label>Route</Label>
            {market.isLoading ? (
              <div className="mt-4 space-y-3">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : !market.data || market.data.ranges.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No live ranges yet. Add liquidity to open the pool.</p>
            ) : !quote || quote.legs.length === 0 ? (
              <p className="mt-4 text-sm text-muted">
                {inHalted ? `${tIn.symbol} is halted by the sentinel. No range accepts it.` : 'Enter an amount to see the split.'}
              </p>
            ) : (
              <ul className="mt-4 space-y-2.5">
                {quote.legs.map((leg) => {
                  const r = quote.strategies.find((x) => x.id === leg.id)
                  const share = Number((leg.amountIn * 10_000n) / quote.amountIn) / 100
                  return (
                    <li key={leg.id} className="rounded-2xl bg-paper p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-muted">{r ? shortAddress(r.maker) : '—'}</span>
                        {r && <VenueTag kind={r.venue.kind} />}
                      </div>
                      <div className="mt-2.5 flex items-baseline justify-between font-mono text-sm">
                        <span className="num">
                          {formatAmount(leg.amountIn, tIn.decimals)} {tIn.symbol}
                        </span>
                        <span className="num text-muted">{share.toFixed(1)}%</span>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-line">
                        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${share}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
          <Panel className="p-5 sm:p-6">
            <Label>Orbit map</Label>
            <div className="mt-4">
              {market.isLoading ? <Skeleton className="aspect-square" /> : <OrbitMap ranges={market.data?.ranges ?? []} coins={tokens} />}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
