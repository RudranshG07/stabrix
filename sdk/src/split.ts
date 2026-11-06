import { type Range, StabrixMathError, exactIn } from './math.js'

export interface RangeState {
  id: string
  real: readonly bigint[]
  rates: readonly bigint[]
  range: Range
  indexOf: (token: string) => number
  quote?: (i: number, j: number, amountIn: bigint) => bigint
}

export interface Leg {
  id: string
  amountIn: bigint
  amountOut: bigint
}

export interface SplitResult {
  legs: Leg[]
  amountIn: bigint
  amountOut: bigint
  filled: bigint
}

function outFor(s: RangeState, i: number, j: number, amount: bigint): bigint | null {
  if (amount === 0n) return 0n
  try {
    return s.quote ? s.quote(i, j, amount) : exactIn(s.real, s.rates, s.range, i, j, amount)
  } catch (e) {
    if (e instanceof StabrixMathError) return null
    throw e
  }
}

export function splitExactIn(
  ranges: readonly RangeState[],
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  chunks = 64,
): SplitResult {
  const usable = ranges
    .map((s) => ({ s, i: s.indexOf(tokenIn), j: s.indexOf(tokenOut) }))
    .filter((x) => x.i >= 0 && x.j >= 0)
  const alloc = usable.map(() => 0n)
  const outs = usable.map(() => 0n)
  if (usable.length === 0 || amountIn <= 0n) return { legs: [], amountIn, amountOut: 0n, filled: 0n }

  const n = BigInt(Math.max(1, chunks))
  const minChunk = amountIn / 4096n > 0n ? amountIn / 4096n : 1n
  let base = amountIn / n > 0n ? amountIn / n : amountIn
  let remaining = amountIn

  while (remaining > 0n) {
    const chunk = remaining < base * 2n ? remaining : base
    let best = -1
    let bestGain = 0n
    let bestOut = 0n
    for (let k = 0; k < usable.length; k++) {
      const { s, i, j } = usable[k]!
      const out = outFor(s, i, j, alloc[k]! + chunk)
      if (out === null) continue
      const gain = out - outs[k]!
      if (gain > bestGain) {
        best = k
        bestGain = gain
        bestOut = out
      }
    }
    if (best < 0) {
      if (chunk <= minChunk) break
      base = chunk / 2n
      continue
    }
    alloc[best] = alloc[best]! + chunk
    outs[best] = bestOut
    remaining -= chunk
  }

  const legs: Leg[] = []
  for (let k = 0; k < usable.length; k++) {
    if (alloc[k]! > 0n) legs.push({ id: usable[k]!.s.id, amountIn: alloc[k]!, amountOut: outs[k]! })
  }
  const filled = amountIn - remaining
  return { legs, amountIn, amountOut: legs.reduce((a, l) => a + l.amountOut, 0n), filled }
}
