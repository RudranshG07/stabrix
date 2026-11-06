import { BPS, type Range, StabrixMathError, WAD, exactIn, spotPrice, sumRatio } from './math.js'

export type PresetId = 'tight' | 'balanced' | 'wide'

export interface RangePreset {
  id: PresetId
  label: string
  concentration: number
  maxDeviationBps: number
  feeBps: number
  fxFeeBps: number
}

export const PRESETS: readonly RangePreset[] = [
  { id: 'tight', label: 'Tight', concentration: 30, maxDeviationBps: 50, feeBps: 1, fxFeeBps: 5 },
  { id: 'balanced', label: 'Balanced', concentration: 9, maxDeviationBps: 200, feeBps: 4, fxFeeBps: 10 },
  { id: 'wide', label: 'Wide', concentration: 2, maxDeviationBps: 800, feeBps: 10, fxFeeBps: 30 },
]

export const presetById = (id: PresetId) => {
  const p = PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`unknown preset ${id}`)
  return p
}

const NORM = 18
const UNIT = WAD

export interface DesignedRange extends Range {
  capitalEfficiency: number
}

export function designRange(n: number, preset: RangePreset, maxShareBps = 10_000): DesignedRange {
  const deposit = 1_000n * UNIT
  const floor = deposit * BigInt(preset.concentration)
  const rates = Array.from({ length: n }, () => 10n ** BigInt(36 - NORM))
  const open: Range = { floor, sumCapRatio: 2n ** 63n, feeBps: 0, maxShareBps: Number(BPS) }
  const bad = n - 1
  const threshold = WAD - (WAD * BigInt(preset.maxDeviationBps)) / BPS
  const step = deposit / 500n

  let real = Array.from({ length: n }, () => deposit)
  let edge = sumRatio(real, rates, floor)
  for (let guard = 0; guard < 100_000; guard++) {
    let moved = false
    for (let j = 0; j < n - 1; j++) {
      try {
        const out = exactIn(real, rates, open, bad, j, step)
        const next = [...real]
        next[bad] = next[bad]! + step
        next[j] = next[j]! - out
        real = next
        moved = true
      } catch (e) {
        if (!(e instanceof StabrixMathError)) throw e
      }
    }
    if (!moved) break
    edge = sumRatio(real, rates, floor)
    if (spotPrice(real, rates, open, bad, 0) <= threshold) break
  }
  return {
    floor,
    sumCapRatio: edge,
    feeBps: preset.feeBps,
    maxShareBps,
    capitalEfficiency: preset.concentration + 1,
  }
}

export function scaleRange(designed: DesignedRange, depositPerCoinNormalized: bigint): Range {
  return {
    floor: (designed.floor * depositPerCoinNormalized) / (1_000n * UNIT),
    sumCapRatio: designed.sumCapRatio,
    feeBps: designed.feeBps,
    maxShareBps: designed.maxShareBps,
  }
}
