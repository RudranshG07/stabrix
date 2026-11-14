import { StabrixMathError } from '../math.js'

export const E9 = 10n ** 9n

export const solRate = (decimals: number, priceE9: bigint) => priceE9 * 10n ** BigInt(18 - decimals)

const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n)

export interface SolBackstopQuote {
  amountIn: bigint
  absorbedIn: bigint
  faceIn: bigint
  marketIn: bigint
  priceOut: bigint
  decimalsIn: number
  decimalsOut: number
  startBps: number
  endBps: number
  cap: bigint
}

export function solBackstopOut(x: SolBackstopQuote): bigint {
  if (x.amountIn === 0n) throw new StabrixMathError('ZeroAmount')
  const unitIn = 10n ** BigInt(x.decimalsIn)
  const absorbed = (x.absorbedIn * x.faceIn) / unitIn
  const incoming = (x.amountIn * x.faceIn) / unitIn
  if (absorbed + incoming > x.cap) throw new StabrixMathError('BackstopFull')
  const span = BigInt(x.endBps - x.startBps)
  const twoCap = 2n * x.cap
  const discount = ceilDiv((BigInt(x.startBps) * twoCap + span * (2n * absorbed + incoming)) * 100_000n, twoCap)
  if (discount >= E9) throw new StabrixMathError('ZeroAmount')
  const market = x.marketIn < x.faceIn ? x.marketIn : x.faceIn
  const value = (x.amountIn * market * (E9 - discount)) / (unitIn * E9)
  const out = (value * 10n ** BigInt(x.decimalsOut)) / x.priceOut
  if (out <= 1n) throw new StabrixMathError('ZeroAmount')
  return out - 1n
}
