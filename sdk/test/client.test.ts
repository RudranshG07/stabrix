import { type Address, type PublicClient, getAddress, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  type Deployment,
  type LiveBackstop,
  type LiveRange,
  type Market,
  type PriceInfo,
  StabrixClient,
  WAD,
  backstopOut,
  buildBackstopOrder,
  buildOrder,
  designRange,
  exactIn,
  presetById,
  rateWithPrice,
  scaleRange,
} from '../src/index.js'

const addr = (k: number) => getAddress(`0x${k.toString(16).padStart(40, '0')}`) as Address
const symbols = ['USDC', 'DAI', 'EURC']
const decimals = [6, 18, 6]
const tokens = [addr(0x10), addr(0x20), addr(0x30)]
const prices = [WAD, WAD, 112n * 10n ** 16n]

const deployment: Deployment = {
  chainId: 8453,
  fromBlock: 1n,
  aqua: addr(1),
  router: addr(2),
  officialRouter: addr(3),
  extruction: addr(4),
  backstop: addr(5),
  batchTaker: addr(6),
  oracle: addr(7),
  lens: addr(8),
  tokens: tokens.map((address, k) => ({
    address,
    symbol: symbols[k]!,
    name: symbols[k]!,
    decimals: decimals[k]!,
    feed: zeroAddress,
    marketFeed: zeroAddress,
  })),
}
const client = new StabrixClient({} as PublicClient, deployment)

const units = (usd: bigint, k: number) => (usd * 10n ** BigInt(decimals[k]!) * WAD) / prices[k]!

function range(id: number, usd: bigint, spendable?: bigint[]): LiveRange {
  const designed = scaleRange(designRange(3, presetById('balanced')), usd * WAD)
  const config = {
    tokens,
    decimals,
    floor: designed.floor,
    sumCapRatio: designed.sumCapRatio,
    feeBps: 1,
    fxFeeBps: 30,
    maxShareBps: 10_000,
    oracle: deployment.oracle,
  }
  const balances = tokens.map((_, k) => units(usd, k))
  return {
    kind: 'range',
    id: `r${id}`,
    hash: `0x${id.toString(16).padStart(64, '0')}`,
    maker: addr(0x100 + id),
    app: deployment.router,
    venue: { kind: 'native' },
    order: buildOrder(addr(0x100 + id), config, { kind: 'native' }, BigInt(id)),
    salt: BigInt(id),
    blockNumber: 1n,
    balances,
    spendable: spendable ?? balances,
    config,
    range: { floor: config.floor, sumCapRatio: config.sumCapRatio, feeBps: 1, maxShareBps: 10_000 },
    rates: decimals.map((d, k) => rateWithPrice(d, prices[k]!)),
    fx: [false, false, true],
    tradable: true,
  }
}

function backstop(id: number, pledgeUsdc: bigint): LiveBackstop {
  const config = { tokens, decimals, startDiscountBps: 200, endDiscountBps: 1000, capPerToken: 10_000n * WAD, oracle: deployment.oracle }
  const balances = [pledgeUsdc * 10n ** 6n, 0n, 0n]
  return {
    kind: 'backstop',
    id: `b${id}`,
    hash: `0x${(0xb0 + id).toString(16).padStart(64, '0')}`,
    maker: addr(0x200 + id),
    app: deployment.router,
    venue: { kind: 'native' },
    order: buildBackstopOrder(addr(0x200 + id), config, { kind: 'native' }, BigInt(id)),
    salt: BigInt(id),
    blockNumber: 1n,
    balances,
    spendable: balances,
    config,
  }
}

function market(ranges: LiveRange[], backstops: LiveBackstop[], halted: Partial<Record<number, bigint>> = {}): Market {
  const p = new Map<string, PriceInfo>()
  tokens.forEach((t, k) => {
    p.set(t.toLowerCase(), { priceE18: prices[k]!, fx: k === 2, halted: halted[k] !== undefined, depegE18: halted[k] ?? null })
  })
  return { block: 1n, ranges, backstops, prices: p }
}

