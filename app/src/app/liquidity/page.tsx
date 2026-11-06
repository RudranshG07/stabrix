'use client'

import { type Market, PRESETS, type PresetId, type TokenInfo, type Venue } from '@stabrix/sdk'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { StrategyStatus, settingOf } from '@/components/strategies'
import { TxStatus } from '@/components/tx-status'
import { Button, COIN_TONES, CoinDot, KindTag, Label, Panel, SectionHead, Skeleton, VenueTag } from '@/components/ui'
import { CURRENCY } from '@/lib/coins'
import { formatAmount, formatUsd, toUnits } from '@/lib/format'
import { priceOf } from '@/lib/market'
import { useBalances, useMarket, useStabrix } from '@/lib/stabrix'
import {
  BACKSTOP_PRESETS,
  type BackstopPresetId,
  type LiveStrategy,
  backstopFill,
  isMine,
  shortCoins,
  strategyUsd,
  valueUsd,
} from '@/lib/strategy'
import { useTx } from '@/lib/tx'

type Mode = 'range' | 'backstop'
type VenueId = 'native' | 'official'

const PRESET_TONES: Record<PresetId, string> = {
  tight: 'bg-tone-signal',
  balanced: 'bg-tone-scan',
  wide: 'bg-tone-sand',
}

const SAMPLE_DEPEG = 0.93
const small = 'text-[10.5px] font-bold tracking-[0.14em] uppercase'

function Field({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[20px] border-2 border-surface-line bg-paper ${className}`}>{children}</div>
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-1.5 rounded-full border-[3px] border-surface-line bg-paper p-1">
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`font-pill min-h-11 rounded-full px-4 pt-[3px] text-[14px] tracking-[0.02em] uppercase transition-colors ${
            value === id ? 'bg-ink text-on-accent' : 'hover:bg-surface-hover'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

function CoinToggle({
  token,
  balance,
  usd,
  selected,
  onToggle,
}: {
  token: TokenInfo
  balance: bigint | undefined
  usd: number
  selected: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={`flex min-h-16 w-full flex-col justify-center rounded-[18px] border-2 px-3.5 py-2.5 text-left transition-colors ${
        selected ? 'border-surface-line bg-surface shadow-[0_3px_0_0_var(--color-surface-line)]' : 'border-line bg-paper opacity-70 hover:opacity-100'
      }`}
    >
      <span className="flex items-center gap-2">
        <CoinDot symbol={token.symbol} />
        <span className="text-[12px] font-bold tracking-[0.06em]">{token.symbol}</span>
        <span className="ml-auto text-[10px] font-bold tracking-[0.12em] text-muted">{CURRENCY[token.symbol]}</span>
      </span>
      <span className="num mt-1 truncate text-[15px] text-muted">{balance === undefined ? '—' : usd > 0 ? formatUsd(usd, 0) : 'none held'}</span>
    </button>
  )
}

function VenuePicker({ value, onChange }: { value: VenueId; onChange: (v: VenueId) => void }) {
  return (
    <div className="mt-3 grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Venue">
      {(
        [
          ['native', 'Stabrix router', 'SwapVM with Stabrix opcodes'],
          ['official', '1inch router', "1inch's deployed SwapVM, via Extruction"],
        ] as const
      ).map(([id, title, sub]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`rounded-[18px] border-2 px-4 py-3 text-left transition-colors ${
            value === id ? 'border-surface-line bg-ink text-on-accent' : 'border-surface-line bg-paper hover:bg-surface-hover'
          }`}
        >
          <span className="block text-[13px] font-bold tracking-[0.04em]">{title}</span>
          <span className={`mt-0.5 block text-[12.5px] ${value === id ? 'text-on-accent/70' : 'text-muted'}`}>{sub}</span>
        </button>
      ))}
    </div>
  )
}

function UsdInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field className="flex items-center gap-3 px-5 py-3">
      <label htmlFor={id} className={`${small} shrink-0`}>
        {label}
      </label>
      <span className="num ml-auto text-[28px] text-muted">$</span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={value !== '' && toUnits(value, 18) === null}
        className="num w-36 min-w-0 bg-transparent text-right text-[28px] outline-none sm:w-44"
      />
    </Field>
  )
}

