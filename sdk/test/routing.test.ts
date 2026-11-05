import { describe, expect, it } from 'vitest'
import {
  PRESETS,
  type Range,
  type RangeState,
  WAD,
  designRange,
  exactIn,
  rateFromDecimals,
  scaleRange,
  spotPrice,
  splitExactIn,
} from '../src/index.js'

const decimals = [6, 6, 18, 6, 18]
const rates = decimals.map(rateFromDecimals)
const per = (units: bigint) => decimals.map((d) => units * 10n ** BigInt(d))
const tokens = ['a', 'b', 'c', 'd', 'e']

function state(id: string, real: bigint[], range: Range): RangeState {
  return { id, real, rates, range, indexOf: (t) => tokens.indexOf(t) }
}

describe('presets', () => {
  it('tighter presets give better prices for the same capital', () => {
    const outs = PRESETS.map((p) => {
      const range = scaleRange(designRange(5, p), 100n * WAD)
      return exactIn(per(100n), rates, { ...range, feeBps: 0 }, 0, 2, 5n * 10n ** 6n)
    })
    expect(outs[0]!).toBeGreaterThan(outs[1]!)
    expect(outs[1]!).toBeGreaterThan(outs[2]!)
  })

  it('range edge lands near the preset deviation', () => {
    for (const p of PRESETS) {
      const range = scaleRange(designRange(5, p), 100n * WAD)
      let real = per(100n)
      let last = real
      for (let k = 0; k < 5000; k++) {
        try {
          const j = k % 4
          const out = exactIn(real, rates, range, 4, j, 10n ** 17n)
          last = real
          real = [...real]
          real[4] = real[4]! + 10n ** 17n
          real[j] = real[j]! - out
        } catch {
          break
        }
      }
      const price = Number(spotPrice(last, rates, { ...range, sumCapRatio: 2n ** 63n }, 4, 2)) / 1e18
      expect(1 - price).toBeGreaterThan((p.maxDeviationBps / 10_000) * 0.9)
      expect(1 - price).toBeLessThan((p.maxDeviationBps / 10_000) * 1.1)
    }
  })
})

describe('splitExactIn', () => {
  const range: Range = { floor: 900n * WAD, sumCapRatio: 279n * 10n ** 16n, feeBps: 1, maxShareBps: 10_000 }

  it('splits evenly across identical ranges and beats a single range', () => {
    const a = state('a', per(100n), range)
    const b = state('b', per(100n), range)
    const amount = 40n * 10n ** 6n
    const single = exactIn(a.real, rates, range, 0, 1, amount)
    const plan = splitExactIn([a, b], 'a', 'b', amount)
    expect(plan.filled).toBe(amount)
    expect(plan.amountOut).toBeGreaterThan(single)
    expect(plan.legs).toHaveLength(2)
    const diff = plan.legs[0]!.amountIn - plan.legs[1]!.amountIn
    expect(diff < 0n ? -diff : diff).toBeLessThanOrEqual(amount / 32n)
  })

  it('sends flow to the deeper range', () => {
    const shallow = state('s', per(50n), { ...range, floor: 450n * WAD })
    const deep = state('d', per(200n), { ...range, floor: 1800n * WAD })
    const plan = splitExactIn([shallow, deep], 'a', 'c', 30n * 10n ** 6n)
    const d = plan.legs.find((l) => l.id === 'd')!
    const s = plan.legs.find((l) => l.id === 's')!
    expect(d.amountIn).toBeGreaterThan(s.amountIn * 3n)
  })

  it('leg outputs equal on-chain math for each leg', () => {
    const a = state('a', per(100n), range)
    const b = state('b', per(80n), { ...range, floor: 720n * WAD })
    const plan = splitExactIn([a, b], 'd', 'e', 25n * 10n ** 6n)
    for (const leg of plan.legs) {
      const s = leg.id === 'a' ? a : b
      expect(leg.amountOut).toBe(exactIn(s.real, rates, s.range, 3, 4, leg.amountIn))
    }
  })

  it('reports partial fills instead of failing', () => {
    const a = state('a', per(100n), range)
    const plan = splitExactIn([a], 'a', 'b', 10_000n * 10n ** 6n)
    expect(plan.filled).toBeLessThan(plan.amountIn)
    expect(plan.amountOut).toBeGreaterThan(0n)
  })
})
