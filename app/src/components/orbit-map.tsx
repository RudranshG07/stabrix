'use client'

import { type LiveRange, edgeUtilization, virtualBalances } from '@stabrix/sdk'
import { presetOf } from '@/lib/strategy'
import { COIN_HEX } from './ui'

export const RANGE_COLORS = ['var(--color-violet)', 'var(--color-series-lime)', '#3fb8c9', '#e8857b', '#c9b37a']

const SIZE = 360
const C = SIZE / 2
const OUTER = 150

export function ringRadius(r: LiveRange): number {
  const preset = presetOf(r)
  if (preset === 'tight') return OUTER * 0.38
  if (preset === 'balanced') return OUTER * 0.62
  return OUTER * 0.86
}

export interface Coin {
  address: string
  symbol: string
}

function drift(r: LiveRange, coins: Coin[]) {
  const n = coins.length
  const v = virtualBalances(r.balances, r.rates, r.config.floor).map((x) => Number(x / 10n ** 12n))
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  let x = 0
  let y = 0
  r.config.tokens.forEach((token, k) => {
    const slot = coins.findIndex((c) => c.address.toLowerCase() === token.toLowerCase())
    if (slot < 0) return
    const angle = -Math.PI / 2 + (2 * Math.PI * slot) / n
    x += (v[k]! - mean) * Math.cos(angle)
    y += (v[k]! - mean) * Math.sin(angle)
  })
  return Math.hypot(x, y) === 0 ? -Math.PI / 2 : Math.atan2(y, x)
}

export function OrbitMap({ ranges, coins }: { ranges: LiveRange[]; coins: Coin[] }) {
  const symbols = coins.map((c) => c.symbol)
  const n = symbols.length
  const vertex = (k: number, radius: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n
    return [C + radius * Math.cos(a), C + radius * Math.sin(a)] as const
  }
  const polygon = symbols.map((_, k) => vertex(k, OUTER).join(',')).join(' ')

  return (
    <figure>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto w-full max-w-[420px]" role="img" aria-label="Orbit map of live ranges">
        <polygon points={polygon} fill="none" style={{ stroke: 'var(--color-grid-strong)' }} />
        {symbols.map((s, k) => {
          const [x, y] = vertex(k, OUTER)
          const [lx, ly] = vertex(k, OUTER + 18)
          return (
            <g key={s}>
              <line x1={C} y1={C} x2={x} y2={y} style={{ stroke: 'var(--color-grid)' }} />
              <circle cx={x} cy={y} r={4} fill={COIN_HEX[s] ?? '#8b96a3'} />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-muted font-mono text-[10px]">
                {s}
              </text>
            </g>
          )
        })}
        {ranges.map((r, k) => {
          const color = RANGE_COLORS[k % RANGE_COLORS.length]!
          const ring = ringRadius(r)
          const angle = drift(r, coins)
          const used = r.balances.length ? edgeUtilization(r.balances, r.rates, r.range) : 0
          const dx = C + ring * used * Math.cos(angle)
          const dy = C + ring * used * Math.sin(angle)
          return (
            <g key={`${r.app}${r.hash}`}>
              <circle cx={C} cy={C} r={ring} fill="none" style={{ stroke: color }} strokeOpacity={0.55} strokeDasharray="3 5" />
              <line x1={C} y1={C} x2={dx} y2={dy} style={{ stroke: color }} strokeOpacity={0.5} />
              <circle cx={dx} cy={dy} r={5.5} style={{ fill: color }} className="transition-[cx,cy] duration-500 ease-out" />
            </g>
          )
        })}
        <circle cx={C} cy={C} r={2.5} style={{ fill: 'var(--color-ink)' }} />
      </svg>
      <figcaption className="caption mt-3 text-center">rings = range edges · dot = reserve mix · center = every coin at its Chainlink price</figcaption>
    </figure>
  )
}
