'use client'

import { type LiveRange, PRESETS, type PresetId, WAD, edgeUtilization } from '@stabrix/sdk'
import { useMemo, useState } from 'react'
import { OrbitMap } from '@/components/orbit-map'
import { TxStatus } from '@/components/tx-status'
import { Button, COIN_TONES, Label, Panel, SectionHead, Skeleton, VenueTag } from '@/components/ui'
import { formatAmount, formatUsd, shortAddress, toUnits } from '@/lib/format'
import { useBalances, useRanges, useStabrix } from '@/lib/stabrix'
import { useTx } from '@/lib/tx'

const PRESET_TONES: Record<PresetId, string> = {
  tight: 'bg-tone-signal',
  balanced: 'bg-tone-scan',
  wide: 'bg-tone-sand',
}

function rangeValue(r: LiveRange) {
  return r.balances.reduce((s, b, k) => s + Number(b) / 10 ** r.config.decimals[k]!, 0)
}

function presetOf(r: LiveRange): PresetId | null {
  const perCoin = r.balances.length ? rangeValue(r) / r.balances.length : 0
  if (!perCoin) return null
  const ratio = Number(r.config.floor / WAD) / perCoin
  return ratio > 20 ? 'tight' : ratio > 5 ? 'balanced' : 'wide'
}

