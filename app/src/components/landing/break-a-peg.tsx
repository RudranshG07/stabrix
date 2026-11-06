'use client'

import type { LiveRange, PresetId } from '@stabrix/sdk'
import { useEffect, useMemo, useState } from 'react'
import { OrbitMap } from '@/components/orbit-map'
import { Pill } from '@/components/ui'
import { type PoolState, SIM_COINS, type SimPoint, orbitFrames, simulateDepeg } from '@/lib/depeg-sim'

const PRESETS = ['tight', 'balanced', 'wide'] as const
const HALT = 0.97
const LAST = 40
const COINS = SIM_COINS.map((symbol, k) => ({ symbol, address: `0x${(k + 1).toString(16).padStart(40, '0')}` }))

const SERIES = [
  { key: 'noEdge', label: 'Same range, no edge', color: 'var(--color-down)' },
  { key: 'edge', label: 'Stabrix range edge', color: 'var(--color-series-lime)' },
  { key: 'sentinel', label: 'Edge + Chainlink halt', color: 'var(--color-violet)' },
  { key: 'hold', label: 'Just holding the deposit', color: 'var(--color-muted)' },
] as const

const W = 560
const H = 300
const PAD = { l: 48, r: 24, t: 12, b: 28 }

function toRanges(frame: PoolState[]): LiveRange[] {
  return frame.map(
    (p, k) =>
      ({
        hash: `0x${k}`,
        app: '0x0',
        balances: p.real,
        rates: p.real.map(() => 10n ** 18n),
        range: p.range,
        config: { tokens: COINS.map((c) => c.address), decimals: COINS.map(() => 18), floor: p.range.floor },
      }) as unknown as LiveRange,
  )
}

function edgeIndex(pts: SimPoint[]): number {
  for (let k = 1; k < pts.length - 1; k++) {
    if (pts[k]!.absorbedEdge > 0 && pts[k]!.absorbedEdge === pts[k + 1]!.absorbedEdge) return k
  }
  return pts.length - 1
}

const price = (k: number) => 1 - k * 0.005
const usd = (n: number) => Math.round(n).toLocaleString('en-US')

