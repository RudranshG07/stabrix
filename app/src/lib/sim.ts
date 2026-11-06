import {
  type PresetId,
  type Range,
  StabrixMathError,
  WAD,
  defaultMaxShareBps,
  designRange,
  exactIn,
  presetById,
  scaleRange,
  spotPrice,
} from '@stabrix/sdk'

export const SIM_COINS = ['USDC', 'USDT', 'DAI', 'USDS', 'USDe'] as const
const N = SIM_COINS.length
const BAD = N - 1
const RATES: readonly bigint[] = Array.from({ length: N }, () => WAD)
const OPEN = 2n ** 63n
const yieldFrame = () => new Promise((r) => setTimeout(r, 0))

function range(preset: PresetId, perCoin: bigint, edge: boolean): Range {
  const r = scaleRange(designRange(N, presetById(preset), defaultMaxShareBps(N)), perCoin)
  return edge ? r : { ...r, sumCapRatio: OPEN, maxShareBps: 10_000 }
}

export interface ImpactPoint {
  usd: number
  bps: number
}

export const IMPACT_SIZES = Array.from({ length: 49 }, (_, k) => 1_000 * 10 ** (k / 16))

export async function impactCurve(preset: PresetId | 'flat', perCoinUsd = 1_000_000): Promise<ImpactPoint[]> {
  const perCoin = BigInt(perCoinUsd) * WAD
  const r: Range =
    preset === 'flat' ? { floor: 0n, sumCapRatio: OPEN, feeBps: 0, maxShareBps: 10_000 } : { ...range(preset, perCoin, true), feeBps: 0 }
  const real = Array.from({ length: N }, () => perCoin)
  const points: ImpactPoint[] = []
  for (const usd of IMPACT_SIZES) {
    const amountIn = BigInt(Math.round(usd)) * WAD
    try {
      const out = exactIn(real, RATES, r, 0, 2, amountIn)
      points.push({ usd, bps: (Number(amountIn - out) / Number(amountIn)) * 10_000 })
    } catch (e) {
      if (!(e instanceof StabrixMathError)) throw e
      break
    }
  }
  await yieldFrame()
  return points
}

export interface DepegPoint {
  price: number
  open: number
  edge: number
  halted: number
  hold: number
}

const PER_COIN = 100_000n * WAD
const CHUNK = PER_COIN / 400n

interface Pool {
  real: bigint[]
  range: Range
}

const pool = (preset: PresetId, edge: boolean): Pool => ({ real: Array.from({ length: N }, () => PER_COIN), range: range(preset, PER_COIN, edge) })

function priceOfBad(p: Pool) {
  return Number(spotPrice(p.real, RATES, { ...p.range, sumCapRatio: OPEN }, BAD, 0)) / 1e18
}

function dumpTo(p: Pool, target: number) {
  let refusals = 0
  for (let k = 0; refusals < N - 1 && priceOfBad(p) > target; k++) {
    const j = k % (N - 1)
    try {
      const out = exactIn(p.real, RATES, p.range, BAD, j, CHUNK)
      p.real[BAD] = p.real[BAD]! + CHUNK
      p.real[j] = p.real[j]! - out
      refusals = 0
    } catch (e) {
      if (!(e instanceof StabrixMathError)) throw e
      refusals++
    }
  }
}

function change(p: Pool, price: number) {
  const value = p.real.reduce((s, x, k) => s + (Number(x) / 1e18) * (k === BAD ? price : 1), 0)
  return (value / (N * 100_000) - 1) * 100
}

export async function depegCurve(preset: PresetId, haltBelow = 0.97, floor = 0.8, step = 0.005): Promise<DepegPoint[]> {
  const open = pool(preset, false)
  const edge = pool(preset, true)
  const halted = pool(preset, true)
  const out: DepegPoint[] = []
  for (let k = 0; ; k++) {
    const price = Math.round((1 - k * step) * 1000) / 1000
    if (price < floor - 1e-9) break
    dumpTo(open, price)
    dumpTo(edge, price)
    if (price >= haltBelow) dumpTo(halted, price)
    out.push({
      price,
      open: change(open, price),
      edge: change(edge, price),
      halted: change(halted, price),
      hold: -((1 - price) * 100) / N,
    })
    await yieldFrame()
  }
  return out
}

export function backstopPay(market: number, fill: number, startBps: number, endBps: number, face = 1) {
  const discount = (startBps + (endBps - startBps) * fill) / 10_000
  return Math.min(market, face) * (1 - discount)
}
