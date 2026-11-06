'use client'

import { type LiveRange, depegSentinelAbi, stabrixBatchTakerAbi } from '@stabrix/sdk'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createWalletClient, http, parseEventLogs } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { TxStatus } from '@/components/tx-status'
import { OrbitMap, RANGE_COLORS } from '@/components/orbit-map'
import { Button, COIN_TONES, Label, Panel, SectionHead, Skeleton } from '@/components/ui'
import { type Series, ValueChart } from '@/components/value-chart'
import { ANVIL_ACCOUNTS, POLL_MS, RPC_URL } from '@/lib/config'
import { formatAmount, formatPrice, shortAddress } from '@/lib/format'
import { DEV_ACCOUNTS, setApiPrice, useApiPrices, useChainlinkPrices, useRanges, useSentinel, useStabrix } from '@/lib/stabrix'
import { useTx } from '@/lib/tx'

const CRASH_PRICE = 0.93

function markToMarket(r: LiveRange, prices: Record<string, number>, symbols: Record<string, string>) {
  return r.balances.reduce((sum, b, k) => {
    const symbol = symbols[r.config.tokens[k]!.toLowerCase()] ?? ''
    return sum + (Number(b) / 10 ** r.config.decimals[k]!) * (prices[symbol] ?? 1)
  }, 0)
}

