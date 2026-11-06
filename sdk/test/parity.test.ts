import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Address, getAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  type RangeConfig,
  STABRIX_TICK_OPCODE,
  StabrixMathError,
  USE_AQUA_FLAG,
  buildOrder,
  decodeConfig,
  encodeConfig,
  exactIn,
  exactOut,
  parseProgram,
  radius,
  rateFromDecimals,
  strategyHash,
  virtualBalances,
} from '../src/index.js'

interface Case {
  real: string
  floor: string
  fee: number
  maxShare: number
  i: number
  j: number
  amount: string
  outAmount: string
  exactIn: string
  exactOut: string
  radius: string
}

const v = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'vectors.json'), 'utf8')) as {
  config: `0x${string}`
  nativeData: `0x${string}`
  nativeTraits: string
  nativeHash: `0x${string}`
  officialData: `0x${string}`
  officialHash: `0x${string}`
  stabrixOpcode: number
  cases: Case[]
}

const decimals = [6, 6, 18, 6, 18]
const rates = decimals.map(rateFromDecimals)
const config: RangeConfig = {
  tokens: [1, 2, 3, 4, 5].map((k) => getAddress(`0x${(0x11n * BigInt(k)).toString(16).repeat(20)}`) as Address),
  decimals,
  floor: 900n * 10n ** 18n,
  sumCapRatio: 279n * 10n ** 16n,
  feeBps: 4,
  fxFeeBps: 12,
  maxShareBps: 3000,
  oracle: getAddress('0x9999999999999999999999999999999999999999'),
}
const maker = getAddress('0x00000000000000000000000000000000000A11CE')
const extruction = getAddress('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')

const run = (f: () => bigint) => {
  try {
    return f().toString()
  } catch (e) {
    if (e instanceof StabrixMathError) return 'revert'
    throw e
  }
}

describe('parity with Solidity', () => {
  it('opcode matches the router', () => {
    expect(STABRIX_TICK_OPCODE).toBe(v.stabrixOpcode)
  })

  it('encodes config byte for byte', () => {
    expect(encodeConfig(config)).toBe(v.config)
    expect(decodeConfig(v.config)).toEqual(config)
  })

  it('builds native orders and strategy hashes identically', () => {
    const order = buildOrder(maker, config, { kind: 'native' }, 7n)
    expect(order.data).toBe(v.nativeData)
    expect(order.traits).toBe(BigInt(v.nativeTraits))
    expect(order.traits).toBe(USE_AQUA_FLAG)
    expect(strategyHash(order)).toBe(v.nativeHash)
  })

  it('builds official-router orders identically', () => {
    const order = buildOrder(maker, config, { kind: 'official', extruction }, 7n)
    expect(order.data).toBe(v.officialData)
    expect(strategyHash(order)).toBe(v.officialHash)
  })

  it('parses its own programs back', () => {
    const parsed = parseProgram(v.officialData)
    expect(parsed?.venue).toEqual({ kind: 'official', extruction })
    expect(parsed?.config).toEqual(config)
    expect(parsed?.salt).toBe(7n)
  })

  it.each(v.cases.map((c, k) => [k, c] as const))('math case %i', (_, c) => {
    const real = c.real.split(',').map(BigInt)
    const range = { floor: BigInt(c.floor), sumCapRatio: 29n * 10n ** 17n, feeBps: c.fee, maxShareBps: c.maxShare }
    expect(radius(virtualBalances(real, rates, range.floor)).toString()).toBe(c.radius)
    expect(run(() => exactIn(real, rates, range, c.i, c.j, BigInt(c.amount)))).toBe(c.exactIn)
    expect(run(() => exactOut(real, rates, range, c.i, c.j, BigInt(c.outAmount)))).toBe(c.exactOut)
  })
})
