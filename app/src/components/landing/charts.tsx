'use client'

import { PRESETS, type PresetId } from '@stabrix/sdk'
import { useEffect, useMemo, useState } from 'react'
import { BACKSTOP_PRESETS } from '@/lib/strategy'
import { type DepegPoint, type ImpactPoint, backstopPay, depegCurve, impactCurve } from '@/lib/sim'

const INK = 'var(--line)'
const GOLD = 'var(--c-gold)'
const RED = 'var(--c-red)'
const MUTED = 'var(--c-muted)'
const BLUE = 'var(--c-blue)'
const W = 640
const H = 320
const PAD = { l: 64, r: 18, t: 18, b: 52 }

const SERIES: { id: PresetId | 'flat'; label: string; color: string; dash?: string }[] = [
  { id: 'tight', label: 'Tight', color: INK },
  { id: 'balanced', label: 'Balanced', color: BLUE },
  { id: 'wide', label: 'Wide', color: GOLD },
  { id: 'flat', label: 'No concentration', color: RED, dash: '6 5' },
]

const fmtUsd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(v % 1e6 ? 1 : 0)}M` : `$${Math.round(v / 1e3)}k`)
const fmtBps = (v: number) => (v < 0.1 ? v.toFixed(3) : v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US'))

function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="ch-tabs" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  )
}

export function ImpactChart() {
  const [curves, setCurves] = useState<Record<string, ImpactPoint[]> | null>(null)
  const [size, setSize] = useState(100_000)

  useEffect(() => {
    let alive = true
    Promise.all(SERIES.map((s) => impactCurve(s.id))).then((all) => {
      if (alive) setCurves(Object.fromEntries(SERIES.map((s, k) => [s.id, all[k]!])))
    })
    return () => {
      alive = false
    }
  }, [])

  const x = (usd: number) => PAD.l + ((Math.log10(usd) - 3) / 3) * (W - PAD.l - PAD.r)
  const y = (bps: number) => PAD.t + ((4 - Math.log10(Math.max(bps, 0.01))) / 6) * (H - PAD.t - PAD.b)
  const at = (id: string) => curves?.[id]?.find((p) => p.usd >= size * 0.999)

  return (
    <figure className="ch-card">
      <div className="ch-head">
        <p className="ch-title">Price impact by trade size</p>
        <p className="ch-sub">One range, five USD coins, $1M each. Fees excluded. Each line ends where the range refuses more size.</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Price impact in basis points against trade size for each range width">
        {[0.01, 0.1, 1, 10, 100, 1000, 10000].map((b) => (
          <g key={b}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(b)} y2={y(b)} className="ch-grid" />
            <text x={PAD.l - 10} y={y(b)} className="ch-tick" textAnchor="end" dominantBaseline="middle">
              {b >= 1000 ? `${b / 1000}k` : b}
            </text>
          </g>
        ))}
        {[1e3, 1e4, 1e5, 1e6].map((u) => (
          <text key={u} x={x(u)} y={H - PAD.b + 32} className="ch-tick" textAnchor={u === 1e6 ? 'end' : 'middle'}>
            {fmtUsd(u)}
          </text>
        ))}
        <text x={14} y={PAD.t + 4} className="ch-axis" transform={`rotate(-90 14 ${PAD.t + 4})`} textAnchor="end">
          bps
        </text>
        <line x1={x(size)} x2={x(size)} y1={PAD.t} y2={H - PAD.b} className="ch-cursor" />
        {curves &&
          SERIES.map((s) => {
            const pts = curves[s.id] ?? []
            if (pts.length === 0) return null
            const last = pts[pts.length - 1]!
            return (
              <g key={s.id}>
                <polyline
                  fill="none"
                  style={{ stroke: s.color }}
                  strokeWidth={2.75}
                  strokeDasharray={s.dash}
                  strokeLinejoin="round"
                  points={pts.map((p) => `${x(p.usd).toFixed(1)},${y(p.bps).toFixed(1)}`).join(' ')}
                />
                <circle cx={x(last.usd)} cy={y(last.bps)} r={4.5} style={{ fill: s.color }} />
              </g>
            )
          })}
        {!curves && (
          <text x={W / 2} y={H / 2} className="ch-tick" textAnchor="middle">
            computing with the Stabrix SDK
          </text>
        )}
      </svg>
      <div className="ch-controls">
        <Tabs
          label="Trade size"
          value={String(size)}
          onChange={(v) => setSize(Number(v))}
          options={[
            ['10000', '$10k'],
            ['100000', '$100k'],
            ['500000', '$500k'],
          ]}
        />
      </div>
      <dl className="ch-read">
        {SERIES.map((s) => {
          const p = at(s.id)
          const preset = PRESETS.find((q) => q.id === s.id)
          return (
            <div key={s.id}>
              <dt>
                <i style={{ background: s.color }} />
                {s.label}
                {preset && <small>{preset.concentration + 1}x</small>}
              </dt>
              <dd>{p ? `${fmtBps(p.bps)} bps` : 'refused'}</dd>
            </div>
          )
        })}
      </dl>
    </figure>
  )
}

const DEPEG_LINES: { key: keyof Omit<DepegPoint, 'price'>; label: string; color: string; dash?: string }[] = [
  { key: 'open', label: 'Range without an edge', color: RED, dash: '6 5' },
  { key: 'halted', label: 'With the CRE halt at $0.97', color: GOLD },
  { key: 'edge', label: 'Stabrix range', color: INK, dash: '10 6' },
  { key: 'hold', label: 'Just holding the coins', color: MUTED, dash: '2 5' },
]

export function DepegChart() {
  const [preset, setPreset] = useState<PresetId>('tight')
  const [data, setData] = useState<Record<string, DepegPoint[]> | null>(null)
  const [price, setPrice] = useState(0.93)
  const [bs, setBs] = useState<(typeof BACKSTOP_PRESETS)[number]['id']>('standard')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const out: Record<string, DepegPoint[]> = {}
      for (const p of ['tight', 'balanced', 'wide'] as const) out[p] = await depegCurve(p)
      if (alive) setData(out)
    })()
    return () => {
      alive = false
    }
  }, [])

  const pts = data?.[preset] ?? []
  const lo = useMemo(() => (data ? Math.floor(Math.min(...Object.values(data).flatMap((d) => d.map((p) => p.open)))) - 1 : -20), [data])
  const x = (p: number) => PAD.l + ((1 - p) / 0.2) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (v / lo) * (H - PAD.t - PAD.b)
  const now = pts.find((p) => Math.abs(p.price - price) < 1e-6)
  const ticks = [0, Math.round(lo / 2), lo]
  const b = BACKSTOP_PRESETS.find((q) => q.id === bs)!
  const last = pts[pts.length - 1]
  const haltIdle = !!last && Math.abs(last.edge - last.halted) < 0.01

  const LW = 300
  const LH = 200
  const lx = (f: number) => 46 + f * (LW - 60)
  const ly = (v: number) => 14 + ((1 - v) / 0.45) * (LH - 46)

  return (
    <figure className="ch-card wide">
      <div className="ch-head">
        <p className="ch-title">A coin breaks its peg</p>
        <p className="ch-sub">
          Five USD coins, one breaks. Arbitrageurs sell it into the range until its price matches the market. Value change of the LP position, computed with the
          same math as the contracts.
        </p>
      </div>
      <div className="ch-controls">
        <Tabs
          label="Range width"
          value={preset}
          onChange={setPreset}
          options={[
            ['tight', 'Tight'],
            ['balanced', 'Balanced'],
            ['wide', 'Wide'],
          ]}
        />
        <label className="ch-slider">
          <span>
            Broken coin at <b>${price.toFixed(3)}</b>
          </span>
          <input type="range" min={0.8} max={1} step={0.005} value={price} onChange={(e) => setPrice(Number(e.target.value))} aria-label="Price of the broken coin" />
        </label>
      </div>
      <div className="ch-split">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="LP value change as one coin falls from $1.00 to $0.80">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="ch-grid" />
              <text x={PAD.l - 10} y={y(t)} className="ch-tick" textAnchor="end" dominantBaseline="middle">
                {t}%
              </text>
            </g>
          ))}
          {[1, 0.95, 0.9, 0.85, 0.8].map((p) => (
            <text key={p} x={x(p)} y={H - PAD.b + 32} className="ch-tick" textAnchor={p === 0.8 ? 'end' : 'middle'}>
              ${p.toFixed(2)}
            </text>
          ))}
          <line x1={x(price)} x2={x(price)} y1={PAD.t} y2={H - PAD.b} className="ch-cursor" />
          {pts.length > 0 &&
            DEPEG_LINES.map((l) => (
              <polyline
                key={l.key}
                fill="none"
                style={{ stroke: l.color }}
                strokeWidth={2.75}
                strokeDasharray={l.dash}
                strokeLinejoin="round"
                points={pts.map((p) => `${x(p.price).toFixed(1)},${y(p[l.key]).toFixed(1)}`).join(' ')}
              />
            ))}
          {now &&
            DEPEG_LINES.map((l) => <circle key={l.key} cx={x(price)} cy={y(now[l.key])} r={4.5} style={{ fill: l.color }} />)}
          {!data && (
            <text x={W / 2} y={H / 2} className="ch-tick" textAnchor="middle">
              computing with the Stabrix SDK
            </text>
          )}
        </svg>
        <div className="ch-side">
          <p className="ch-title small">What a backstop pays</p>
          <p className="ch-sub">Per coin, as its cap fills, with the broken coin at ${price.toFixed(3)}.</p>
          <Tabs
            label="Backstop discount"
            value={bs}
            onChange={setBs}
            options={BACKSTOP_PRESETS.map((q) => [q.id, q.label] as const)}
          />
          <svg viewBox={`0 0 ${LW} ${LH}`} role="img" aria-label="Price a backstop pays per coin as its cap fills">
            {[1, 0.9, 0.8, 0.7, 0.6].map((v) => (
              <g key={v}>
                <line x1={46} x2={LW - 14} y1={ly(v)} y2={ly(v)} className="ch-grid" />
                <text x={38} y={ly(v)} className="ch-tick" textAnchor="end" dominantBaseline="middle">
                  ${v.toFixed(2)}
                </text>
              </g>
            ))}
            <line x1={46} x2={LW - 14} y1={ly(price)} y2={ly(price)} style={{ stroke: RED }} strokeWidth={1.75} strokeDasharray="5 4" />
            <line x1={lx(0)} x2={lx(1)} y1={ly(backstopPay(price, 0, b.startBps, b.endBps))} y2={ly(backstopPay(price, 1, b.startBps, b.endBps))} style={{ stroke: INK }} strokeWidth={2.75} />
            <text x={lx(0)} y={LH - 12} className="ch-tick">
              empty
            </text>
            <text x={lx(1)} y={LH - 12} className="ch-tick" textAnchor="end">
              cap full
            </text>
          </svg>
          <p className="ch-note">
            Pays ${backstopPay(price, 0, b.startBps, b.endBps).toFixed(3)} first, ${backstopPay(price, 1, b.startBps, b.endBps).toFixed(3)} when full. Market (red) is
            ${price.toFixed(3)}, never above $1.
          </p>
        </div>
      </div>
      {haltIdle && <p className="ch-note">This width reaches its own edge before the $0.97 halt, so here the halt changes nothing. It matters for Wide.</p>}
      <dl className="ch-read">
        {DEPEG_LINES.map((l) => (
          <div key={l.key}>
            <dt>
              <i style={{ background: l.color }} />
              {l.label}
            </dt>
            <dd>{now ? `${now[l.key] > 0 ? '+' : ''}${now[l.key].toFixed(2)}%` : '…'}</dd>
          </div>
        ))}
      </dl>
    </figure>
  )
}