export function BreakAPeg() {
  const [sims, setSims] = useState<Record<PresetId, SimPoint[]> | null>(null)
  const [frames, setFrames] = useState<PoolState[][] | null>(null)
  const [preset, setPreset] = useState<PresetId>('tight')
  const [cursor, setCursor] = useState(24)

  useEffect(() => {
    let alive = true
    Promise.all([...PRESETS.map((p) => simulateDepeg(p, HALT)), orbitFrames(0.8)]).then(([t, b, w, f]) => {
      if (!alive) return
      setSims({ tight: t as SimPoint[], balanced: b as SimPoint[], wide: w as SimPoint[] })
      setFrames(f as PoolState[][])
    })
    return () => {
      alive = false
    }
  }, [])

  const pts = sims?.[preset]
  const at = pts?.[cursor]

  const chart = useMemo(() => {
    if (!pts) return null
    const lo = Math.floor(Math.min(...pts.map((p) => Math.min(p.noEdge, p.edge, p.sentinel, p.hold)))) - 1
    const x = (k: number) => PAD.l + (k / LAST) * (W - PAD.l - PAD.r)
    const y = (v: number) => PAD.t + (v / lo) * (H - PAD.t - PAD.b)
    return { x, y, ticks: Array.from({ length: 4 }, (_, k) => Math.round((lo * k) / 3)) }
  }, [pts])

  const events = useMemo(() => {
    if (!sims) return []
    const list = PRESETS.map((p) => {
      const k = edgeIndex(sims[p])
      return {
        k,
        head: `${p[0]!.toUpperCase()}${p.slice(1)} range reaches its edge`,
        sub: `holds ${usd(sims[p][k]!.absorbedEdge)} extra USDe, refuses the rest`,
        tone: 'text-accent-text',
      }
    })
    list.push({ k: Math.round((1 - HALT) / 0.005), head: 'Chainlink CRE halts USDe', sub: '3% off peg on the price API, every range refuses it', tone: 'text-violet' })
    return list.sort((a, b) => a.k - b.k)
  }, [sims])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="rounded-[var(--radius-card)] border border-surface-line bg-surface p-5 lg:col-span-4">
          <div className="flex items-center justify-between font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
            <span>// Section A · orbit</span>
            <span>rings = edges</span>
          </div>
          <div className="mt-4">
            {frames ? <OrbitMap ranges={toRanges(frames[cursor]!)} coins={COINS} /> : <div className="mx-auto aspect-square max-w-[360px] animate-pulse rounded-full bg-surface-hover" />}
          </div>
        </div>

        <div className="rounded-[var(--radius-card)] border border-surface-line bg-surface p-5 lg:col-span-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">// Section B · LP value</span>
            <div className="flex gap-1.5" role="radiogroup" aria-label="Range preset">
              {PRESETS.map((p) => (
                <Pill key={p} active={preset === p} onClick={() => setPreset(p)}>
                  {p.toUpperCase()}
                </Pill>
              ))}
            </div>
          </div>
          {!pts || !chart ? (
            <div className="mt-4 grid h-[300px] place-items-center rounded-xl border border-dashed border-line font-mono text-[11px] text-muted">RUNNING THE CONTRACT MATH</div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full" role="img" aria-label={`LP value for the ${preset} preset as USDe falls`}>
              {chart.ticks.map((t) => (
                <g key={t}>
                  <line x1={PAD.l} x2={W - PAD.r} y1={chart.y(t)} y2={chart.y(t)} style={{ stroke: t === 0 ? 'var(--color-grid-strong)' : 'var(--color-grid)' }} strokeDasharray="4 4" />
                  <text x={PAD.l - 8} y={chart.y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted font-mono text-[11px]">
                    {t}%
                  </text>
                </g>
              ))}
              {[0, 10, 20, 30, 40].map((k) => (
                <text key={k} x={chart.x(k)} y={H - 6} textAnchor="middle" className="fill-muted font-mono text-[11px]">
                  ${price(k).toFixed(2)}
                </text>
              ))}
              {[SERIES[3], SERIES[0], SERIES[2], SERIES[1]].map((s) => (
                <polyline
                  key={s.key}
                  fill="none"
                  style={{ stroke: s.color }}
                  strokeWidth={s.key === 'hold' ? 1.5 : s.key === 'sentinel' ? 7 : 2.5}
                  strokeOpacity={s.key === 'sentinel' ? 0.5 : 1}
                  strokeDasharray={s.key === 'hold' ? '5 5' : undefined}
                  strokeLinejoin="round"
                  points={pts.map((p, k) => `${chart.x(k)},${chart.y(p[s.key])}`).join(' ')}
                />
              ))}
              <line x1={chart.x(cursor)} x2={chart.x(cursor)} y1={PAD.t} y2={H - PAD.b} style={{ stroke: 'var(--color-ink)' }} strokeOpacity={0.3} />
              {at && SERIES.map((s) => <circle key={s.key} cx={chart.x(cursor)} cy={chart.y(at[s.key])} r={4} style={{ fill: s.color }} />)}
            </svg>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-dashed border-line pt-4 font-mono text-xs">
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-2">
                <dt className="flex min-w-0 items-center gap-2 text-muted">
                  <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
                  <span className="truncate">{s.label}</span>
                </dt>
                <dd className="num text-ink">{at ? `${at[s.key].toFixed(2)}%` : '—'}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-[var(--radius-card)] border border-surface-line bg-surface p-5 lg:col-span-3">
          <span className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">// Section C · timeline</span>
          <ol className="mt-4 space-y-4">
            <li className="border-l-2 border-line pl-3">
              <p className="font-mono text-[11px] text-muted">$1.000</p>
              <p className="text-sm">USDe on peg. Five coins, one pool.</p>
            </li>
            {events.map((e) => {
              const reached = cursor >= e.k
              return (
                <li key={e.head} className={`border-l-2 pl-3 transition-[opacity,border-color] duration-[360ms] ${reached ? 'border-ink opacity-100' : 'border-line opacity-40'}`}>
                  <p className="font-mono text-[11px] text-muted">${price(e.k).toFixed(3)}</p>
                  <p className={`text-sm ${reached ? e.tone : ''}`}>{e.head}</p>
                  <p className="text-xs text-muted">{e.sub}</p>
                </li>
              )
            })}
            {at && (
              <li className="border-l-2 border-down pl-3">
                <p className="font-mono text-[11px] text-muted">${at.price.toFixed(3)} · no edge</p>
                <p className="text-sm text-down">Still absorbing: {usd(at.absorbedNoEdge)} USDe</p>
              </li>
            )}
          </ol>
        </div>
      </div>

      <div className="rounded-[var(--radius-card)] border border-surface-line bg-surface px-5 py-4">
        <label htmlFor="peg" className="flex items-center justify-between font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
          <span>USDe market price · drag to break the peg</span>
          <span className="num text-base text-ink">${price(cursor).toFixed(3)}</span>
        </label>
        <input
          id="peg"
          type="range"
          min={0}
          max={LAST}
          value={cursor}
          onChange={(e) => setCursor(Number(e.target.value))}
          aria-valuetext={`USDe at $${price(cursor).toFixed(3)}`}
          className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-hover accent-[var(--color-accent)]"
        />
      </div>
    </div>
  )
}
