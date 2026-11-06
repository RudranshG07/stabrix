'use client'

import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import type { TxState } from '@/lib/tx'
import { shortAddress } from '@/lib/format'

export function TxStatus({ state }: { state: TxState }) {
  if (state.status === 'idle') return null
  const tone = {
    pending: 'bg-paper text-muted',
    success: 'bg-up/10 text-up',
    error: 'bg-down/10 text-down',
  }[state.status]
  return (
    <div role="status" aria-live="polite" className={`mt-4 flex items-start gap-2 rounded-2xl px-4 py-3 text-sm ${tone}`}>
      {state.status === 'pending' && <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />}
      {state.status === 'success' && <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />}
      {state.status === 'error' && <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <span className="min-w-0">
        {state.status === 'pending' && state.step}
        {state.status === 'success' && (
          <>
            {state.message}
            {state.hash && <span className="ml-2 font-mono text-xs text-muted">{shortAddress(state.hash)}</span>}
          </>
        )}
        {state.status === 'error' && state.message}
      </span>
    </div>
  )
}
