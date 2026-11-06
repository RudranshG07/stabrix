'use client'

import type { Quote, TokenInfo } from '@stabrix/sdk'
import { ArrowDownUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { TxStatus } from '@/components/tx-status'
import { TestCoinsNotice } from '@/components/test-coins'
import { Button, CoinDot, KindTag, Label, Panel, Pill, SectionHead, Skeleton, StatusTag, TokenSelect, VenueTag } from '@/components/ui'
import { CURRENCY } from '@/lib/coins'
import { formatAmount, formatPct, formatRate, formatUsd, shortAddress, toUnits } from '@/lib/format'
import { formatRatio, priceOf, units, usd, withoutMaker } from '@/lib/market'
import { useBalances, useMarket, useStabrix } from '@/lib/stabrix'
import { useTx } from '@/lib/tx'

const SLIPPAGES = [10, 30, 100]

function Row({ term, children, tone }: { term: string; children: React.ReactNode; tone?: 'up' | 'down' }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-[10.5px] font-medium tracking-[0.08em] text-muted uppercase">{term}</dt>
      <dd className={`num text-right text-[14px] ${tone === 'down' ? 'text-down' : tone === 'up' ? 'text-up' : ''}`}>{children}</dd>
    </div>
  )
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-line bg-paper px-5 py-4">{children}</div>
}

