'use client'

import { ArrowUpRight, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { DEV_ACCOUNTS } from '@/lib/config'
import { shortAddress } from '@/lib/format'
import { useMaybeStabrix } from '@/lib/stabrix'
import type { TxState } from '@/lib/tx'

const EXPLORERS: Record<number, string> = {
  8453: 'https://basescan.org/tx/',
  84532: 'https://sepolia.basescan.org/tx/',
}

export function TxStatus({ state }: { state: TxState }) {
  const ctx = useMaybeStabrix()
  if (state.status === 'idle') return null
  const tone = {
    pending: 'border-line bg-paper text-ink',
    success: 'border-up/50 bg-up/10 text-up',
    error: 'border-down/50 bg-down/10 text-down',
  }[state.status]
  const explorer = !DEV_ACCOUNTS && ctx ? EXPLORERS[ctx.deployment.chainId] : undefined
  return (
    <div role="status" aria-live="polite" className={`mt-4 flex items-start gap-2.5 rounded-[16px] border-2 px-4 py-3 text-[14px] leading-snug ${tone}`}>
      {state.status === 'pending' && <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />}
      {state.status === 'success' && <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />}
      {state.status === 'error' && <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <span className="min-w-0">
        {state.status === 'pending' && state.step}
        {state.status === 'success' && (
          <>
            {state.message}
            {state.hash &&
              (explorer ? (
                <a
                  href={`${explorer}${state.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 inline-flex items-center gap-0.5 font-mono text-[12px] text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
                >
                  {shortAddress(state.hash)}
                  <ArrowUpRight className="size-3" aria-hidden />
                </a>
              ) : (
                <span className="ml-2 font-mono text-[12px] text-muted">{shortAddress(state.hash)}</span>
              ))}
          </>
        )}
        {state.status === 'error' && state.message}
      </span>
    </div>
  )
}
