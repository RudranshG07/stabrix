import { type Address, type Hex, concatHex, getAddress, hexToBigInt, numberToHex, sliceHex, size } from 'viem'
import { BPS, type Range, rateFromDecimals } from './math.js'

export const MAX_TOKENS = 9
export const MAX_FEE_BPS = 1000

export interface RangeConfig {
  tokens: Address[]
  decimals: number[]
  floor: bigint
  sumCapRatio: bigint
  feeBps: number
  maxShareBps: number
  sentinel: Address
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export function sortTokens<T extends { address: Address }>(tokens: readonly T[]): T[] {
  return [...tokens].sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1))
}

export function encodeConfig(c: RangeConfig): Hex {
  const n = c.tokens.length
  if (n < 2 || n > MAX_TOKENS || c.decimals.length !== n) throw new Error('bad token count')
  if (c.feeBps > MAX_FEE_BPS) throw new Error('fee too high')
  if (c.maxShareBps <= 0 || BigInt(c.maxShareBps) > BPS) throw new Error('bad max share')
  for (let k = 1; k < n; k++) {
    if (BigInt(c.tokens[k]!) <= BigInt(c.tokens[k - 1]!)) throw new Error('tokens must be sorted ascending')
  }
  for (const d of c.decimals) if (d < 0 || d > 18) throw new Error('bad decimals')
  return concatHex([
    numberToHex(n, { size: 1 }),
    ...c.tokens.map((t) => getAddress(t).toLowerCase() as Hex),
    ...c.decimals.map((d) => numberToHex(d, { size: 1 })),
    numberToHex(c.floor, { size: 16 }),
    numberToHex(c.sumCapRatio, { size: 8 }),
    numberToHex(c.feeBps, { size: 2 }),
    numberToHex(c.maxShareBps, { size: 2 }),
    getAddress(c.sentinel).toLowerCase() as Hex,
  ])
}

export function decodeConfig(a: Hex): RangeConfig {
  const n = Number(hexToBigInt(sliceHex(a, 0, 1)))
  if (n < 2 || n > MAX_TOKENS || size(a) !== 1 + 21 * n + 48) throw new Error('bad config')
  const tokens: Address[] = []
  const decimals: number[] = []
  for (let k = 0; k < n; k++) tokens.push(getAddress(sliceHex(a, 1 + 20 * k, 21 + 20 * k)))
  for (let k = 0; k < n; k++) decimals.push(Number(hexToBigInt(sliceHex(a, 1 + 20 * n + k, 2 + 20 * n + k))))
  const o = 1 + 21 * n
  return {
    tokens,
    decimals,
    floor: hexToBigInt(sliceHex(a, o, o + 16)),
    sumCapRatio: hexToBigInt(sliceHex(a, o + 16, o + 24)),
    feeBps: Number(hexToBigInt(sliceHex(a, o + 24, o + 26))),
    maxShareBps: Number(hexToBigInt(sliceHex(a, o + 26, o + 28))),
    sentinel: getAddress(sliceHex(a, o + 28, o + 48)),
  }
}

export const toRange = (c: RangeConfig): Range => ({
  floor: c.floor,
  sumCapRatio: c.sumCapRatio,
  feeBps: c.feeBps,
  maxShareBps: c.maxShareBps,
})

export const ratesOf = (c: RangeConfig) => c.decimals.map(rateFromDecimals)
