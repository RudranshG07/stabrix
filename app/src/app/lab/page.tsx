'use client'

import { type TokenInfo, stabrixBatchTakerAbi, stabrixOracleAbi } from '@stabrix/sdk'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createWalletClient, http, parseEventLogs } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { OrbitMap, RANGE_COLORS } from '@/components/orbit-map'
import { TxStatus } from '@/components/tx-status'
import { Button, CoinDot, KindTag, Label, Panel, SectionHead, Skeleton, Tag } from '@/components/ui'
import { type Series, ValueChart } from '@/components/value-chart'
import { CURRENCY } from '@/lib/coins'
import { ANVIL_ACCOUNTS, POLL_MS, RPC_URL } from '@/lib/config'
import { formatAmount, formatRate, shortAddress } from '@/lib/format'
import { priceOf, withoutMaker } from '@/lib/market'
import {
  DEV_ACCOUNTS,
  clearApiPrice,
  setApiPrice,
  useApiPrices,
  useChainlinkPrices,
  useMarket,
  useOracleStatus,
  useStabrix,
} from '@/lib/stabrix'
import { type LiveStrategy, strategyUsd, valueUsd } from '@/lib/strategy'
import { useTx } from '@/lib/tx'

const CRASH = 0.93
const DUMP_USD = 2_000n
const EVENT_WINDOW = 9_000n
const CRE_COMMAND = 'cd cre && cre workflow simulate depeg-sentinel -T fork-settings --broadcast --non-interactive --trigger-index 0'
const small = 'text-[10.5px] font-bold tracking-[0.14em] uppercase'

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[2.25rem_1fr] gap-x-3">
      <span className="num pt-0.5 text-[22px] leading-none text-muted">{n}</span>
      <div className="min-w-0">
        <p className="font-display text-[22px] leading-tight">{title}</p>
        <div className="mt-1.5 space-y-3">{children}</div>
      </div>
    </li>
  )
}

function Copyable({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="flex items-start gap-2 rounded-[16px] border-2 border-surface-line bg-paper p-3">
      <code className="min-w-0 flex-1 font-mono text-[11.5px] leading-relaxed break-all">{text}</code>
      <button
        type="button"
        aria-label="Copy command"
        onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true))}
        onBlur={() => setDone(false)}
        className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-surface-line bg-surface transition-colors hover:bg-surface-hover"
      >
        {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
    </div>
  )
}

function labelOf(s: LiveStrategy) {
  return `${shortAddress(s.maker)} ${s.kind === 'backstop' ? 'backstop' : 'range'} · ${s.venue.kind === 'official' ? '1inch' : 'Stabrix'}`
}

