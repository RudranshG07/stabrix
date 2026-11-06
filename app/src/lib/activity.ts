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

const WINDOW = 50_000n
const CHUNK = 5_000n
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
  const logs = []
  for (let from = start; from <= latest; from += CHUNK) {
    const to = from + CHUNK - 1n < latest ? from + CHUNK - 1n : latest
    logs.push(...(await client.getLogs({ address: [d.batchTaker, d.oracle, d.aqua, d.router, d.officialRouter], fromBlock: from, toBlock: to })))
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
