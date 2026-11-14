import {
  type Deployment,
  aquaAbi,
  decodeStrategy,
  parseBackstopProgram,
  parseProgram,
  stabrixBatchTakerAbi,
  stabrixOracleAbi,
  stabrixRouterAbi,
} from '@stabrix/sdk'
import type { SolanaStabrixClient } from '@stabrix/sdk/solana'
import { type Address, type Hex, type PublicClient, parseEventLogs } from 'viem'

export type StrategyKind = 'range' | 'backstop' | 'other'

interface Base {
  id: string
  block: bigint
  logIndex: number
  hash: Hex
  time: number | null
}

export type Activity = Base &
  (
    | { type: 'swap'; sender: Address; tokenIn: Address; tokenOut: Address; amountIn: bigint; amountOut: bigint; legs: bigint }
    | { type: 'ship' | 'dock'; maker: Address; app: Address; strategy: StrategyKind }
    | { type: 'cre'; token: Address; halted: boolean; priceE18: bigint }
    | { type: 'guardian'; token: Address; halted: boolean }
  )

export interface Fill {
  hash: Hex
  block: bigint
  orderHash: Hex
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  amountOut: bigint
  time: number | null
}

export interface ActivityData {
  events: Activity[]
  fills: Fill[]
}

export const activityGroup = (a: Activity) => (a.type === 'swap' ? 'swaps' : a.type === 'ship' || a.type === 'dock' ? 'liquidity' : 'oracle')

const WINDOW = 1_500_000n
const CHUNK = 50_000n
const PARALLEL = 6
const LIMIT = 60
const FILL_LIMIT = 300

function kindOf(strategy: Hex): StrategyKind {
  try {
    const order = decodeStrategy(strategy)
    if (parseProgram(order.data)) return 'range'
    if (parseBackstopProgram(order.data)) return 'backstop'
  } catch {
    return 'other'
  }
  return 'other'
}

export async function fetchActivity(client: PublicClient, d: Deployment): Promise<ActivityData> {
  const latest = await client.getBlockNumber()
  const start = latest > d.fromBlock + WINDOW ? latest - WINDOW : d.fromBlock
  const ranges: [bigint, bigint][] = []
  for (let from = start; from <= latest; from += CHUNK) ranges.push([from, from + CHUNK - 1n < latest ? from + CHUNK - 1n : latest])
  const address = [d.batchTaker, d.oracle, d.aqua, d.router, d.officialRouter]
  const logs = []
  for (let k = 0; k < ranges.length; k += PARALLEL) {
    const batch = await Promise.all(ranges.slice(k, k + PARALLEL).map(([fromBlock, toBlock]) => client.getLogs({ address, fromBlock, toBlock })))
    for (const part of batch) logs.push(...part)
  }

  const apps = new Set([d.router.toLowerCase(), d.officialRouter.toLowerCase()])
  const kinds = new Map<string, StrategyKind>()
  const out: Activity[] = []
  const base = (l: { blockNumber: bigint; logIndex: number; transactionHash: Hex }) => ({
    id: `${l.transactionHash}:${l.logIndex}`,
    block: l.blockNumber,
    logIndex: l.logIndex,
    hash: l.transactionHash,
    time: null,
  })

  for (const e of parseEventLogs({ abi: aquaAbi, logs, eventName: ['Shipped', 'Docked'] })) {
    if (e.address.toLowerCase() !== d.aqua.toLowerCase() || !apps.has(e.args.app.toLowerCase())) continue
    const key = `${e.args.maker}:${e.args.app}:${e.args.strategyHash}`.toLowerCase()
    if (e.eventName === 'Shipped') {
      const strategy = kindOf(e.args.strategy)
      kinds.set(key, strategy)
      out.push({ ...base(e), type: 'ship', maker: e.args.maker, app: e.args.app, strategy })
    } else {
      out.push({ ...base(e), type: 'dock', maker: e.args.maker, app: e.args.app, strategy: kinds.get(key) ?? 'other' })
    }
  }
  for (const e of parseEventLogs({ abi: stabrixBatchTakerAbi, logs, eventName: 'BatchSwapped' })) {
    if (e.address.toLowerCase() !== d.batchTaker.toLowerCase()) continue
    out.push({ ...base(e), type: 'swap', ...e.args })
  }
  for (const e of parseEventLogs({ abi: stabrixOracleAbi, logs, eventName: ['StatusUpdated', 'GuardianOverride'] })) {
    if (e.address.toLowerCase() !== d.oracle.toLowerCase()) continue
    if (e.eventName === 'StatusUpdated') out.push({ ...base(e), type: 'cre', token: e.args.token, halted: e.args.halted, priceE18: e.args.priceE18 })
    else out.push({ ...base(e), type: 'guardian', token: e.args.token, halted: e.args.halted })
  }

  const fills: Fill[] = []
  for (const e of parseEventLogs({ abi: stabrixRouterAbi, logs, eventName: 'Swapped' })) {
    if (!apps.has(e.address.toLowerCase())) continue
    fills.push({ hash: e.transactionHash, block: e.blockNumber, time: null, ...e.args })
  }

  const recent = out.sort((a, b) => Number(b.block - a.block) || b.logIndex - a.logIndex).slice(0, LIMIT)
  const lastFills = fills.sort((a, b) => Number(b.block - a.block)).slice(0, FILL_LIMIT)
  const blocks = [...new Set([...recent, ...lastFills].map((a) => a.block))]
  const stamps = await Promise.all(blocks.map((n) => client.getBlock({ blockNumber: n }).then((b) => Number(b.timestamp))))
  const at = new Map(blocks.map((n, k) => [n, stamps[k]!]))
  return {
    events: recent.map((a) => ({ ...a, time: at.get(a.block) ?? null })),
    fills: lastFills.map((f) => ({ ...f, time: at.get(f.block) ?? null })),
  }
}

