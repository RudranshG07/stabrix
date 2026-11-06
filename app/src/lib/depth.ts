import { type LiveRange, type PresetId, type PriceInfo, StabrixMathError, exactIn, radius, virtualBalances } from '@stabrix/sdk'
import { presetOf, valueUsd } from './strategy'

export const DEPTH_BANDS = [0.9999, 0.9995, 0.999, 0.998, 0.995, 0.99, 0.98, 0.95]
const STEPS = 400

export type DepthRow = { band: number } & Record<PresetId, number>

function ratio(real: bigint[], r: LiveRange, i: number): number {
  const v = virtualBalances(real, r.rates, r.range.floor)
  const rad = radius(v)
  let best = 0n
  v.forEach((x, k) => {
    if (k !== i && rad - x > best) best = rad - x
  })
  return best === 0n ? 0 : Number(((rad - v[i]!) * 1_000_000n) / best) / 1e6
}

export function depthBands(ranges: LiveRange[], prices: Map<string, PriceInfo>, token: string): DepthRow[] {
  const rows: DepthRow[] = DEPTH_BANDS.map((band) => ({ band, tight: 0, balanced: 0, wide: 0 }))
  const face = prices.get(token.toLowerCase())?.priceE18
  if (!face) return rows
  for (const r of ranges) {
    const i = r.config.tokens.findIndex((t) => t.toLowerCase() === token.toLowerCase())
    if (i < 0 || !r.tradable || r.balances.length === 0) continue
    const preset = presetOf(r) ?? 'wide'
    const real = [...r.balances]
    const usd = r.config.tokens.reduce((s, t, k) => s + valueUsd(real[k]!, r.config.decimals[k]!, prices.get(t.toLowerCase())), 0)
    if (usd <= 0) continue
    const chunkUsd = usd / STEPS
    const chunk = (BigInt(Math.round(chunkUsd * 1e6)) * 10n ** 12n * 10n ** BigInt(r.config.decimals[i]!)) / face
    if (chunk === 0n) continue
    let absorbed = 0
    let next = 0
    let open = true
    const start = ratio(real, r, i)
    for (const [b, row] of rows.entries()) {
      while (open && ratio(real, r, i) > start * row.band) {
        let filled = false
        for (let step = 0; step < real.length - 1 && !filled; step++) {
          const j = (i + 1 + ((next + step) % (real.length - 1))) % real.length
          try {
            const out = exactIn(real, r.rates, r.range, i, j, chunk)
            real[i] = real[i]! + chunk
            real[j] = real[j]! - out
            absorbed += chunkUsd
            next = (next + step + 1) % (real.length - 1)
            filled = true
          } catch (e) {
            if (!(e instanceof StabrixMathError)) throw e
          }
        }
        if (!filled) open = false
      }
      rows[b]![preset] += absorbed
    }
  }
  return rows
}
