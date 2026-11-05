export const WAD = 10n ** 18n
export const BPS = 10_000n
export const ROUNDING_BUFFER = 1n

export interface Range {
  floor: bigint
  sumCapRatio: bigint
  feeBps: number
  maxShareBps: number
}

export type StabrixErrorCode =
  | 'SameToken'
  | 'ZeroAmount'
  | 'OffSurface'
  | 'OutOfRange'
  | 'InsufficientReserve'
  | 'RangeEdge'
  | 'ExposureCap'
  | 'ValueDecreased'

export class StabrixMathError extends Error {
  constructor(readonly code: StabrixErrorCode) {
    super(code)
    this.name = 'StabrixMathError'
  }
}

const fail = (code: StabrixErrorCode): never => {
  throw new StabrixMathError(code)
}

export function sqrt(a: bigint): bigint {
  if (a < 0n) throw new RangeError('sqrt of negative')
  if (a < 2n) return a
  let x = 1n << ((BigInt(a.toString(2).length) + 1n) >> 1n)
  for (;;) {
    const y = (x + a / x) >> 1n
    if (y >= x) return x
    x = y
  }
}

const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n)

export const rateFromDecimals = (decimals: number) => 10n ** BigInt(36 - decimals)

export function virtualBalances(real: readonly bigint[], rates: readonly bigint[], floor: bigint): bigint[] {
  return real.map((x, k) => (x * rates[k]!) / WAD + floor)
}

export function radius(v: readonly bigint[]): bigint {
  const n = BigInt(v.length)
  let s = 0n
  let q = 0n
  for (const x of v) {
    s += x
    q += x * x
  }
  const ss = s * s
  const nq = (n - 1n) * q
  if (ss < nq) fail('OffSurface')
  return (s + sqrt(ss - nq)) / (n - 1n)
}

function sumSqExcept(v: readonly bigint[], r: bigint, i: number, j: number): bigint {
  let s = 0n
  for (let k = 0; k < v.length; k++) {
    if (k === i || k === j) continue
    if (v[k]! > r) fail('OutOfRange')
    const d = r - v[k]!
    s += d * d
  }
  return s
}

export function spotPrice(real: readonly bigint[], rates: readonly bigint[], p: Range, i: number, j: number): bigint {
  const v = virtualBalances(real, rates, p.floor)
  const r = radius(v)
  return ((((r - v[i]!) * WAD) / (r - v[j]!)) * rates[i]!) / rates[j]!
}

export function exactIn(
  real: readonly bigint[],
  rates: readonly bigint[],
  p: Range,
  i: number,
  j: number,
  amountIn: bigint,
): bigint {
  if (i === j) fail('SameToken')
  if (amountIn === 0n) fail('ZeroAmount')
  const v = virtualBalances(real, rates, p.floor)
  const r = radius(v)
  const vi = v[i]! + (((amountIn * (BPS - BigInt(p.feeBps))) / BPS) * rates[i]!) / WAD
  if (vi > r) fail('OutOfRange')
  const rr = r * r
  const t = sumSqExcept(v, r, i, j) + (r - vi) * (r - vi)
  if (t > rr) fail('OutOfRange')
  const vj = r - sqrt(rr - t)
  if (vj >= v[j]!) fail('ZeroAmount')
  let amountOut = ((v[j]! - vj) * WAD) / rates[j]!
  if (amountOut <= ROUNDING_BUFFER) fail('ZeroAmount')
  amountOut -= ROUNDING_BUFFER
  verify(real, rates, p, i, j, amountIn, amountOut, r)
  return amountOut
}

export function exactOut(
  real: readonly bigint[],
  rates: readonly bigint[],
  p: Range,
  i: number,
  j: number,
  amountOut: bigint,
): bigint {
  if (i === j) fail('SameToken')
  if (amountOut === 0n) fail('ZeroAmount')
  if (amountOut > real[j]!) fail('InsufficientReserve')
  const v = virtualBalances(real, rates, p.floor)
  const r = radius(v)
  const outNorm = ceilDiv(amountOut * rates[j]!, WAD)
  if (outNorm > v[j]!) fail('InsufficientReserve')
  const vj = v[j]! - outNorm
  const rr = r * r
  const t = sumSqExcept(v, r, i, j) + (r - vj) * (r - vj)
  if (t > rr) fail('OutOfRange')
  const vi = r - sqrt(rr - t)
  const netNorm = vi > v[i]! ? vi - v[i]! : 0n
  const netIn = ceilDiv(netNorm * WAD, rates[i]!)
  const amountIn = ceilDiv(netIn * BPS, BPS - BigInt(p.feeBps)) + ROUNDING_BUFFER
  verify(real, rates, p, i, j, amountIn, amountOut, r)
  return amountIn
}

export function verify(
  real: readonly bigint[],
  rates: readonly bigint[],
  p: Range,
  i: number,
  j: number,
  amountIn: bigint,
  amountOut: bigint,
  rBefore: bigint,
): void {
  if (amountOut > real[j]!) fail('InsufficientReserve')
  const next = [...real]
  next[i] = next[i]! + amountIn
  next[j] = next[j]! - amountOut
  const v = virtualBalances(next, rates, p.floor)
  let sumV = 0n
  let total = 0n
  let heaviest = 0n
  for (const x of v) {
    sumV += x
    total += x - p.floor
    if (x > heaviest) heaviest = x
  }
  if (sumV * WAD > p.sumCapRatio * rBefore && v[i] === heaviest) fail('RangeEdge')
  if (BigInt(p.maxShareBps) < BPS && (v[i]! - p.floor) * BPS > BigInt(p.maxShareBps) * total) fail('ExposureCap')
  const rAfter = radius(v)
  if (rAfter < rBefore) fail('ValueDecreased')
}

export function applySwap(real: readonly bigint[], i: number, j: number, amountIn: bigint, amountOut: bigint): bigint[] {
  const next = [...real]
  next[i] = next[i]! + amountIn
  next[j] = next[j]! - amountOut
  return next
}

export function sumRatio(real: readonly bigint[], rates: readonly bigint[], floor: bigint): bigint {
  const v = virtualBalances(real, rates, floor)
  const r = radius(v)
  return (v.reduce((a, b) => a + b, 0n) * WAD) / r
}

export function edgeUtilization(real: readonly bigint[], rates: readonly bigint[], p: Range): number {
  const n = BigInt(real.length)
  const center = n * WAD - sqrt(n * WAD * WAD)
  const now = sumRatio(real, rates, p.floor)
  if (p.sumCapRatio <= center) return 1
  const used = Number(now - center) / Number(p.sumCapRatio - center)
  return Math.min(1, Math.max(0, used))
}
