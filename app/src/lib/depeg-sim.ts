import { type PresetId, type Range, StabrixMathError, WAD, designRange, exactIn, presetById, scaleRange, spotPrice } from '@stabrix/sdk'

export const SIM_COINS = ['USDC', 'USDT', 'DAI', 'USDS', 'USDe'] as const
const N = SIM_COINS.length
const BAD = N - 1
const PER_COIN = 100_000n * WAD
const CHUNK = PER_COIN / 400n
const RATES: readonly bigint[] = Array.from({ length: N }, () => WAD)
const OPEN = 2n ** 63n

export interface PoolState {
  real: bigint[]
  range: Range
}

export interface SimPoint {
  price: number
  noEdge: number
  edge: number
  sentinel: number
  hold: number
  absorbedNoEdge: number
  absorbedEdge: number
  absorbedSentinel: number
}

function makePool(preset: PresetId, edge: boolean): PoolState {
  const range = scaleRange(designRange(N, presetById(preset)), PER_COIN)
  return {
    real: Array.from({ length: N }, () => PER_COIN),
    range: edge ? range : { ...range, sumCapRatio: OPEN },
  }
}

function priceOfBad(pool: PoolState): number {
  return Number(spotPrice(pool.real, RATES, { ...pool.range, sumCapRatio: OPEN }, BAD, 0)) / 1e18
}

function dumpTo(pool: PoolState, target: number): void {
  let refusals = 0
  for (let k = 0; refusals < N - 1 && priceOfBad(pool) > target; k++) {
    const j = k % (N - 1)
    try {
      const out = exactIn(pool.real, RATES, pool.range, BAD, j, CHUNK)
      pool.real[BAD] = pool.real[BAD]! + CHUNK
      pool.real[j] = pool.real[j]! - out
      refusals = 0
    } catch (e) {
      if (!(e instanceof StabrixMathError)) throw e
      refusals++
    }
  }
}

const valueChange = (pool: PoolState, price: number) => {
  const total = pool.real.reduce((s, x, k) => s + (Number(x) / 1e18) * (k === BAD ? price : 1), 0)
  return (total / (N * 100_000) - 1) * 100
}

const absorbed = (pool: PoolState) => Number(pool.real[BAD]! - PER_COIN) / 1e18

export async function simulateDepeg(preset: PresetId, haltBelow: number, floorPrice = 0.8, step = 0.005): Promise<SimPoint[]> {
  const noEdge = makePool(preset, false)
  const edge = makePool(preset, true)
  const sentinel = makePool(preset, true)
  const points: SimPoint[] = []
  for (let price = 1; price >= floorPrice - 1e-9; price -= step) {
    dumpTo(noEdge, price)
    dumpTo(edge, price)
    if (price >= haltBelow) dumpTo(sentinel, price)
    points.push({
      price,
      noEdge: valueChange(noEdge, price),
      edge: valueChange(edge, price),
      sentinel: valueChange(sentinel, price),
      hold: -((1 - price) * 100) / N,
      absorbedNoEdge: absorbed(noEdge),
      absorbedEdge: absorbed(edge),
      absorbedSentinel: absorbed(sentinel),
    })
    await new Promise((r) => setTimeout(r, 0))
  }
  return points
}

export async function orbitFrames(floorPrice = 0.85, step = 0.005): Promise<PoolState[][]> {
  const pools = (['tight', 'balanced', 'wide'] as const).map((p) => makePool(p, true))
  const frames: PoolState[][] = []
  for (let price = 1; price >= floorPrice - 1e-9; price -= step) {
    for (const pool of pools) dumpTo(pool, price)
    frames.push(pools.map((p) => ({ real: [...p.real], range: { ...p.range } })))
    await new Promise((r) => setTimeout(r, 0))
  }
  return frames
}