export default function LabPage() {
  const { deployment, client, publicClient, chain, wallet, signer } = useStabrix()
  const ranges = useRanges()
  const sentinel = useSentinel()
  const feeds = useChainlinkPrices()
  const api = useApiPrices()
  const [target, setTarget] = useState(deployment.tokens.find((t) => t.symbol === 'USDe')?.address ?? deployment.tokens[0]!.address)
  const priceTx = useTx()
  const dumpTx = useTx()
  const guardTx = useTx()

  const symbols = useMemo(
    () => Object.fromEntries(deployment.tokens.map((t) => [t.address.toLowerCase(), t.symbol])),
    [deployment.tokens],
  )
  const coin = deployment.tokens.find((t) => t.address === target)!
  const statusOf = (addr: string) => sentinel.data?.find((s) => s.token.toLowerCase() === addr.toLowerCase())

  const baseline = useRef(new Map<string, number>())
  const [history, setHistory] = useState<Record<string, number[]>>({})
  useEffect(() => {
    if (!ranges.data) return
    const prices = api.data ?? {}
    setHistory((h) => {
      const next = { ...h }
      for (const r of ranges.data) {
        const value = markToMarket(r, prices, symbols)
        if (!baseline.current.has(r.hash)) baseline.current.set(r.hash, markToMarket(r, {}, symbols))
        const start = baseline.current.get(r.hash)!
        next[r.hash] = [...(h[r.hash] ?? []), ((value - start) / start) * 100].slice(-120)
      }
      return next
    })
  }, [ranges.data, api.data, symbols])

  const series: Series[] = (ranges.data ?? []).map((r, k) => ({
    id: r.hash,
    label: `${shortAddress(r.maker)} ${r.venue.kind === 'official' ? '1inch' : 'Stabrix'}`,
    color: RANGE_COLORS[k % RANGE_COLORS.length]!,
    points: history[r.hash] ?? [],
  }))

  const events = useQuery({
    queryKey: ['lab-events', deployment.sentinel],
    refetchInterval: POLL_MS,
    queryFn: async () => {
      const logs = await publicClient.getLogs({
        address: [deployment.sentinel, deployment.batchTaker],
        fromBlock: deployment.fromBlock,
        toBlock: 'latest',
      })
      const parsed = [
        ...parseEventLogs({ abi: depegSentinelAbi, logs, eventName: ['StatusUpdated', 'GuardianOverride'] }),
        ...parseEventLogs({ abi: stabrixBatchTakerAbi, logs, eventName: 'BatchSwapped' }),
      ]
      return parsed.sort((a, b) => Number(b.blockNumber - a.blockNumber) || b.logIndex - a.logIndex).slice(0, 14)
    },
  })

  const crash = (price: number) =>
    priceTx.run('Updating off-chain price', async () => {
      await setApiPrice(coin.symbol, price)
      return { message: `${coin.symbol} quoted at $${price.toFixed(2)} by the price API. The CRE sentinel reads it next run.` }
    })

  const dump = () =>
    dumpTx.run(`Dumping ${coin.symbol}`, async (progress) => {
      if (!wallet) throw new Error('Connect an account')
      const targets = deployment.tokens.filter((t) => t.address !== coin.address)
      let sold = 0n
      let stalled = 0
      for (let k = 0; stalled < targets.length && k < 60; k++) {
        const out = targets[k % targets.length]!
        const live = await client.listRanges()
        const halted = new Set((await client.sentinelStatus()).filter((s) => s.halted).map((s) => s.token.toLowerCase()))
        const quote = client.quoteExactIn(live, coin.address, out.address, 2_000n * 10n ** BigInt(coin.decimals), halted)
        if (quote.legs.length === 0 || quote.filled === 0n) {
          stalled++
          continue
        }
        try {
          await client.swap(wallet, { ...quote, amountIn: quote.filled }, 100)
          sold += quote.filled
          stalled = 0
          progress(`Sold ${formatAmount(sold, coin.decimals, 0)} ${coin.symbol} into the pool`)
        } catch {
          stalled++
        }
      }
      return {
        message:
          sold === 0n
            ? `Every range refused ${coin.symbol}. Nothing was absorbed.`
            : `Ranges absorbed ${formatAmount(sold, coin.decimals, 0)} ${coin.symbol}, then refused more.`,
      }
    })

  const guardian = (halt: boolean) =>
    guardTx.run(halt ? 'Halting' : 'Resuming', async () => {
      const key = ANVIL_ACCOUNTS.find((a) => a.label === 'Guardian')!.key
      const g = createWalletClient({ chain, account: privateKeyToAccount(key), transport: http(RPC_URL) })
      const hash = await g.writeContract({
        address: deployment.sentinel,
        abi: depegSentinelAbi,
        functionName: 'guardianSet',
        args: [coin.address, halt],
      })
      await publicClient.waitForTransactionReceipt({ hash })
      return { message: `${coin.symbol} ${halt ? 'halted' : 'resumed'} by guardian override.`, hash }
    })

  return (
    <div className="space-y-10">
      <SectionHead
        index="stabrix · 03 · depeg lab"
        title="Break a peg"
        aside={<p className="max-w-xs text-sm text-muted sm:text-right">Ranges stop at their edge. The Chainlink sentinel stops the coin sooner.</p>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {deployment.tokens.map((t) => {
          const s = statusOf(t.address)
          const selected = t.address === target
          return (
            <button
              key={t.address}
              type="button"
              aria-pressed={selected}
              onClick={() => setTarget(t.address)}
              className={`rounded-[var(--radius-card)] p-4 text-left text-tone-ink transition-[box-shadow,opacity] ${
                s?.halted ? 'bg-down' : (COIN_TONES[t.symbol] ?? 'bg-surface-hover')
              } ${selected ? 'shadow-[0_0_0_2px_var(--color-paper),0_0_0_4px_var(--color-ink)]' : 'opacity-85 hover:opacity-100'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold tracking-[0.02em]">{t.symbol}</span>
                <span className="rounded-full bg-tone-ink/12 px-2 py-0.5 text-[11px] font-medium">{s?.halted ? 'Halted' : 'Live'}</span>
              </div>
              <dl className="mt-4 space-y-1 border-t border-dashed border-tone-ink/25 pt-3 font-mono text-[11px]">
                <div className="flex justify-between">
                  <dt className="opacity-70">CHAINLINK</dt>
                  <dd className="num">{feeds.isLoading ? '…' : formatPrice(feeds.data?.[t.symbol])}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="opacity-70">PRICE API</dt>
                  <dd className="num">{api.isError ? 'offline' : api.data ? `$${(api.data[t.symbol] ?? 1).toFixed(4)}` : '…'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="opacity-70">SENTINEL</dt>
                  <dd className="num">{s?.observedAt ? formatPrice(s.priceE8) : 'no report'}</dd>
                </div>
              </dl>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Panel className="p-5 sm:p-6 lg:col-span-5">
          <Label>Scenario · {coin.symbol}</Label>
          <ol className="mt-5 space-y-7">
            <li>
              <p className="caption">01</p>
              <p className="mt-1 font-semibold">Break the peg off-chain</p>
              <p className="mt-1 text-sm text-muted">The price API is the fast signal. Chainlink feeds update on heartbeat.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="danger" busy={priceTx.state.status === 'pending'} onClick={() => crash(CRASH_PRICE)}>
                  Crash to ${CRASH_PRICE.toFixed(2)}
                </Button>
                <Button variant="ghost" onClick={() => crash(1)}>
                  Restore $1.00
                </Button>
              </div>
              <TxStatus state={priceTx.state} />
            </li>
            <li>
              <p className="caption">02</p>
              <p className="mt-1 font-semibold">Let Chainlink CRE react</p>
              <p className="mt-1 text-sm text-muted">The workflow reads both sources and writes a signed report to the sentinel.</p>
              <pre className="mt-3 rounded-2xl bg-paper p-3.5 font-mono text-xs break-all whitespace-pre-wrap text-muted">
                cd cre && cre workflow simulate depeg-sentinel --target fork-settings --broadcast
              </pre>
              {DEV_ACCOUNTS && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="ghost" busy={guardTx.state.status === 'pending'} onClick={() => guardian(true)}>
                    Guardian halt
                  </Button>
                  <Button variant="ghost" onClick={() => guardian(false)}>
                    Guardian resume
                  </Button>
                </div>
              )}
              <TxStatus state={guardTx.state} />
            </li>
            <li>
              <p className="caption">03</p>
              <p className="mt-1 font-semibold">Dump {coin.symbol} like an arbitrageur</p>
              <p className="mt-1 text-sm text-muted">
                Sells {coin.symbol} into every other coin until no range accepts it. Uses {signer?.label ?? 'the connected account'}.
              </p>
              <Button className="mt-3" busy={dumpTx.state.status === 'pending'} disabled={!wallet} onClick={dump}>
                Dump into pools
              </Button>
              <TxStatus state={dumpTx.state} />
            </li>
          </ol>
        </Panel>

        <div className="space-y-6 lg:col-span-7">
          <Panel className="p-5 sm:p-6">
            <div className="flex items-baseline justify-between gap-3">
              <Label>LP value vs deposit</Label>
              <span className="caption">MARKED TO PRICE API</span>
            </div>
            <div className="mt-5">{ranges.isLoading ? <Skeleton className="h-56" /> : <ValueChart series={series} />}</div>
          </Panel>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Panel className="p-5">
              <Label>Orbit map</Label>
              <div className="mt-4">
                {ranges.isLoading ? <Skeleton className="aspect-square" /> : <OrbitMap ranges={ranges.data ?? []} coins={deployment.tokens} />}
              </div>
            </Panel>

            <Panel className="p-5">
              <Label>On-chain events</Label>
              {events.isLoading ? (
                <Skeleton className="mt-4 h-24" />
              ) : events.isError ? (
                <p className="mt-4 text-sm text-down">Could not read events. Check the RPC.</p>
              ) : (events.data ?? []).length === 0 ? (
                <p className="mt-4 text-sm text-muted">No sentinel reports or swaps yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-dashed divide-line text-sm">
                  {events.data!.map((e) => (
                    <li key={`${e.transactionHash}-${e.logIndex}`} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0 truncate">
                        {e.eventName === 'BatchSwapped' && (
                          <>
                            Swap {symbols[e.args.tokenIn.toLowerCase()]} → {symbols[e.args.tokenOut.toLowerCase()]}
                          </>
                        )}
                        {e.eventName === 'StatusUpdated' && (
                          <>
                            <span className={e.args.halted ? 'text-down' : 'text-up'}>
                              CRE: {symbols[e.args.token.toLowerCase()]} {e.args.halted ? 'halted' : 'live'}
                            </span>{' '}
                            <span className="text-muted">at {formatPrice(e.args.priceE8)}</span>
                          </>
                        )}
                        {e.eventName === 'GuardianOverride' && (
                          <span className={e.args.halted ? 'text-down' : 'text-up'}>
                            Guardian: {symbols[e.args.token.toLowerCase()]} {e.args.halted ? 'halted' : 'resumed'}
                          </span>
                        )}
                      </span>
                      <span className="caption shrink-0">
                        #{String(e.blockNumber)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  )
}
