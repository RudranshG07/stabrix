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
  Halted: 'This coin is halted by the depeg sentinel. Swaps into the pool are paused.',
  RangeEdge: 'Every range reached its edge for this trade. Try a smaller amount.',
  ExposureCap: 'The trade would exceed an LP exposure cap.',
  OutOfRange: 'The trade is larger than the available liquidity.',
  InsufficientReserve: 'Not enough liquidity for this trade.',
  InsufficientOutput: 'Price moved beyond your slippage limit. Quote again.',
  Expired: 'The quote expired. Quote again.',
  StrategiesMustBeImmutable: 'This exact range already exists. Change the amount or preset.',
}

export function explain(e: unknown): string {
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
