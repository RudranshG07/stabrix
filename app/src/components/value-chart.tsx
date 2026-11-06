'use client'

export interface Series {
  id: string
  label: string
  color: string
  points: number[]
}

export function ValueChart({ series, height = 220 }: { series: Series[]; height?: number }) {
  series = series.map((s) => (s.points.length === 1 ? { ...s, points: [s.points[0]!, s.points[0]!] } : s))
  const all = series.flatMap((s) => s.points)
  const width = 640
  const pad = 8
  const gutter = 44
  if (all.length < 2) {
    return (
      <div className="caption grid place-items-center rounded-2xl border border-dashed border-line" style={{ height }}>
        COLLECTING DATA
      </div>
    )
  }
  const min = Math.min(...all, 0)
  const max = Math.max(...all, 0)
  const span = max - min || 1
  const longest = Math.max(...series.map((s) => s.points.length))
  const x = (i: number) => gutter + (i / Math.max(1, longest - 1)) * (width - gutter - pad)
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2)

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="LP value change over time">
        {[max, 0, min].filter((v, k, a) => a.indexOf(v) === k).map((v) => (
          <g key={v}>
            <line x1={gutter} x2={width - pad} y1={y(v)} y2={y(v)} style={{ stroke: v === 0 ? 'var(--color-grid-strong)' : 'var(--color-grid)' }} strokeDasharray="4 4" />
            <text x={gutter - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" className="fill-muted font-mono text-[11px]">
              {v > 0 ? '+' : ''}
              {v.toFixed(2)}%
            </text>
          </g>
        ))}
        {series.map((s) => (
          <polyline
            key={s.id}
            fill="none"
            style={{ stroke: s.color }}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={s.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
          />
        ))}
      </svg>
      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[11px]">
        {series.map((s) => (
          <span key={s.id} className="flex items-center gap-2">
            <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="text-muted">{s.label}</span>
            <span className="num text-ink">{(s.points.at(-1) ?? 0).toFixed(2)}%</span>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
