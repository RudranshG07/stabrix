'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { BaseError, ContractFunctionRevertedError } from 'viem'

export type TxState =
  | { status: 'idle' }
  | { status: 'pending'; step: string }
  | { status: 'success'; message: string; hash?: string }
  | { status: 'error'; message: string }

const FRIENDLY: Record<string, string> = {
  Halted: 'This coin is halted by the oracle. Ranges refuse it; only backstops buy it now.',
  NotDepegged: 'This coin is healthy, so backstops are not buying it.',
  PayoutHalted: 'A backstop never pays out in a halted coin. Pick a healthy coin to receive.',
  BackstopFull: 'The backstops are full for this coin. Try a smaller amount.',
  ExactInOnly: 'Backstops only take exact-input trades.',
  StaleRate: 'An FX rate is stale, so FX swaps pause until it updates.',
  MissingFeed: 'A price feed account was missing from the trade. Quote again.',
  Slippage: 'Price moved beyond your slippage limit. Quote again.',
  Unauthorized: 'Only the wallet that opened this strategy can close it.',
  UnknownCoin: 'This coin is not listed on the Stabrix oracle.',
  ZeroAmount: 'The amount is too small to trade.',
  InsufficientLiquidity: 'A provider spent from their wallet. Quote again to route around them.',
  RangeEdge: 'Every range reached its edge for this trade. Try a smaller amount.',
  ExposureCap: 'The trade would exceed an LP exposure cap.',
  OutOfRange: 'The trade is larger than the available liquidity.',
  InsufficientReserve: 'Not enough liquidity for this trade.',
  InsufficientOutput: 'Price moved beyond your slippage limit. Quote again.',
  Expired: 'The quote expired. Quote again.',
  StrategiesMustBeImmutable: 'This exact strategy already exists. Change the amount or settings.',
}

export function explain(e: unknown): string {
  if (e instanceof Error && e.name === 'SolanaError') {
    const name = e.message.trim()
    if (FRIENDLY[name]) return FRIENDLY[name]
    if (/reject|denied|cancel/i.test(name)) return 'Request rejected in wallet.'
    return name.length > 220 ? `${name.slice(0, 220)}…` : name
  }
  if (e instanceof Error && /User rejected|rejected the request|denied/i.test(e.message)) return 'Request rejected in wallet.'
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName
      if (name && FRIENDLY[name]) return FRIENDLY[name]
      if (name) return `Reverted: ${name}`
    }
    if (/User rejected|denied/i.test(e.message)) return 'Request rejected in wallet.'
    return e.shortMessage
  }
  return e instanceof Error ? e.message : 'Something went wrong.'
}

export function useTx() {
  const [state, setState] = useState<TxState>({ status: 'idle' })
  const qc = useQueryClient()
  const run = useCallback(
    async (step: string, fn: (progress: (s: string) => void) => Promise<{ message: string; hash?: string }>) => {
      setState({ status: 'pending', step })
      try {
        const result = await fn((s) => setState({ status: 'pending', step: s }))
        setState({ status: 'success', ...result })
        await qc.invalidateQueries()
      } catch (e) {
        setState({ status: 'error', message: explain(e) })
      }
    },
    [qc],
  )
  return { state, run, reset: () => setState({ status: 'idle' }) }
}
