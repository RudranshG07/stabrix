'use client'

import { ArrowUpRight, ChevronDown, Wallet } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { privateKeyToAccount } from 'viem/accounts'
import { SEPOLIA_FAUCET, useTestCoins } from '@/components/test-coins'
import { shortAddress } from '@/lib/format'
import { ANVIL_ACCOUNTS, DEV_ACCOUNTS, useStabrix } from '@/lib/stabrix'

const EXPLORERS: Record<number, string> = { 8453: 'https://basescan.org/address/', 84532: 'https://sepolia.basescan.org/address/' }

export function AccountMenu() {
  const { signer, setSigner, connectInjected, deployment } = useStabrix()
  const coins = useTestCoins()
  const explorer = DEV_ACCOUNTS ? undefined : EXPLORERS[deployment.chainId]
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onClick = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [open])

  const connect = async () => {
    setError(null)
    try {
      await connectInjected()
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
      setOpen(true)
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (!DEV_ACCOUNTS && !signer ? connect() : setOpen((v) => !v))}
        className="flex min-h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-[12px] font-medium tracking-[0.06em] transition-colors hover:bg-surface-hover"
      >
        <Wallet className="size-4" aria-hidden />
        {signer ? (
          <span className="whitespace-nowrap">
            {signer.label} <span className="hidden font-mono text-xs text-muted sm:inline">{shortAddress(signer.address)}</span>
          </span>
        ) : (
          'Connect'
        )}
        <ChevronDown className="size-4" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="ink-card absolute right-0 mt-3 w-[min(19rem,calc(100vw-2rem))] overflow-hidden"
        >
          {DEV_ACCOUNTS && (
            <div className="border-b border-line p-2">
              <p className="px-2 py-1.5 text-[10px] font-medium tracking-[0.08em] text-muted uppercase">Fork accounts</p>
              {ANVIL_ACCOUNTS.map((a) => {
                const address = privateKeyToAccount(a.key).address
                const active = signer?.kind === 'dev' && signer.index === a.index
                return (
                  <button
                    key={a.index}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      setSigner({ kind: 'dev', index: a.index, label: a.label, address })
                      setOpen(false)
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-hover ${
                      active ? 'bg-surface-hover font-medium' : ''
                    }`}
                  >
                    <span>{a.label}</span>
                    <span className="font-mono text-xs text-muted">{shortAddress(address)}</span>
                  </button>
                )
              })}
            </div>
          )}
          <div className="p-2">
            {signer && explorer && (
              <a href={`${explorer}${signer.address}`} target="_blank" rel="noreferrer" role="menuitem" className="flex w-full rounded-xl px-2.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-hover items-center justify-between">
                <span>
                  View on Basescan <span className="font-mono text-xs text-muted">{shortAddress(signer.address)}</span>
                </span>
                <ArrowUpRight className="size-3.5 text-muted" aria-hidden />
              </a>
            )}
            {coins.available && (
              <>
                <button type="button" role="menuitem" onClick={coins.mint} disabled={coins.busy} className="w-full rounded-xl px-2.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-hover disabled:opacity-60">
                  {coins.busy ? 'Minting test coins...' : 'Get test coins'}
                  <span className="block text-xs text-muted">$10,000 of each of the 8 coins, one transaction</span>
                </button>
                <a href={SEPOLIA_FAUCET} target="_blank" rel="noreferrer" role="menuitem" className="flex w-full rounded-xl px-2.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-hover items-center justify-between">
                  Get Base Sepolia ETH
                  <ArrowUpRight className="size-3.5 text-muted" aria-hidden />
                </a>
              </>
            )}
            {(DEV_ACCOUNTS || !signer) && (
              <button type="button" role="menuitem" onClick={connect} className="w-full rounded-xl px-2.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-hover">
                Connect browser wallet
              </button>
            )}
            {signer && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setSigner(null)
                  setOpen(false)
                }}
                className="w-full rounded-xl px-2.5 py-2.5 text-left text-sm text-muted transition-colors hover:bg-surface-hover hover:text-ink"
              >
                Disconnect
              </button>
            )}
            {error && <p className="px-2 py-1 text-xs text-down">{error}</p>}
            {coins.error && <p className="px-2 py-1 text-xs text-down">{coins.error}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
