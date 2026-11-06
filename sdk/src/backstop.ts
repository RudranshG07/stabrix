import { type Address, type Hex, concatHex, getAddress, hexToBigInt, numberToHex, size, sliceHex } from 'viem'
import { StabrixMathError, WAD } from './math.js'

export const MAX_BACKSTOP_DISCOUNT_BPS = 5000
export const BACKSTOP_FIXED_BYTES = 40
const MAX_TOKENS = 9
const BPS_TO_WAD = 10n ** 14n

export interface BackstopConfig {
  tokens: Address[]
  decimals: number[]
  startDiscountBps: number
  endDiscountBps: number
  capPerToken: bigint
  oracle: Address
}

function check(c: Pick<BackstopConfig, 'startDiscountBps' | 'endDiscountBps' | 'capPerToken' | 'oracle'>) {
  if (c.startDiscountBps > c.endDiscountBps || c.endDiscountBps > MAX_BACKSTOP_DISCOUNT_BPS) throw new Error('bad discount')
  if (c.capPerToken <= 0n) throw new Error('bad cap')
  if (BigInt(c.oracle) === 0n) throw new Error('backstop needs an oracle')
}

export function encodeBackstopConfig(c: BackstopConfig): Hex {
  const n = c.tokens.length
  if (n < 2 || n > MAX_TOKENS || c.decimals.length !== n) throw new Error('bad token count')
  check(c)
  for (let k = 1; k < n; k++) {
    if (BigInt(c.tokens[k]!) <= BigInt(c.tokens[k - 1]!)) throw new Error('tokens must be sorted ascending')
  }
  for (const d of c.decimals) if (d < 0 || d > 18) throw new Error('bad decimals')
  return concatHex([
    numberToHex(n, { size: 1 }),
    ...c.tokens.map((t) => getAddress(t).toLowerCase() as Hex),
    ...c.decimals.map((d) => numberToHex(d, { size: 1 })),
    numberToHex(c.startDiscountBps, { size: 2 }),
    numberToHex(c.endDiscountBps, { size: 2 }),
    numberToHex(c.capPerToken, { size: 16 }),
    getAddress(c.oracle).toLowerCase() as Hex,
  ])
}

export function decodeBackstopConfig(a: Hex): BackstopConfig {
  const n = Number(hexToBigInt(sliceHex(a, 0, 1)))
  if (n < 2 || n > MAX_TOKENS || size(a) !== 1 + 21 * n + BACKSTOP_FIXED_BYTES) throw new Error('bad backstop config')
  const tokens: Address[] = []
  const decimals: number[] = []
  for (let k = 0; k < n; k++) tokens.push(getAddress(sliceHex(a, 1 + 20 * k, 21 + 20 * k)))
  for (let k = 0; k < n; k++) decimals.push(Number(hexToBigInt(sliceHex(a, 1 + 20 * n + k, 2 + 20 * n + k))))
  const o = 1 + 21 * n
  const c: BackstopConfig = {
    tokens,
    decimals,
    startDiscountBps: Number(hexToBigInt(sliceHex(a, o, o + 2))),
    endDiscountBps: Number(hexToBigInt(sliceHex(a, o + 2, o + 4))),
    capPerToken: hexToBigInt(sliceHex(a, o + 4, o + 20)),
    oracle: getAddress(sliceHex(a, o + 20, o + 40)),
  }
  check(c)
  return c
}

export interface BackstopQuote {
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

const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n)

export function backstopRoom(x: Pick<BackstopQuote, 'absorbedIn' | 'faceIn' | 'decimalsIn' | 'cap'>): bigint {
  const absorbed = (x.absorbedIn * x.faceIn) / 10n ** BigInt(x.decimalsIn)
  return x.cap > absorbed ? x.cap - absorbed : 0n
}

export function backstopOut(x: BackstopQuote): bigint {
  const unitIn = 10n ** BigInt(x.decimalsIn)
  const absorbed = (x.absorbedIn * x.faceIn) / unitIn
  const incoming = (x.amountIn * x.faceIn) / unitIn
  if (absorbed + incoming > x.cap) throw new StabrixMathError('BackstopFull')
  const span = BigInt(x.endBps - x.startBps)
  const twoCap = 2n * x.cap
  const discount = ceilDiv((BigInt(x.startBps) * twoCap + span * (2n * absorbed + incoming)) * BPS_TO_WAD, twoCap)
  const valueOut = (x.amountIn * x.marketIn * (WAD - discount)) / (unitIn * WAD)
  let out = (valueOut * 10n ** BigInt(x.decimalsOut)) / x.priceOut
  if (out <= 1n) throw new StabrixMathError('ZeroAmount')
  out -= 1n
  return out
}