export async function fetchSolanaActivity(client: SolanaStabrixClient): Promise<ActivityData> {
  const rows = await client.activity(40)
  const kinds = new Map<string, StrategyKind>()
  for (const r of rows) if (r.event.kind === 'open') kinds.set(r.event.strategy.toBase58(), r.event.strategyKind)
  const app = client.program.toBase58() as Address
  const addr = (k: { toBase58(): string }) => k.toBase58() as Address
  const out: Activity[] = []
  const fills: Fill[] = []
  const swaps = new Map<string, Activity & { type: 'swap' }>()
  for (const r of rows) {
    const base = { id: `${r.signature}:${r.index}`, block: BigInt(r.slot), logIndex: r.index, hash: r.signature as Hex, time: r.time }
    const e = r.event
    if (e.kind === 'swap') {
      fills.push({ hash: base.hash, block: base.block, time: r.time, orderHash: e.strategy.toBase58() as Hex, tokenIn: addr(e.mintIn), tokenOut: addr(e.mintOut), amountIn: e.amountIn, amountOut: e.amountOut })
      const prev = swaps.get(r.signature)
      if (prev) {
        prev.amountIn += e.amountIn
        prev.amountOut += e.amountOut
        prev.legs += 1n
      } else {
        const a = { ...base, type: 'swap' as const, sender: addr(e.taker), tokenIn: addr(e.mintIn), tokenOut: addr(e.mintOut), amountIn: e.amountIn, amountOut: e.amountOut, legs: 1n }
        swaps.set(r.signature, a)
        out.push(a)
      }
    } else if (e.kind === 'open') {
      out.push({ ...base, type: 'ship', maker: addr(e.maker), app, strategy: e.strategyKind })
    } else if (e.kind === 'close') {
      out.push({ ...base, type: 'dock', maker: addr(e.maker), app, strategy: kinds.get(e.strategy.toBase58()) ?? 'other' })
    } else if (e.kind === 'report') {
      out.push({ ...base, type: 'cre', token: addr(e.mint), halted: e.halted, priceE18: e.priceE9 * 1_000_000_000n })
    } else {
      out.push({ ...base, type: 'guardian', token: addr(e.mint), halted: e.halted })
    }
  }
  return {
    events: out.sort((a, b) => Number(b.block - a.block) || b.logIndex - a.logIndex).slice(0, LIMIT),
    fills: fills.sort((a, b) => Number(b.block - a.block)).slice(0, FILL_LIMIT),
  }
}