export default function LiquidityPage() {
  const { deployment, client, signer, wallet } = useStabrix()
  const ranges = useRanges()
  const balances = useBalances(signer?.address)
  const [preset, setPreset] = useState<PresetId>('balanced')
  const [venue, setVenue] = useState<'native' | 'official'>('native')
  const [text, setText] = useState('10000')
  const tx = useTx()
  const dock = useTx()

  const perCoin = toUnits(text, 18)
  const tokens = useMemo(
    () => [...deployment.tokens].sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1)),
    [deployment.tokens],
  )
  const short = tokens.find((t) => {
    const have = balances.data?.[deployment.tokens.indexOf(t)]
    return perCoin && have !== undefined && have < (perCoin * 10n ** BigInt(t.decimals)) / WAD
  })
  const mine = (ranges.data ?? []).filter((r) => signer && r.maker.toLowerCase() === signer.address.toLowerCase())

  let cta = 'Add liquidity'
  let blocked = false
  if (!wallet) [cta, blocked] = ['Connect an account', true]
  else if (!perCoin || perCoin === 0n) [cta, blocked] = ['Enter an amount', true]
  else if (short) [cta, blocked] = [`Not enough ${short.symbol}`, true]

  const ship = () =>
    tx.run('Preparing range', async (progress) => {
      if (!wallet || !perCoin) throw new Error('Not ready')
      const config = client.buildRange(preset, perCoin)
      progress('Approving Aqua for each coin, then shipping the range')
      const v = venue === 'native' ? ({ kind: 'native' } as const) : ({ kind: 'official', extruction: deployment.extruction } as const)
      const done = await client.ship(wallet, config, perCoin, v)
      return { message: `Range live. Funds stay in ${shortAddress(wallet.account.address)}.`, hash: done.hash }
    })

  return (
    <div className="space-y-12">
      <SectionHead
        index="stabrix · 02 · liquidity"
        title="Provide liquidity"
        aside={<p className="max-w-xs text-sm text-muted sm:text-right">Your coins stay in your wallet. Aqua only records what the range may use.</p>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Panel className="p-5 sm:p-6 lg:col-span-7">
          <fieldset>
            <legend className="sr-only">Range width</legend>
            <Label>Range</Label>
            <div className="mt-4 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Range width">
              {PRESETS.map((p) => {
                const active = preset === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPreset(p.id)}
                    className={`rounded-[var(--radius-card)] p-4 text-left text-tone-ink transition-[transform,box-shadow] ${PRESET_TONES[p.id]} ${
                      active ? 'shadow-[0_0_0_2px_var(--color-paper),0_0_0_4px_var(--color-ink)]' : 'opacity-80 hover:opacity-100'
                    }`}
                  >
                    <span className="block text-[13px] font-semibold uppercase tracking-[0.06em]">{p.label}</span>
                    <span className="num mt-4 block text-4xl font-semibold tracking-tight">{p.concentration + 1}x</span>
                    <span className="block text-xs opacity-70">capital efficiency</span>
                    <span className="mt-4 block border-t border-dashed border-tone-ink/25 pt-3 font-mono text-[11px]">
                      STOPS AT {(p.maxDeviationBps / 100).toFixed(1)}% DEPEG
                      <br />
                      FEE {(p.feeBps / 100).toFixed(2)}%
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <fieldset className="mt-8">
            <legend className="sr-only">Venue</legend>
            <Label>Venue</Label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Venue">
              {(
                [
                  ['native', 'Stabrix router', 'SwapVM with the native StabrixTick instruction'],
                  ['official', '1inch SwapVM', 'Official deployed router, priced through Extruction'],
                ] as const
              ).map(([id, title, sub]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={venue === id}
                  onClick={() => setVenue(id)}
                  className={`rounded-2xl p-4 text-left transition-colors ${
                    venue === id ? 'bg-ink text-paper' : 'bg-paper text-ink hover:bg-surface-hover'
                  }`}
                >
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className={`mt-1 block text-xs ${venue === id ? 'text-paper/70' : 'text-muted'}`}>{sub}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mt-8">
            <label htmlFor="per-coin" className="label">
              <span className="size-2 shrink-0 border-[1.5px] border-current" aria-hidden />
              Deposit per coin (USD)
            </label>
            <input
              id="per-coin"
              inputMode="decimal"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={text !== '' && perCoin === null}
              className="num mt-4 h-14 w-full rounded-2xl bg-paper px-5 text-2xl font-semibold tracking-tight outline-none focus-visible:outline-2 focus-visible:outline-accent"
            />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tokens.map((t) => {
                const have = balances.data?.[deployment.tokens.indexOf(t)]
                return (
                  <span key={t.address} className="inline-flex items-center gap-1.5 rounded-full bg-paper px-2.5 py-1 font-mono text-[11px] text-muted">
                    <span className={`size-2 rounded-full ${COIN_TONES[t.symbol] ?? 'bg-muted'}`} aria-hidden />
                    {t.symbol} {have === undefined ? '—' : formatAmount(have, t.decimals, 0)}
                  </span>
                )
              })}
            </div>
          </div>

          <Button className="mt-8 w-full" disabled={blocked} busy={tx.state.status === 'pending'} onClick={ship}>
            {cta}
          </Button>
          <TxStatus state={tx.state} />
        </Panel>

        <div className="space-y-6 lg:col-span-5">
          <Panel className="p-5 sm:p-6">
            <Label>Orbit map</Label>
            <div className="mt-4">
              {ranges.isLoading ? <Skeleton className="aspect-square" /> : <OrbitMap ranges={ranges.data ?? []} coins={deployment.tokens} />}
            </div>
          </Panel>
          <Panel className="p-5 sm:p-6">
            <Label>How a range works</Label>
            <ol className="mt-4 space-y-4 text-sm">
              {[
                ['Coins stay in your wallet', 'Aqua records an allowance. Tokens move only when a trade fills.'],
                ['One range, every pair', `Priced on an Orbital sphere across all ${tokens.length} coins.`],
                ['Depegs stop at the edge', 'A crashing coin pushes the range to its edge, then it is refused.'],
                ['Chainlink halts sooner', 'The CRE sentinel halts a coin when its price breaks.'],
              ].map(([head, body], k) => (
                <li key={head} className="flex gap-3">
                  <span className="caption pt-0.5">0{k + 1}</span>
                  <span>
                    <span className="block font-medium">{head}</span>
                    <span className="block text-muted">{body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>

      <section aria-labelledby="positions" className="space-y-4">
        <Label id="positions">Your ranges</Label>
        {ranges.isLoading ? (
          <Skeleton className="h-36" />
        ) : mine.length === 0 ? (
          <Panel className="p-6 text-sm text-muted">No ranges for this account yet. Add one above.</Panel>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {mine.map((r) => (
              <RangeCard
                key={`${r.app}${r.hash}`}
                range={r}
                busy={dock.state.status === 'pending'}
                onDock={() =>
                  dock.run('Closing range', async () => {
                    if (!wallet) throw new Error('Connect an account')
                    const receipt = await client.dock(wallet, r)
                    return { message: 'Range closed. Allowance released.', hash: receipt.transactionHash }
                  })
                }
              />
            ))}
          </div>
        )}
        <TxStatus state={dock.state} />
      </section>

      <section aria-labelledby="all-ranges" className="space-y-4">
        <Label id="all-ranges">All ranges</Label>
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-dashed border-line text-left">
                {['LP', 'Venue', 'Range', 'Value', 'Fee', 'Range used'].map((h) => (
                  <th key={h} scope="col" className="caption px-5 py-3.5 font-normal">
                    {h.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(ranges.data ?? []).map((r) => (
                <tr key={`${r.app}${r.hash}`} className="border-b border-surface-line last:border-0">
                  <td className="px-5 py-3.5 font-mono text-xs">{shortAddress(r.maker)}</td>
                  <td className="px-5 py-3.5">
                    <VenueTag kind={r.venue.kind} />
                  </td>
                  <td className="px-5 py-3.5 capitalize">{presetOf(r) ?? '—'}</td>
                  <td className="num px-5 py-3.5 font-mono">{formatUsd(rangeValue(r), 0)}</td>
                  <td className="num px-5 py-3.5 font-mono">{(r.config.feeBps / 100).toFixed(2)}%</td>
                  <td className="px-5 py-3.5">
                    <EdgeBar used={edgeUtilization(r.balances, r.rates, r.range)} />
                  </td>
                </tr>
              ))}
              {ranges.data?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-muted">
                    No live ranges.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
      </section>
    </div>
  )
}

function EdgeBar({ used }: { used: number }) {
  const pct = Math.round(used * 100)
  const color = used > 0.85 ? 'bg-down' : used > 0.5 ? 'bg-tone-sand' : 'bg-accent'
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-line"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Share of range used"
      >
        <div className={`h-full rounded-full ${color} transition-[width] duration-300`} style={{ width: `${pct}%` }} />
      </div>
      <span className="num font-mono text-xs text-muted">{pct}%</span>
    </div>
  )
}

function RangeCard({ range, onDock, busy }: { range: LiveRange; onDock: () => void; busy: boolean }) {
  const { deployment } = useStabrix()
  const preset = presetOf(range)
  return (
    <Panel className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="caption">{preset ? `// ${preset.toUpperCase()} RANGE` : '// CUSTOM RANGE'}</p>
          <p className="num mt-2 text-3xl font-semibold tracking-tight">{formatUsd(rangeValue(range), 0)}</p>
        </div>
        <VenueTag kind={range.venue.kind} />
      </div>
      <ul className="mt-5 grid grid-cols-5 gap-1.5">
        {range.config.tokens.map((t, k) => {
          const info = deployment.tokens.find((x) => x.address.toLowerCase() === t.toLowerCase())
          return (
            <li key={t} className={`rounded-xl p-2 text-tone-ink ${COIN_TONES[info?.symbol ?? ''] ?? 'bg-surface-hover'}`}>
              <span className="block text-[10px] font-semibold uppercase">{info?.symbol}</span>
              <span className="num block truncate font-mono text-xs">{formatAmount(range.balances[k]!, range.config.decimals[k]!, 0)}</span>
            </li>
          )
        })}
      </ul>
      <div className="rule my-4" />
      <div className="flex items-center justify-between">
        <EdgeBar used={edgeUtilization(range.balances, range.rates, range.range)} />
        <Button variant="ghost" className="min-h-10" busy={busy} onClick={onDock}>
          Close range
        </Button>
      </div>
    </Panel>
  )
}