function NeedList({ rows }: { rows: { token: TokenInfo; need: bigint; have: bigint | undefined }[] }) {
  if (rows.length === 0) return null
  return (
    <ul className="mt-3 divide-y-2 divide-dashed divide-line">
      {rows.map(({ token, need, have }) => {
        const short = have !== undefined && need > have
        return (
          <li key={token.address} className="flex items-center gap-3 py-2">
            <CoinDot symbol={token.symbol} />
            <span className="w-14 text-[12px] font-bold tracking-[0.06em]">{token.symbol}</span>
            <span className={`num ml-auto text-[16px] ${short ? 'text-down' : ''}`}>{formatAmount(need, token.decimals, 2)}</span>
            <span className="num w-32 text-right text-[14px] text-muted">of {have === undefined ? '—' : formatAmount(have, token.decimals, 0)}</span>
          </li>
        )
      })}
    </ul>
  )
}

function units(usdText: string, token: TokenInfo, market: Market | undefined): bigint | null {
  const usd = toUnits(usdText, 18)
  const p = priceOf(market, token)?.priceE18
  if (usd === null || p == null) return null
  return (usd * 10n ** BigInt(token.decimals)) / p
}

function venueOf(id: VenueId, target: string): Venue {
  return id === 'native' ? { kind: 'native' } : { kind: 'official', extruction: target as `0x${string}` }
}

