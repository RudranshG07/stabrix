'use client'

export interface Series {
  id: string
  label: string
  color: string
  dashed?: boolean
  points: number[]
}

export function ValueChart({ series, height = 220 }: { series: Series[]; height?: number }) {
  const lines = series.map((s) => (s.points.length === 1 ? { ...s, points: [s.points[0]!, s.points[0]!] } : s))
  const all = lines.flatMap((s) => s.points)
  const width = 640
  const pad = 10
  const gutter = 52
  if (all.length < 2) {
    return (
      <div className="grid place-items-center rounded-xl border border-line text-[10.5px] font-medium tracking-[0.08em] text-muted uppercase" style={{ height }}>
        Collecting data
      </div>
    )
  }
  const min = Math.min(...all, -0.5)
  const max = Math.max(...all, 0.5)
  const span = max - min
  const longest = Math.max(...lines.map((s) => s.points.length))
  const x = (i: number) => gutter + (i / Math.max(1, longest - 1)) * (width - gutter - pad)
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2)
  const ticks = [max, 0, min].filter((v, k, a) => a.indexOf(v) === k)

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Change in strategy value over time">
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={gutter}
              x2={width - pad}
              y1={y(v)}
              y2={y(v)}
              style={{ stroke: v === 0 ? 'var(--color-surface-line)' : 'var(--color-line)' }}
              strokeWidth={v === 0 ? 1.5 : 1}
              strokeDasharray={v === 0 ? undefined : '4 5'}
            />
            <text x={gutter - 10} y={y(v)} textAnchor="end" dominantBaseline="middle" className="num fill-muted text-[13.5px]">
              {v > 0 ? '+' : ''}
              {v.toFixed(2)}%
            </text>
          </g>
        ))}
        {lines.map((s) => (
          <polyline
            key={s.id}
            fill="none"
            style={{ stroke: s.color }}
            strokeWidth={2.5}
            strokeDasharray={s.dashed ? '7 5' : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={s.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
          />
        ))}
      </svg>
      <figcaption className="mt-4 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
        {lines.map((s) => {
          const last = s.points.at(-1) ?? 0
          return (
            <span key={s.id} className="flex items-center gap-2.5 text-[12px]">
              <svg width="22" height="6" aria-hidden className="shrink-0">
                <line x1="1" x2="21" y1="3" y2="3" style={{ stroke: s.color }} strokeWidth={2.5} strokeDasharray={s.dashed ? '5 3' : undefined} strokeLinecap="round" />
              </svg>
              <span className="min-w-0 truncate text-muted">{s.label}</span>
              <span className={`num ml-auto text-[14px] ${last < -0.005 ? 'text-down' : last > 0.005 ? 'text-up' : ''}`}>
                {last > 0 ? '+' : ''}
                {last.toFixed(2)}%
              </span>
            </span>
          )
        })}
      </figcaption>
    </figure>
  )
}