describe('client quoting mirrors the contracts', () => {
  it('charges the FX fee only on pairs with an FX coin', () => {
    const r = range(1, 10_000n)
    const m = market([r], [])
    const usdPair = client.quoteExactIn(m, tokens[0]!, tokens[1]!, 100n * 10n ** 6n)
    const fxPair = client.quoteExactIn(m, tokens[0]!, tokens[2]!, 100n * 10n ** 6n)
    expect(usdPair.amountOut).toBe(exactIn(r.balances, r.rates, { ...r.range, feeBps: 1 }, 0, 1, 100n * 10n ** 6n))
    expect(fxPair.amountOut).toBe(exactIn(r.balances, r.rates, { ...r.range, feeBps: 30 }, 0, 2, 100n * 10n ** 6n))
  })

  it('routes around a maker whose wallet cannot pay', () => {
    const short = range(1, 10_000n, [units(10_000n, 0), 10n ** 18n, units(10_000n, 2)])
    const healthy = range(2, 1_000n)
    const q = client.quoteExactIn(market([short, healthy], []), tokens[0]!, tokens[1]!, 50n * 10n ** 6n)
    const shortLeg = q.legs.find((l) => l.id === 'r1')
    expect(shortLeg?.amountOut ?? 0n).toBeLessThanOrEqual(10n ** 18n)
    expect(q.legs.find((l) => l.id === 'r2')!.amountOut).toBeGreaterThan(40n * 10n ** 18n)
    expect(q.filled).toBe(50n * 10n ** 6n)

    const empty = range(3, 10_000n, [units(10_000n, 0), 0n, units(10_000n, 2)])
    const only = client.quoteExactIn(market([empty, healthy], []), tokens[0]!, tokens[1]!, 50n * 10n ** 6n)
    expect(only.legs.map((l) => l.id)).toEqual(['r2'])
  })

  it('skips ranges with a stale FX rate', () => {
    const r = { ...range(1, 10_000n), tradable: false }
    const q = client.quoteExactIn(market([r], []), tokens[0]!, tokens[1]!, 10n ** 6n)
    expect(q.legs).toHaveLength(0)
  })

  it('sends a halted coin only to backstops, at the backstop price', () => {
    const r = range(1, 10_000n)
    const b = backstop(1, 5_000n)
    const m = market([r], [b], { 1: 93n * 10n ** 16n })
    const amount = 1_000n * WAD
    const q = client.quoteExactIn(m, tokens[1]!, tokens[0]!, amount)
    expect(q.legs.map((l) => l.id)).toEqual(['b1'])
    const want = backstopOut({
      amountIn: amount,
      absorbedIn: 0n,
      faceIn: WAD,
      marketIn: 93n * 10n ** 16n,
      priceOut: WAD,
      decimalsIn: 18,
      decimalsOut: 6,
      startBps: 200,
      endBps: 1000,
      cap: 10_000n * WAD,
    })
    expect(q.amountOut).toBe(want)
  })

  it('a dormant backstop takes nothing', () => {
    const q = client.quoteExactIn(market([], [backstop(1, 5_000n)]), tokens[1]!, tokens[0]!, WAD)
    expect(q.legs).toHaveLength(0)
  })

  it('never pays a halted coin out of a backstop', () => {
    const m = market([], [backstop(1, 5_000n)], { 1: 93n * 10n ** 16n, 0: 90n * 10n ** 16n })
    const q = client.quoteExactIn(m, tokens[1]!, tokens[0]!, WAD)
    expect(q.legs).toHaveLength(0)
  })

  it('maps legs back to their strategies', () => {
    const r1 = range(1, 10_000n)
    const r2 = range(2, 10_000n)
    const q = client.quoteExactIn(market([r1, r2], []), tokens[0]!, tokens[1]!, 5_000n * 10n ** 6n)
    const legs = client.toLegs(q)
    expect(legs).toHaveLength(2)
    expect(legs.reduce((a, l) => a + l.amountIn, 0n)).toBe(q.filled)
  })
})

describe('log scanning', () => {
  it('concurrent scans never duplicate events', async () => {
    const { encodeAbiParameters, encodeEventTopics } = await import('viem')
    const { aquaAbi } = await import('../src/index.js')
    const topics = encodeEventTopics({ abi: aquaAbi, eventName: 'Docked' })
    const log = {
      address: deployment.aqua,
      topics,
      data: encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'bytes32' }],
        [addr(0x100), deployment.router, `0x${'ab'.repeat(32)}`],
      ),
      blockNumber: 5n,
      transactionHash: `0x${'cd'.repeat(32)}`,
      logIndex: 0,
      blockHash: `0x${'ef'.repeat(32)}`,
      transactionIndex: 0,
      removed: false,
    }
    let calls = 0
    const fake = {
      getBlockNumber: async () => 10n,
      getLogs: async () => {
        calls++
        await new Promise((r) => setTimeout(r, 20))
        return [log]
      },
    } as unknown as PublicClient
    const c = new StabrixClient(fake, deployment)
    const scan = (c as unknown as { scan: () => Promise<bigint> }).scan.bind(c)
    await Promise.all([scan(), scan(), scan()])
    await scan()
    expect(calls).toBe(1)
    expect((c as unknown as { events: unknown[] }).events).toHaveLength(1)
  })
})