function RangeForm({ held, balances, market }: { held: TokenInfo[]; balances: bigint[] | undefined; market: Market | undefined }) {
  const { deployment, client, wallet } = useStabrix()
  const [picked, setPicked] = useState<string[] | null>(null)
  const [preset, setPreset] = useState<PresetId>('balanced')
  const [venue, setVenue] = useState<VenueId>('native')
  const [text, setText] = useState('1000')
  const tx = useTx()

  const tokens = deployment.tokens
  const selected = picked ?? held.map((t) => t.address)
  const chosen = tokens.filter((t) => selected.includes(t.address))
  const perCoin = toUnits(text, 18)
  const rows = chosen.map((t) => ({ token: t, need: units(text, t, market) ?? 0n, have: balances?.[tokens.indexOf(t)] }))
  const short = rows.find((r) => r.have !== undefined && r.need > r.have)
  const missingPrice = chosen.find((t) => priceOf(market, t)?.priceE18 == null)
  const total = perCoin ? (Number(perCoin) / 1e18) * chosen.length : 0

  const toggle = (address: string) =>
    setPicked((cur) => {
      const base = cur ?? held.map((t) => t.address)
      return base.includes(address) ? base.filter((a) => a !== address) : [...base, address]
    })

  let cta = 'Open FX range'
  let blocked = false
  if (!wallet) [cta, blocked] = ['Connect an account', true]
  else if (chosen.length < 2) [cta, blocked] = ['Pick at least two coins', true]
  else if (!perCoin || perCoin === 0n) [cta, blocked] = ['Enter an amount', true]
  else if (missingPrice) [cta, blocked] = [`No live price for ${missingPrice.symbol}`, true]
  else if (short) [cta, blocked] = [`Not enough ${short.token.symbol}`, true]

  const open = () =>
    tx.run('Preparing the range', async (progress) => {
      if (!wallet || !perCoin) throw new Error('Not ready')
      const config = client.buildRange(preset, perCoin, { tokens: chosen.map((t) => t.address) })
      progress(`Approving Aqua for ${chosen.length} coins, then shipping the range`)
      const done = await client.ship(wallet, config, perCoin, venueOf(venue, deployment.extruction))
      return { message: `FX range live over ${chosen.length} coins. Nothing left your wallet.`, hash: done.hash }
    })

  return (
    <div className="space-y-7">
      <fieldset>
        <legend className="contents">
          <Label>Coins</Label>
        </legend>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tokens.map((t, k) => (
            <CoinToggle
              key={t.address}
              token={t}
              balance={balances?.[k]}
              usd={valueUsd(balances?.[k] ?? 0n, t.decimals, priceOf(market, t))}
              selected={selected.includes(t.address)}
              onToggle={() => toggle(t.address)}
            />
          ))}
        </div>
        <p className="caption mt-2.5">One range trades every pair among the coins you pick. Defaults to the coins this wallet holds.</p>
      </fieldset>

      <fieldset>
        <legend className="contents">
          <Label>Width</Label>
        </legend>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-3" role="radiogroup" aria-label="Range width">
          {PRESETS.map((p) => {
            const active = preset === p.id
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPreset(p.id)}
                className={`rounded-[20px] border-2 border-surface-line p-4 text-left text-tone-ink transition-[transform,box-shadow] ${PRESET_TONES[p.id]} ${
                  active ? 'shadow-[0_4px_0_0_var(--color-surface-line)]' : 'opacity-70 hover:opacity-100'
                }`}
              >
                <span className={small}>{p.label}</span>
                <span className="num mt-2 block text-[34px] leading-none">{p.concentration + 1}x</span>
                <span className="mt-1 block text-[12px]">capital efficiency</span>
                <span className="mt-3 block border-t-2 border-dashed border-tone-ink/25 pt-2.5 text-[11.5px] leading-relaxed">
                  Edge at a {(p.maxDeviationBps / 100).toFixed(1)}% depeg
                  <br />
                  Fee {(p.feeBps / 100).toFixed(2)}% · FX {(p.fxFeeBps / 100).toFixed(2)}%
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="contents">
          <Label>Venue</Label>
        </legend>
        <VenuePicker value={venue} onChange={setVenue} />
      </fieldset>

      <div>
        <UsdInput id="range-usd" label="Per coin" value={text} onChange={setText} />
        <NeedList rows={rows} />
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className={`${small} text-muted`}>Allowance granted</span>
          <span className="num text-[20px]">{formatUsd(total, 0)}</span>
        </div>
        <Button className="mt-4 w-full" disabled={blocked} busy={tx.state.status === 'pending'} onClick={open}>
          {cta}
        </Button>
        <TxStatus state={tx.state} />
      </div>
    </div>
  )
}

function BackstopForm({ held, balances, market }: { held: TokenInfo[]; balances: bigint[] | undefined; market: Market | undefined }) {
  const { deployment, client, wallet } = useStabrix()
  const tokens = deployment.tokens
  const defaultPay = held.filter((t) => t.symbol === 'USDC' || t.symbol === 'USDT')
  const [picked, setPicked] = useState<string[] | null>(null)
  const [preset, setPreset] = useState<BackstopPresetId>('standard')
  const [venue, setVenue] = useState<VenueId>('native')
  const [pledgeText, setPledgeText] = useState('1000')
  const [capText, setCapText] = useState('')
  const tx = useTx()

  const payout = picked ?? (defaultPay.length ? defaultPay : held.slice(0, 1)).map((t) => t.address)
  const payTokens = tokens.filter((t) => payout.includes(t.address))
  const covered = tokens.filter((t) => !payout.includes(t.address))
  const pledgeUsd = toUnits(pledgeText, 18)
  const totalPledge = pledgeUsd ? pledgeUsd * BigInt(payTokens.length) : 0n
  const cap = capText.trim() === '' ? totalPledge : toUnits(capText, 18)
  const rows = payTokens.map((t) => ({ token: t, need: units(pledgeText, t, market) ?? 0n, have: balances?.[tokens.indexOf(t)] }))
  const short = rows.find((r) => r.have !== undefined && r.need > r.have)
  const p = BACKSTOP_PRESETS.find((x) => x.id === preset)!

  const toggle = (address: string) =>
    setPicked((cur) => {
      const base = cur ?? payout
      return base.includes(address) ? base.filter((a) => a !== address) : [...base, address]
    })

  let cta = 'Pledge backstop'
  let blocked = false
  if (!wallet) [cta, blocked] = ['Connect an account', true]
  else if (payTokens.length === 0) [cta, blocked] = ['Pick a coin to pay out in', true]
  else if (covered.length === 0) [cta, blocked] = ['Leave at least one coin to cover', true]
  else if (!pledgeUsd || pledgeUsd === 0n) [cta, blocked] = ['Enter a pledge', true]
  else if (!cap || cap === 0n) [cta, blocked] = ['Enter a cap', true]
  else if (short) [cta, blocked] = [`Not enough ${short.token.symbol}`, true]

  const pledge = () =>
    tx.run('Preparing the backstop', async (progress) => {
      if (!wallet || !pledgeUsd || !cap) throw new Error('Not ready')
      const config = client.buildBackstop(p.startBps, p.endBps, cap)
      const amounts = config.tokens.map((t) => {
        const token = client.token(t)
        return payout.includes(token.address) ? (units(pledgeText, token, market) ?? 0n) : 0n
      })
      progress(`Approving Aqua for ${payTokens.length} payout coin${payTokens.length > 1 ? 's' : ''}, then shipping the backstop`)
      const done = await client.shipBackstop(wallet, config, amounts, venueOf(venue, deployment.backstop))
      return { message: `Backstop standing by for ${covered.length} coins. It stays dormant until a coin is halted.`, hash: done.hash }
    })

  return (
    <div className="space-y-7">
      <fieldset>
        <legend className="contents">
          <Label>Pay out in</Label>
        </legend>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tokens.map((t, k) => (
            <CoinToggle
              key={t.address}
              token={t}
              balance={balances?.[k]}
              usd={valueUsd(balances?.[k] ?? 0n, t.decimals, priceOf(market, t))}
              selected={payout.includes(t.address)}
              onToggle={() => toggle(t.address)}
            />
          ))}
        </div>
        <p className="caption mt-2.5">
          {covered.length > 0
            ? `Covers ${covered.map((t) => t.symbol).join(', ')}. If Chainlink CRE halts one, the backstop buys it and pays in your picked coins.`
            : 'Leave at least one coin unpicked for the backstop to cover.'}
        </p>
      </fieldset>

      <fieldset>
        <legend className="contents">
          <Label>Discount</Label>
        </legend>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-3" role="radiogroup" aria-label="Discount">
          {BACKSTOP_PRESETS.map((x) => {
            const active = preset === x.id
            return (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPreset(x.id)}
                className={`rounded-[20px] border-2 border-surface-line p-4 text-left transition-[transform,box-shadow] ${
                  active ? 'bg-[#f6c945] text-tone-ink shadow-[0_4px_0_0_var(--color-surface-line)]' : 'bg-paper opacity-70 hover:opacity-100'
                }`}
              >
                <span className={small}>{x.label}</span>
                <span className="num mt-2 block text-[26px] leading-none">
                  {x.startBps / 100}% → {x.endBps / 100}%
                </span>
                <span className="mt-3 block border-t-2 border-dashed border-tone-ink/25 pt-2.5 text-[11.5px] leading-relaxed">
                  At a ${SAMPLE_DEPEG.toFixed(2)} depeg it pays
                  <br />${(SAMPLE_DEPEG * (1 - x.startBps / 10_000)).toFixed(3)} falling to ${(SAMPLE_DEPEG * (1 - x.endBps / 10_000)).toFixed(3)}
                </span>
              </button>
            )
          })}
        </div>
        <p className="caption mt-2.5">The discount grows as the cap fills. It never pays above face value.</p>
      </fieldset>

      <fieldset>
        <legend className="contents">
          <Label>Venue</Label>
        </legend>
        <VenuePicker value={venue} onChange={setVenue} />
      </fieldset>

      <div className="space-y-2.5">
        <UsdInput id="pledge-usd" label="Pledge per coin" value={pledgeText} onChange={setPledgeText} />
        <UsdInput id="cap-usd" label="Cap per halted coin" value={capText === '' ? (totalPledge ? formatAmount(totalPledge, 18, 2).replace(/,/g, '') : '') : capText} onChange={setCapText} />
        <NeedList rows={rows} />
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className={`${small} text-muted`}>Pledged, still in your wallet</span>
          <span className="num text-[20px]">{formatUsd(Number(totalPledge) / 1e18, 0)}</span>
        </div>
        <Button className="mt-4 w-full" disabled={blocked} busy={tx.state.status === 'pending'} onClick={pledge}>
          {cta}
        </Button>
        <TxStatus state={tx.state} />
      </div>
    </div>
  )
}