export default function LabPage() {
  const { deployment, client, publicClient, chain, wallet, signer } = useStabrix()
  const market = useMarket()
  const oracle = useOracleStatus()
  const feeds = useChainlinkPrices()
  const api = useApiPrices()
  const fork = DEV_ACCOUNTS
  const [target, setTarget] = useState(deployment.tokens.find((t) => t.symbol === 'USDe')?.address ?? deployment.tokens[0]!.address)
  const priceTx = useTx()
  const guardTx = useTx()
  const dumpTx = useTx()

  const coin = deployment.tokens.find((t) => t.address === target)!
  const statusOf = (t: TokenInfo) => oracle.data?.find((s) => s.token.toLowerCase() === t.address.toLowerCase())
  const symbolOf = (a: string) => deployment.tokens.find((t) => t.address.toLowerCase() === a.toLowerCase())?.symbol ?? shortAddress(a)

  const baseline = useRef(new Map<string, number>())
  const [history, setHistory] = useState<Record<string, number[]>>({})
  useEffect(() => {
    const m = market.data
    if (!m) return
    setHistory((h) => {
      const next: Record<string, number[]> = {}
      for (const s of [...m.ranges, ...m.backstops]) {
        const now = strategyUsd(s, m.prices)
        if (!baseline.current.has(s.id)) {
          const face = s.config.tokens.reduce((sum, t, k) => {
            const info = m.prices.get(t.toLowerCase())
            return sum + valueUsd(s.balances[k] ?? 0n, s.config.decimals[k]!, info ? { ...info, halted: false } : undefined)
          }, 0)
          baseline.current.set(s.id, face)
        }
        const start = baseline.current.get(s.id)!
        next[s.id] = [...(h[s.id] ?? []), start > 0 ? ((now - start) / start) * 100 : 0].slice(-120)
      }
      return next
    })
  }, [market.data])

  const strategies: LiveStrategy[] = market.data ? [...market.data.ranges, ...market.data.backstops] : []
  const series: Series[] = strategies.map((s, k) => ({
    id: s.id,
    label: labelOf(s),
    color: RANGE_COLORS[k % RANGE_COLORS.length]!,
    dashed: s.kind === 'backstop',
    points: history[s.id] ?? [],
  }))

  const events = useQuery({
    queryKey: ['lab-events', deployment.oracle, deployment.batchTaker],
    refetchInterval: POLL_MS,
    queryFn: async () => {
      const latest = await publicClient.getBlockNumber()
      const from = latest > deployment.fromBlock + EVENT_WINDOW ? latest - EVENT_WINDOW : deployment.fromBlock
      const logs = await publicClient.getLogs({ address: [deployment.oracle, deployment.batchTaker], fromBlock: from, toBlock: latest })
      const parsed = [
        ...parseEventLogs({ abi: stabrixOracleAbi, logs, eventName: ['StatusUpdated', 'GuardianOverride'] }),
        ...parseEventLogs({ abi: stabrixBatchTakerAbi, logs, eventName: 'BatchSwapped' }),
      ]
      return parsed.sort((a, b) => Number(b.blockNumber - a.blockNumber) || b.logIndex - a.logIndex).slice(0, 6)
    },
  })

  const peg = priceOf(market.data, coin)?.priceE18
  const crashTo = peg ? (Number(peg) / 1e18) * CRASH : CRASH
  const overridden = api.data?.[coin.symbol] !== undefined

  const crash = () =>
    priceTx.run('Updating the price API', async () => {
      await setApiPrice(coin.symbol, crashTo)
      return { message: `${coin.symbol} now quotes ${formatRate(BigInt(Math.round(crashTo * 1e18)), 5)} off-chain, 7% under its peg. Run the CRE workflow next.` }
    })

  const restore = () =>
    priceTx.run('Clearing the override', async () => {
      await clearApiPrice(coin.symbol)
      return { message: `${coin.symbol} price override cleared. CRE resumes it once Chainlink and the API agree.` }
    })

  const guardian = (halt: boolean) =>
    guardTx.run(halt ? 'Halting' : 'Resuming', async () => {
      const key = ANVIL_ACCOUNTS.find((a) => a.label === 'Guardian')!.key
      const g = createWalletClient({ chain, account: privateKeyToAccount(key), transport: http(RPC_URL) })
      const hash = await g.writeContract({ address: deployment.oracle, abi: stabrixOracleAbi, functionName: 'guardianSet', args: [coin.address, halt] })
      await publicClient.waitForTransactionReceipt({ hash })
      return { message: `${coin.symbol} ${halt ? 'halted' : 'resumed'} by the guardian.`, hash }
    })

  const dump = () =>
    dumpTx.run(`Selling ${coin.symbol}`, async (progress) => {
      if (!wallet) throw new Error('Connect an account')
      const price = priceOf(market.data, coin)
      const mark = price?.halted ? (price.depegE18 ?? price.priceE18) : price?.priceE18
      if (!mark) throw new Error(`No price for ${coin.symbol}`)
      const chunk = (DUMP_USD * 10n ** 18n * 10n ** BigInt(coin.decimals)) / mark
      const outs = deployment.tokens.filter((t) => t.address !== coin.address)
      let sold = 0n
      let stalled = 0
      for (let k = 0; stalled < outs.length && k < 60; k++) {
        const out = outs[k % outs.length]!
        const live = withoutMaker(await client.market(), wallet.account.address)
        const quote = client.quoteExactIn(live, coin.address, out.address, chunk)
        if (quote.legs.length === 0 || quote.filled === 0n) {
          stalled++
          continue
        }
        try {
          await client.swap(wallet, { ...quote, amountIn: quote.filled }, 100)
          sold += quote.filled
          stalled = 0
          progress(`Sold ${formatAmount(sold, coin.decimals, 0)} ${coin.symbol}`)
        } catch {
          stalled++
        }
      }
      const halted = priceOf(market.data, coin)?.halted
      return {
        message:
          sold === 0n
            ? `Nothing accepted ${coin.symbol}. ${halted ? 'Ranges refuse it and the backstops are full.' : 'Every range is at its edge.'}`
            : `Sold ${formatAmount(sold, coin.decimals, 0)} ${coin.symbol} ${halted ? 'to the backstops' : 'into the ranges'}, then nothing took more.`,
      }
    })

  return (
    <div className="space-y-12">
      <SectionHead
        index="Stabrix · 03"
        title="Depeg"
        aside={
          <p className="font-serif max-w-sm text-[17px] leading-snug text-muted sm:text-right">
            Break a coin and watch the system answer. Ranges stop at their edge, Chainlink CRE halts the coin, backstops buy it below market.
          </p>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {deployment.tokens.map((t) => {
          const s = statusOf(t)
          const p = priceOf(market.data, t)
          const selected = t.address === target
          const feed = feeds.data?.[t.symbol]
          const fx = p?.fx ?? false
          return (
            <button
              key={t.address}
              type="button"
              aria-pressed={selected}
              onClick={() => setTarget(t.address)}
              className={`rounded-[20px] border-2 border-surface-line p-3.5 text-left transition-[box-shadow,background-color] ${
                s?.halted ? 'bg-down/15' : 'bg-surface'
              } ${selected ? 'shadow-[0_4px_0_0_var(--color-surface-line)]' : 'hover:bg-surface-hover'}`}
            >
              <span className="flex items-center gap-2">
                <CoinDot symbol={t.symbol} />
                <span className="text-[12.5px] font-bold tracking-[0.06em]">{t.symbol}</span>
                <span className="hidden text-[10px] font-bold tracking-[0.12em] text-muted sm:inline">{CURRENCY[t.symbol]}</span>
                <span className="ml-auto">
                  {s?.halted ? <Tag dot="var(--color-down)">{s.guardianHalted && !s.creHalted ? 'Guardian' : 'Halted'}</Tag> : <Tag dot="var(--color-up)">Live</Tag>}
                </span>
              </span>
              <dl className="mt-3 space-y-1 border-t-2 border-dashed border-line pt-2.5 text-[11px]">
                {(
                  [
                    ['Chainlink', feed == null ? '—' : formatRate(feed * 10n ** 10n, fx ? 5 : 4)],
                    ['CRE', s?.observedAt ? formatRate(s.reportedE18, fx ? 5 : 4) : 'none'],
                    ...(fork ? [['API', api.isError ? 'offline' : api.data?.[t.symbol] !== undefined ? `$${api.data[t.symbol]!.toPrecision(5)}` : 'market'] as const] : []),
                    ['Pool', p == null ? '—' : formatRate(p.halted ? (p.depegE18 ?? p.priceE18) : p.priceE18, fx ? 5 : 4)],
                  ] as const
                ).map(([term, value]) => (
                  <div key={term} className="flex justify-between gap-2">
                    <dt className="font-bold tracking-[0.08em] text-muted uppercase">{term}</dt>
                    <dd className="num text-[13px]">{value}</dd>
                  </div>
                ))}
              </dl>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-7 lg:grid-cols-12">
        <Panel className="p-5 sm:p-7 lg:col-span-5 lg:self-start">
          <Label>Scenario · {coin.symbol}</Label>
          <ol className="mt-6 space-y-8">
            <Step n="1" title={`Break ${coin.symbol} off-chain`}>
              <p className="text-[14px] text-muted">
                Price APIs move first. Chainlink feeds follow on deviation or heartbeat.
                {fork ? ' On this fork the price API is local.' : ''}
              </p>
              {fork && (
                <>
                  <div className="flex flex-wrap gap-2.5">
                    <Button variant="danger" size="sm" busy={priceTx.state.status === 'pending'} onClick={crash}>
                      Crash to {formatRate(BigInt(Math.round(crashTo * 1e18)), crashTo < 0.01 ? 7 : 4)}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={!overridden} onClick={restore}>
                      Restore
                    </Button>
                  </div>
                  <TxStatus state={priceTx.state} />
                </>
              )}
            </Step>

            <Step n="2" title="Chainlink CRE halts it">
              <p className="text-[14px] text-muted">
                Every 30 seconds the workflow reads Chainlink feeds and price APIs, agrees across nodes, and writes a signed report. More than 3% off peg halts
                the coin everywhere.
              </p>
              {fork && <Copyable text={CRE_COMMAND} />}
              {fork && (
                <>
                  <div className="flex flex-wrap gap-2.5">
                    <Button variant="ghost" size="sm" busy={guardTx.state.status === 'pending'} onClick={() => guardian(true)}>
                      Guardian halt
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => guardian(false)}>
                      Resume
                    </Button>
                  </div>
                  <TxStatus state={guardTx.state} />
                </>
              )}
            </Step>

            <Step n="3" title={`Arbitrageurs dump ${coin.symbol}`}>
              <p className="text-[14px] text-muted">
                Before a halt, ranges absorb the coin until their edge. After it, ranges refuse it and only backstops buy, below market and never above face.
              </p>
              {fork && (
                <>
                  <Button size="sm" busy={dumpTx.state.status === 'pending'} disabled={!wallet} onClick={dump}>
                    Dump {coin.symbol} as {signer?.label ?? 'this account'}
                  </Button>
                  <TxStatus state={dumpTx.state} />
                </>
              )}
            </Step>
          </ol>
        </Panel>

        <div className="space-y-7 lg:col-span-7">
          <Panel className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <Label>Strategy value</Label>
              <span className={`${small} text-muted`}>change since this page opened</span>
            </div>
            <div className="mt-5">{market.isLoading ? <Skeleton className="h-56" /> : <ValueChart series={series} />}</div>
          </Panel>

          <div className="grid grid-cols-1 gap-7 md:grid-cols-2">
            <Panel className="p-5">
              <Label>Orbit map</Label>
              <div className="mt-4">
                {market.isLoading ? <Skeleton className="aspect-square" /> : <OrbitMap ranges={market.data?.ranges ?? []} coins={deployment.tokens} />}
              </div>
            </Panel>

            <Panel className="p-5">
              <Label>On-chain events</Label>
              {events.isLoading ? (
                <Skeleton className="mt-4 h-40" />
              ) : events.isError ? (
                <p className="mt-4 text-[14px] text-down">Could not read events from the RPC.</p>
              ) : (events.data ?? []).length === 0 ? (
                <p className="font-serif mt-4 text-[16px] text-muted">No CRE reports or swaps yet.</p>
              ) : (
                <ul className="mt-3 divide-y-2 divide-dashed divide-line">
                  {events.data!.map((e) => (
                    <li key={`${e.transactionHash}-${e.logIndex}`} className="flex items-baseline justify-between gap-3 py-2.5 text-[13.5px]">
                      <span className="min-w-0 truncate">
                        {e.eventName === 'BatchSwapped' && (
                          <>
                            {symbolOf(e.args.tokenIn)} → {symbolOf(e.args.tokenOut)}{' '}
                            <span className="text-muted">· {String(e.args.legs)} leg{e.args.legs > 1n ? 's' : ''}</span>
                          </>
                        )}
                        {e.eventName === 'StatusUpdated' && (
                          <>
                            <span className={`font-semibold ${e.args.halted ? 'text-down' : 'text-up'}`}>
                              CRE {e.args.halted ? 'halted' : 'priced'} {symbolOf(e.args.token)}
                            </span>{' '}
                            <span className="num text-muted">{formatRate(e.args.priceE18, 5)}</span>
                          </>
                        )}
                        {e.eventName === 'GuardianOverride' && (
                          <span className={`font-semibold ${e.args.halted ? 'text-down' : 'text-up'}`}>
                            Guardian {e.args.halted ? 'halted' : 'resumed'} {symbolOf(e.args.token)}
                          </span>
                        )}
                      </span>
                      <span className="num shrink-0 text-[13px] text-muted">#{String(e.blockNumber)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel className="p-5 sm:p-6">
            <Label>Who holds the risk</Label>
            {market.isLoading ? (
              <Skeleton className="mt-4 h-28" />
            ) : (
              <ul className="mt-3 divide-y-2 divide-dashed divide-line">
                {strategies.map((s) => {
                  const k = s.config.tokens.findIndex((t) => t.toLowerCase() === coin.address.toLowerCase())
                  const held = k >= 0 ? (s.balances[k] ?? 0n) : 0n
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                      <KindTag kind={s.kind} />
                      <span className="text-[12px] font-bold tracking-[0.04em]">{shortAddress(s.maker)}</span>
                      <span className="num ml-auto text-[16px]">
                        {formatAmount(held, coin.decimals, 0)} {coin.symbol}
                      </span>
                      <span className="num w-24 text-right text-[14px] text-muted">
                        {market.data ? `$${Math.round(valueUsd(held, coin.decimals, priceOf(market.data, coin))).toLocaleString('en-US')}` : '—'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