export default function SwapPage() {
  const { deployment, client, signer, wallet } = useStabrix()
  const market = useMarket()
  const balances = useBalances(signer?.address)
  const tokens = deployment.tokens
  const bySymbol = (s: string) => tokens.find((t) => t.symbol === s) ?? tokens[0]!

  const [tokenIn, setTokenIn] = useState<string>(bySymbol('USDC').address)
  const [tokenOut, setTokenOut] = useState<string>(bySymbol('EURC').address)
  const [text, setText] = useState('1000')
  const [slippage, setSlippage] = useState(30)
  const tx = useTx()

  const tIn = tokens.find((t) => t.address === tokenIn)!
  const tOut = tokens.find((t) => t.address === tokenOut)!
  const amount = toUnits(text, tIn.decimals)
  const pIn = priceOf(market.data, tIn)
  const pOut = priceOf(market.data, tOut)
  const inHalted = pIn?.halted ?? false
  const outHalted = pOut?.halted ?? false

  const me = signer?.address
  const quote: Quote | null = useMemo(() => {
    if (!market.data || !amount || amount === 0n || tokenIn === tokenOut) return null
    return client.quoteExactIn(withoutMaker(market.data, me), tIn.address, tOut.address, amount)
  }, [market.data, amount, tokenIn, tokenOut, client, tIn.address, tOut.address, me])

  const marketIn = inHalted ? pIn?.depegE18 : pIn?.priceE18
  const usdIn = amount ? usd(amount, tIn.decimals, marketIn) : null
  const usdOut = quote ? usd(quote.amountOut, tOut.decimals, pOut?.priceE18) : null
  const usdFilled = quote ? usd(quote.filled, tIn.decimals, marketIn) : null
  const value = usdOut !== null && usdFilled ? (usdOut / usdFilled - 1) * 100 : null
  const rate = quote && quote.filled > 0n ? units(quote.amountOut, tOut.decimals) / units(quote.filled, tIn.decimals) : null
  const minOut = quote ? (quote.amountOut * BigInt(10_000 - slippage)) / 10_000n : 0n
  const balanceIn = balances.data?.[tokens.indexOf(tIn)]
  const backstopRoute = quote?.strategies[0]?.kind === 'backstop'
  const received = quote ? formatAmount(quote.amountOut, tOut.decimals, 4) : '0'
  const amountLen = Math.max(text.length, received.length, 4)

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
  else if (outHalted) [cta, blocked] = [`${tOut.symbol} is halted`, true]
  else if (balanceIn !== undefined && amount > balanceIn) [cta, blocked] = [`Not enough ${tIn.symbol}`, true]
  else if (inHalted && (!quote || quote.legs.length === 0)) [cta, blocked] = [`No backstop is buying ${tIn.symbol}`, true]
  else if (quote && quote.legs.length > 0 && quote.filled < quote.amountIn) [cta, blocked] = ['Not enough liquidity', true]
  else if (!quote || quote.legs.length === 0) [cta, blocked] = ['No route', true]
  else if (inHalted) cta = `Sell ${tIn.symbol} to the backstops`

  const swap = () =>
    tx.run('Routing', async (progress) => {
      if (!wallet || !quote) throw new Error('No quote')
      const n = quote.legs.length
      progress(`Approving, then swapping across ${n} ${backstopRoute ? 'backstop' : 'range'}${n > 1 ? 's' : ''}`)
      const done = await client.swap(wallet, quote, slippage)
      return { message: `Received ${formatAmount(done.amountOut, tOut.decimals, 4)} ${tOut.symbol}`, hash: done.hash }
    })

  const pick = (t: TokenInfo) => {
    if (t.address === tokenIn) return
    setTokenOut(t.address)
  }

  return (
    <div className="space-y-12">
      <SectionHead
        title="Swap"
        aside={
          <p className="max-w-2xl text-[14px] leading-snug text-muted">
            Any pair across eight stablecoins. One quote splits across LP strategies on the 1inch router and the Stabrix router, settled in one transaction.
          </p>
        }
      />
      <TestCoinsNotice />

      <div className="grid grid-cols-1 gap-7 lg:grid-cols-12">
        <Panel className="p-5 sm:p-7 lg:col-span-7 lg:self-start">
          {inHalted && (
            <div className="mb-5 rounded-xl border border-down bg-down/10 px-5 py-4" role="status">
              <p className="text-[11px] font-medium tracking-[0.08em] text-down uppercase">{tIn.symbol} is halted by Chainlink CRE</p>
              <p className="mt-1.5 text-[14px] leading-snug">
                Ranges refuse it. Backstops buy it at its market price{pIn?.depegE18 ? ` (${formatRate(pIn.depegE18)})` : ''} minus a
                discount, and pay you in a healthy coin.
              </p>
            </div>
          )}

          <Field>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="amount-in" className="text-[10.5px] font-medium tracking-[0.08em] uppercase">
                You pay
              </label>
              <button
                type="button"
                className="text-[10.5px] font-medium tracking-[0.08em] text-muted uppercase transition-colors hover:text-ink"
                disabled={balanceIn === undefined}
                onClick={() => balanceIn !== undefined && setText(formatAmount(balanceIn, tIn.decimals, 6).replace(/,/g, ''))}
              >
                Balance <span className="num text-[12.5px] tracking-normal">{balanceIn === undefined ? '—' : formatAmount(balanceIn, tIn.decimals)}</span>
              </button>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <input
                id="amount-in"
                size={1}
                inputMode="decimal"
                autoComplete="off"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="0"
                aria-invalid={text !== '' && amount === null}
                style={{ ['--len' as string]: amountLen }}
                className="num amount min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted/50"
              />
              <TokenSelect id="token-in" label="Coin to pay" tokens={tokens} value={tokenIn} onChange={setTokenIn} />
            </div>
            <p className="num text-[13.5px] text-muted">{usdIn === null ? ' ' : formatUsd(usdIn)}</p>
          </Field>

          <div className="relative z-10 -my-3 flex justify-center">
            <button
              type="button"
              onClick={flip}
              aria-label="Swap direction"
              className="grid size-11 place-items-center rounded-full border border-line bg-surface transition-transform hover:rotate-180"
            >
              <ArrowDownUp className="size-4" aria-hidden />
            </button>
          </div>

          <Field>
            <p className="text-[10.5px] font-medium tracking-[0.08em] uppercase">You receive</p>
            <div className="mt-2 flex items-center gap-3">
              <output aria-live="polite" style={{ ['--len' as string]: amountLen }} className="num amount min-w-0 flex-1 truncate">
                {market.isLoading ? <Skeleton className="h-12 w-40" /> : received}
              </output>
              <TokenSelect id="token-out" label="Coin to receive" tokens={tokens} value={tokenOut} onChange={setTokenOut} />
            </div>
            <p className="num text-[13.5px] text-muted">{usdOut === null ? ' ' : formatUsd(usdOut)}</p>
          </Field>

          <dl className="mt-5 divide-y divide-line">
            <Row term="Rate">{rate ? `1 ${tIn.symbol} = ${formatRatio(rate)} ${tOut.symbol}` : '—'}</Row>
            <Row term="Value vs Chainlink" tone={value !== null && value < -1 ? 'down' : undefined}>
              {value === null ? '—' : formatPct(value, 3)}
            </Row>
            <Row term="Minimum received">{quote ? `${formatAmount(minOut, tOut.decimals, 4)} ${tOut.symbol}` : '—'}</Row>
          </dl>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[10.5px] font-medium tracking-[0.08em] text-muted uppercase">Slippage limit</span>
            <div className="flex gap-1.5" role="radiogroup" aria-label="Slippage limit">
              {SLIPPAGES.map((s) => (
                <Pill key={s} active={slippage === s} onClick={() => setSlippage(s)}>
                  {(s / 100).toFixed(1)}%
                </Pill>
              ))}
            </div>
          </div>

          <Button className="mt-7 w-full" variant={inHalted ? 'danger' : 'primary'} disabled={blocked} busy={tx.state.status === 'pending'} onClick={swap}>
            {cta}
          </Button>
          <TxStatus state={tx.state} />
        </Panel>

        <div className="space-y-7 lg:col-span-5">
          <Panel className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <Label>Route</Label>
              {quote && quote.legs.length > 0 && (
                <span className="text-[10.5px] font-medium tracking-[0.08em] text-muted uppercase">
                  {quote.legs.length} leg{quote.legs.length > 1 ? 's' : ''} · one transaction
                </span>
              )}
            </div>
            {market.isLoading ? (
              <div className="mt-4 space-y-3">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
            ) : !market.data || (market.data.ranges.length === 0 && market.data.backstops.length === 0) ? (
              <p className="mt-4 text-[14px] text-muted">No live strategies yet. Add liquidity to open the pool.</p>
            ) : !quote || quote.legs.length === 0 ? (
              <p className="mt-4 text-[14px] text-muted">
                {outHalted
                  ? `Nobody pays out ${tOut.symbol} while it is halted. Pick a healthy coin to receive.`
                  : inHalted
                    ? `No backstop has room for ${tIn.symbol} right now.`
                    : 'Enter an amount to see how the trade splits.'}
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {quote.legs.map((leg) => {
                  const s = quote.strategies.find((x) => x.id === leg.id)
                  const share = Number((leg.amountIn * 10_000n) / quote.amountIn) / 100
                  return (
                    <li key={leg.id} className="rounded-xl border border-line bg-paper p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[12px] font-medium tracking-[0.04em]">{s ? shortAddress(s.maker) : '—'}</span>
                        <span className="flex gap-1.5">
                          {s && <KindTag kind={s.kind} />}
                          {s && <VenueTag kind={s.venue.kind} />}
                        </span>
                      </div>
                      <div className="mt-3 flex items-baseline justify-between">
                        <span className="num text-[14px]">
                          {formatAmount(leg.amountIn, tIn.decimals)} {tIn.symbol}
                          <span className="text-muted"> → {formatAmount(leg.amountOut, tOut.decimals)} {tOut.symbol}</span>
                        </span>
                        <span className="num text-[13.5px] text-muted">{share.toFixed(1)}%</span>
                      </div>
                      <div className="mt-2.5 h-2 overflow-hidden rounded-full border border-line bg-surface">
                        <div className="h-full bg-ink transition-[width] duration-300" style={{ width: `${share}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>

          <Panel className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <Label>Chainlink prices</Label>
              <span className="text-[10.5px] font-medium tracking-[0.08em] text-muted uppercase">guarded by CRE</span>
            </div>
            <ul className="mt-3 divide-y divide-line">
              {tokens.map((t) => {
                const p = priceOf(market.data, t)
                const selected = t.address === tokenOut
                return (
                  <li key={t.address}>
                    <button
                      type="button"
                      onClick={() => pick(t)}
                      aria-pressed={selected}
                      className={`flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-surface-hover ${
                        selected ? 'bg-surface-hover' : ''
                      }`}
                    >
                      <CoinDot symbol={t.symbol} />
                      <span className="w-14 text-[12px] font-medium tracking-[0.06em]">{t.symbol}</span>
                      <span className="text-[10.5px] font-medium tracking-[0.08em] text-muted uppercase">{CURRENCY[t.symbol]}</span>
                      <span className="num ml-auto text-[14px]">
                        {market.isLoading ? '…' : formatRate(p?.halted ? p.depegE18 : p?.priceE18, p?.fx ? 5 : 4)}
                      </span>
                      <StatusTag halted={p?.halted ?? false} />
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="caption mt-3">Pegged coins count at $1 unless CRE halts them. FX coins use live Chainlink rates. Tap a coin to receive it.</p>
          </Panel>
        </div>
      </div>
    </div>
  )
}