function WalletPanel({ market, balances, mine }: { market: Market | undefined; balances: bigint[] | undefined; mine: LiveStrategy[] }) {
  const { deployment } = useStabrix()
  const walletUsd = deployment.tokens.reduce((s, t, k) => s + valueUsd(balances?.[k] ?? 0n, t.decimals, priceOf(market, t)), 0)
  const prices = market?.prices
  const inRanges = prices ? mine.filter((s) => s.kind === 'range').reduce((s, x) => s + strategyUsd(x, prices), 0) : 0
  const inBackstops = prices ? mine.filter((s) => s.kind === 'backstop').reduce((s, x) => s + strategyUsd(x, prices), 0) : 0
  const ratio = walletUsd > 0 ? (inRanges + inBackstops) / walletUsd : 0
  const loading = !market || !balances

  return (
    <Panel className="p-5 sm:p-6">
      <Label>Your wallet</Label>
      {loading ? (
        <Skeleton className="mt-4 h-40" />
      ) : (
        <>
          <p className="num mt-4 text-[40px] leading-none">{formatUsd(walletUsd, 0)}</p>
          <p className="caption mt-1.5">held across {deployment.tokens.length} stablecoins</p>
          <dl className="mt-5 divide-y-2 divide-dashed divide-line">
            {(
              [
                ['Backing FX ranges', formatUsd(inRanges, 0)],
                ['Pledged to backstops', formatUsd(inBackstops, 0)],
                ['Shared liquidity ratio', ratio > 0 && ratio < 0.01 ? '<0.01x' : `${ratio.toFixed(2)}x`],
              ] as const
            ).map(([term, value]) => (
              <div key={term} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className={`${small} text-muted`}>{term}</dt>
                <dd className="num text-[18px]">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="caption mt-3">
            Aqua lets one balance back several strategies at once. Nothing moves until a trade fills, and you can spend these coins any time.
          </p>
        </>
      )}
    </Panel>
  )
}

function StrategyCard({ s, market, onClose, busy }: { s: LiveStrategy; market: Market; onClose: () => void; busy: boolean }) {
  const { client } = useStabrix()
  const usd = strategyUsd(s, market.prices)
  const short = shortCoins(s, market.prices)
  const fill = s.kind === 'backstop' ? backstopFill(s, market.prices) : []
  const shown = s.config.tokens.map((t, k) => ({ t, k })).filter(({ k }) => (s.balances[k] ?? 0n) > 0n || s.kind === 'range')

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={small}>
            {settingOf(s)} {s.kind === 'range' ? 'FX range' : 'backstop'}
          </p>
          <p className="num mt-2 text-[34px] leading-none">{formatUsd(usd, 0)}</p>
        </div>
        <span className="flex flex-wrap gap-1.5">
          <KindTag kind={s.kind} />
          <VenueTag kind={s.venue.kind} />
        </span>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {shown.map(({ t, k }) => {
          const token = client.token(t)
          return (
            <li key={t} className={`rounded-xl border-2 border-surface-line px-2.5 py-1.5 text-tone-ink ${COIN_TONES[token.symbol] ?? 'bg-surface-hover'}`}>
              <span className="block text-[10px] font-bold tracking-[0.08em]">{token.symbol}</span>
              <span className="num block truncate text-[14px]">{formatAmount(s.balances[k] ?? 0n, token.decimals, 0)}</span>
            </li>
          )
        })}
      </ul>

      {s.kind === 'backstop' && (
        <p className="caption mt-3">
          Covers every coin not pledged. Cap {formatUsd(Number(s.config.capPerToken) / 1e18, 0)} per halted coin.
          {fill.length > 0 && ` Buying ${fill.map((f) => client.token(f.token).symbol).join(', ')} now, ${formatUsd(Math.min(...fill.map((f) => f.roomUsd)), 0)} of room left.`}
        </p>
      )}
      {short.length > 0 && (
        <p className="mt-3 text-[13px] font-semibold text-down" role="status">
          Wallet holds less {short.map((k) => client.token(s.config.tokens[k]!).symbol).join(', ')} than this strategy offers. Fills route around the gap.
        </p>
      )}

      <div className="rule my-4" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StrategyStatus s={s} market={market} />
        <Button variant="ghost" size="sm" busy={busy} onClick={onClose}>
          Close
        </Button>
      </div>
    </Panel>
  )
}

export default function LiquidityPage() {
  const { deployment, client, signer, wallet } = useStabrix()
  const market = useMarket()
  const balances = useBalances(signer?.address)
  const [mode, setMode] = useState<Mode>('range')
  const close = useTx()

  const held = useMemo(
    () => deployment.tokens.filter((_, k) => (balances.data?.[k] ?? 0n) > 0n),
    [deployment.tokens, balances.data],
  )
  const all: LiveStrategy[] = market.data ? [...market.data.ranges, ...market.data.backstops] : []
  const mine = all.filter((s) => isMine(s, signer?.address))

  const dock = (s: LiveStrategy) =>
    close.run(`Closing the ${s.kind === 'range' ? 'range' : 'backstop'}`, async () => {
      if (!wallet) throw new Error('Connect an account')
      const receipt = await client.dock(wallet, s)
      return { message: 'Closed. Aqua no longer offers these coins.', hash: receipt.transactionHash }
    })

  return (
    <div className="space-y-12">
      <SectionHead
        index="Stabrix · 02"
        title="Liquidity"
        aside={
          <p className="font-serif max-w-sm text-[17px] leading-snug text-muted sm:text-right">
            One wallet balance, two jobs. An FX range earns fees on every trade. A backstop stands behind every coin when one breaks.
          </p>
        }
      />

      <div className="grid grid-cols-1 gap-7 lg:grid-cols-12">
        <Panel className="p-5 sm:p-7 lg:col-span-7 lg:self-start">
          <Segmented<Mode>
            label="Strategy"
            value={mode}
            onChange={setMode}
            options={[
              ['range', 'FX range'],
              ['backstop', 'Backstop'],
            ]}
          />
          <div className="mt-7">
            {mode === 'range' ? (
              <RangeForm held={held} balances={balances.data} market={market.data} />
            ) : (
              <BackstopForm held={held} balances={balances.data} market={market.data} />
            )}
          </div>
        </Panel>

        <div className="space-y-7 lg:col-span-5">
          <WalletPanel market={market.data} balances={balances.data} mine={mine} />
          <Link href="/pool" className="ink-card flex items-center justify-between gap-4 p-5 transition-transform hover:translate-y-[2px] sm:p-6">
            <span>
              <span className="label">
                <span className="size-2 shrink-0 rotate-45 border-2 border-current" aria-hidden />
                The pool
              </span>
              <span className="font-serif mt-2 block text-[17px] text-muted">Every strategy, the reserve mix and the orbit map.</span>
            </span>
            <ArrowRight className="size-5 shrink-0" aria-hidden />
          </Link>
        </div>
      </div>

      <section aria-labelledby="mine" className="space-y-5">
        <Label id="mine">Your strategies</Label>
        {market.isLoading ? (
          <Skeleton className="h-44" />
        ) : !market.data || mine.length === 0 ? (
          <Panel className="p-6">
            <p className="font-serif text-[17px] text-muted">
              {signer ? 'Nothing open for this account yet. Open an FX range or pledge a backstop above.' : 'Connect an account to see its strategies.'}
            </p>
          </Panel>
        ) : (
          <div className="grid gap-7 md:grid-cols-2">
            {mine.map((s) => (
              <StrategyCard key={s.id} s={s} market={market.data!} busy={close.state.status === 'pending'} onClose={() => dock(s)} />
            ))}
          </div>
        )}
        <TxStatus state={close.state} />
      </section>

    </div>
  )
}
