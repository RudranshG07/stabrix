import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Address, getAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  type BackstopConfig,
  STABRIX_BACKSTOP_OPCODE,
  StabrixMathError,
  backstopOut,
  buildBackstopOrder,
  decodeBackstopConfig,
  encodeBackstopConfig,
  exactIn,
  exactOut,
  parseBackstopProgram,
  parseProgram,
} from '../src/index.js'

interface OrbitalCase {
  real: string
  rates: string
  floor: string
  fee: number
  maxShare: number
  i: number
  j: number
  amount: string
  outAmount: string
  exactIn: string
  exactOut: string
}

interface BackstopCase {
  amountIn: string
  absorbedIn: string
  faceIn: string
  marketIn: string
  priceOut: string
  decimalsIn: number
  decimalsOut: number
  startBps: number
  endBps: number
  cap: string
  out: string
}

const v = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fx-vectors.json'), 'utf8')) as {
  backstopConfig: `0x${string}`
  backstopNativeData: `0x${string}`
  backstopOfficialData: `0x${string}`
  backstopOpcode: number
  orbital: OrbitalCase[]
  backstop: BackstopCase[]
}

const run = (f: () => bigint) => {
  try {
    return f().toString()
  } catch (e) {
    if (e instanceof StabrixMathError) return 'revert'
    throw e
  }
}

const config: BackstopConfig = {
  tokens: [1, 2, 3, 4, 5, 6, 7, 8].map((k) => getAddress(`0x${(0x11n * BigInt(k)).toString(16).repeat(20)}`) as Address),
  decimals: [6, 6, 18, 18, 18, 6, 18, 2],
  startDiscountBps: 200,
  endDiscountBps: 1000,
  capPerToken: 25_000n * 10n ** 18n,
  oracle: getAddress('0x9999999999999999999999999999999999999999'),
}
const maker = getAddress('0x00000000000000000000000000000000000A11CE')

describe('backstop encoding matches Solidity', () => {
  it('uses the same opcode', () => {
    expect(STABRIX_BACKSTOP_OPCODE).toBe(v.backstopOpcode)
  })

  it('encodes config byte for byte', () => {
    expect(encodeBackstopConfig(config)).toBe(v.backstopConfig)
    expect(decodeBackstopConfig(v.backstopConfig)).toEqual(config)
  })

  it('builds the native order program', () => {
    expect(buildBackstopOrder(maker, config, { kind: 'native' }, 7n).data).toBe(v.backstopNativeData)
  })

  it('builds the official router program', () => {
    const extruction = getAddress('0x0000000000000000000000000000000000000003')
    expect(buildBackstopOrder(maker, config, { kind: 'official', extruction }, 7n).data).toBe(v.backstopOfficialData)
  })

  it('parses backstops and never mistakes them for ranges', () => {
    const parsed = parseBackstopProgram(v.backstopOfficialData)
    expect(parsed?.config).toEqual(config)
    expect(parsed?.salt).toBe(7n)
    expect(parseProgram(v.backstopOfficialData)).toBeNull()
    expect(parseProgram(v.backstopNativeData)).toBeNull()
  })
})

describe('FX Orbital math matches Solidity', () => {
  it.each(v.orbital.map((c, k) => [k, c] as const))('case %i', (_, c) => {
    const real = c.real.split(',').map(BigInt)
    const rates = c.rates.split(',').map(BigInt)
    const range = { floor: BigInt(c.floor), sumCapRatio: 54n * 10n ** 17n, feeBps: c.fee, maxShareBps: c.maxShare }
    expect(run(() => exactIn(real, rates, range, c.i, c.j, BigInt(c.amount)))).toBe(c.exactIn)
    expect(run(() => exactOut(real, rates, range, c.i, c.j, BigInt(c.outAmount)))).toBe(c.exactOut)
  })
})

describe('backstop math matches Solidity', () => {
  it.each(v.backstop.map((c, k) => [k, c] as const))('case %i', (_, c) => {
    const got = run(() =>
      backstopOut({
        amountIn: BigInt(c.amountIn),
        absorbedIn: BigInt(c.absorbedIn),
        faceIn: BigInt(c.faceIn),
        marketIn: BigInt(c.marketIn),
        priceOut: BigInt(c.priceOut),
        decimalsIn: c.decimalsIn,
        decimalsOut: c.decimalsOut,
        startBps: c.startBps,
        endBps: c.endBps,
        cap: BigInt(c.cap),
      }),
    )
    expect(got).toBe(c.out)
  })
})
