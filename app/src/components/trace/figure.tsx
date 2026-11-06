'use client'

import { WAD, edgeUtilization, virtualBalances } from '@stabrix/sdk'
import { useEffect, useState } from 'react'
import { COIN_HEX } from '@/lib/coins'
import { type PoolState, SIM_COINS, type SimPoint, orbitFrames, simulateDepeg } from '@/lib/depeg-sim'

const C = { x: 150, y: 106 }
const R = 58
const RING = [0.38, 0.62, 0.86]
const GX0 = 24
const GX1 = 290
const GY0 = 258
const GY1 = 206
const LAST = 40
const RATES = SIM_COINS.map(() => WAD)

const angle = (k: number) => -Math.PI / 2 + (2 * Math.PI * k) / SIM_COINS.length
const vertex = (k: number, r: number) => ({ x: C.x + r * Math.cos(angle(k)), y: C.y + r * Math.sin(angle(k)) })

function reserveDot(pool: PoolState, ring: number) {
  const v = virtualBalances(pool.real, RATES, pool.range.floor).map((x) => Number(x / 10n ** 12n))
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  let dx = 0
  let dy = 0
  v.forEach((x, k) => {
    dx += (x - mean) * Math.cos(angle(k))
    dy += (x - mean) * Math.sin(angle(k))
  })
  const used = edgeUtilization(pool.real, RATES, pool.range)
  const a = Math.hypot(dx, dy) === 0 ? -Math.PI / 2 : Math.atan2(dy, dx)
  return { x: C.x + ring * used * Math.cos(a), y: C.y + ring * used * Math.sin(a), atEdge: used > 0.995 }
}

export function StabrixFigure({ steps }: { steps: number }) {
  const [frames, setFrames] = useState<PoolState[][] | null>(null)
  const [pts, setPts] = useState<SimPoint[] | null>(null)
  const [view, setView] = useState({ step: 0, frame: 0 })

  useEffect(() => {
    let alive = true
    Promise.all([orbitFrames(0.8), simulateDepeg('tight', 0.97)]).then(([f, p]) => {
      if (!alive) return
      setFrames(f)
      setPts(p)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const render = () => {
      const travel = document.documentElement.scrollHeight - window.innerHeight
      const p = travel > 0 ? Math.min(1, Math.max(0, window.scrollY / travel)) : 0
      const step = Math.min(steps - 1, Math.floor(p * steps))
      const d = Math.min(1, Math.max(0, (p - 0.5) / 0.45))
      setView({ step, frame: Math.round(d * LAST) })
    }
    let queued = false
    const schedule = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        render()
      })
    }
    render()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [steps])

  const { step, frame } = view
  const on = (from: number) => (step >= from ? 'on' : '')
  const lo = pts ? Math.floor(Math.min(...pts.map((p) => p.noEdge))) - 1 : -14
  const gx = (k: number) => GX0 + (k / LAST) * (GX1 - GX0)
  const gy = (v: number) => GY1 + (v / lo) * (GY0 - GY1)
  const path = (key: 'edge' | 'noEdge') => (pts ? pts.map((p, k) => `${k ? 'L' : 'M'}${gx(k).toFixed(1)} ${gy(p[key]).toFixed(1)}`).join(' ') : '')
  const at = pts?.[frame]
  const cursor = gx(frame)
  const readout =
    step >= 9 && at
      ? `edge ${at.edge.toFixed(2)}% · open ${at.noEdge.toFixed(2)}%`
      : at && frame > 0
        ? `USDe $${at.price.toFixed(3)} · ${at.edge.toFixed(2)}%`
        : 'USDe $1.000 · 0.00%'
  const dots = frames ? frames[frame]!.map((pool, k) => reserveDot(pool, R * RING[k]!)) : []
  const polygon = SIM_COINS.map((_, k) => {
    const p = vertex(k, R)
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
  }).join(' ')

  return (
    <figure className="fig" aria-label="Three Stabrix ranges hold their edge as USDe falls; LP value tracks holding while an edgeless range keeps losing.">
      <svg viewBox="0 0 300 270" role="img" aria-hidden>
        <g>
          <g className={`chip ${on(5)}`} data-from="5">
            <rect x="8" y="8" width="54" height="18" rx="9" />
            <text x="35" y="20.5">2 venues</text>
          </g>
          <g className={`chip ${on(6)}`} data-from="6">
            <rect x="66" y="8" width="52" height="18" rx="9" />
            <text x="92" y="20.5">edge ✓</text>
          </g>
          <g className={`chip lit ${on(7)}`} data-from="7">
            <rect x="122" y="8" width="64" height="18" rx="9" />
            <text x="154" y="20.5">USDe halted</text>
          </g>
          <g className={`chip lit ${on(9)}`} data-from="9">
            <rect x="190" y="8" width="44" height="18" rx="9" />
            <text x="212" y="20.5">−4.4%</text>
          </g>
          <g className={`chip off ${on(9)}`} data-from="9">
            <rect x="238" y="8" width="54" height="18" rx="9" />
            <text x="265" y="20.5">vs −12.3%</text>
          </g>
        </g>

        <polygon className="frame" points={polygon} />
        {SIM_COINS.map((coin, k) => {
          const p = vertex(k, R)
          const label = vertex(k, R + 13)
          return (
            <g key={coin}>
              <line className="spoke" x1={C.x} y1={C.y} x2={p.x} y2={p.y} />
              <circle className="coin-dot" cx={p.x} cy={p.y} r={4} style={{ fill: COIN_HEX[coin] }} />
              <text className="coin-name" x={label.x} y={label.y + 3} textAnchor="middle">
                {coin}
              </text>
            </g>
          )
        })}
        {RING.map((f, k) => (
          <circle key={f} className={`ring ${dots[k]?.atEdge ? 'lit' : ''}`} cx={C.x} cy={C.y} r={R * f} />
        ))}
        {dots.map((d, k) => (
          <g key={RING[k]}>
            <line className="tether" x1={C.x} y1={C.y} x2={d.x} y2={d.y} />
            <circle className="reserve" cx={d.x} cy={d.y} r={k === 0 ? 5 : 4.5} />
          </g>
        ))}
        <circle className="center" cx={C.x} cy={C.y} r={2.5} />

        <line className="axis" x1={GX0} y1={GY0} x2={GX1} y2={GY0} />
        <text className="fig-label" x={GX0} y="196">
          LP value (%)
        </text>
        <rect className={`band ${on(7)}`} data-from="7" x={gx(0)} y={GY1 - 4} width={gx(6) - gx(0)} height={GY0 - GY1 + 4} />
        <path className="curve-open" d={path('noEdge')} />
        <path className="curve-edge" d={path('edge')} />
        <rect className="unplayed" x={cursor} y={GY1 - 6} width={Math.max(0, GX1 - cursor)} height={GY0 - GY1 + 8} />
        <line className="cursor" x1={cursor} y1={GY1 - 8} x2={cursor} y2={GY0 + 2} />
        <text className="readout" x={GX1} y="196" textAnchor="end">
          {readout}
        </text>
        <text className="fig-label" x={GX1} y="268" textAnchor="end">
          USDe $1.00 → $0.80
        </text>
      </svg>
    </figure>
  )
}
