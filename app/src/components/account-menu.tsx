'use client'

import { ArrowUpRight, ChevronDown, Loader2, Wallet } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { privateKeyToAccount } from 'viem/accounts'
import { SEPOLIA_FAUCET, useTestCoins } from '@/components/test-coins'
import { shortAddress } from '@/lib/format'
import { ANVIL_ACCOUNTS, DEV_ACCOUNTS, useStabrix } from '@/lib/stabrix'
import type { WalletOption } from '@/lib/wallets'

const EXPLORERS: Record<number, string> = { 8453: 'https://basescan.org/address/', 84532: 'https://sepolia.basescan.org/address/' }
const item = 'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-hover disabled:opacity-60'
const heading = 'px-2.5 pt-1.5 pb-1 text-[10px] font-medium tracking-[0.08em] text-muted uppercase'

function WalletIcon({ option }: { option: WalletOption }) {
  if (!option.icon) return <Wallet className="size-5 shrink-0 text-muted" aria-hidden />
  return <Image src={option.icon} alt="" width={20} height={20} unoptimized className="size-5 shrink-0 rounded-md" />
}

export function AccountMenu() {
  const { signer, setSigner, wallets, connectInjected, disconnect, deployment } = useStabrix()
  const coins = useTestCoins()
  const explorer = DEV_ACCOUNTS ? undefined : EXPLORERS[deployment.chainId]
  const [open, setOpen] = useState(false)
  const [connecting, setConnecting] = useState<string | null>(null)
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

  const connect = async (option: WalletOption) => {
    setError(null)
    setConnecting(option.id)
    try {
      await connectInjected(option)
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setConnecting(null)
    }
  }

  const injected = signer?.kind === 'injected' ? signer : null

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-[13px] font-medium transition-colors hover:bg-surface-hover"
      >
        <Wallet className="size-4" aria-hidden />
        {signer ? (
          <span className="whitespace-nowrap">
            <span className="hidden sm:inline">{signer.label} </span>
            <span className="font-mono text-xs text-muted">{shortAddress(signer.address)}</span>
          </span>
        ) : (
          'Connect wallet'
        )}
        <ChevronDown className="size-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="ink-card absolute right-0 z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden">
          {DEV_ACCOUNTS && (
            <div className="border-b border-line p-2">
              <p className={heading}>Fork accounts</p>
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
                    className={`${item} justify-between ${active ? 'bg-surface-hover font-medium' : ''}`}
                  >
                    <span>{a.label}</span>
                    <span className="font-mono text-xs text-muted">{shortAddress(address)}</span>
                  </button>
                )
              })}
            </div>
          )}

          {injected ? (
            <div className="p-2">
              <p className={heading}>Connected with {injected.label}</p>
              {explorer ? (
                <a href={`${explorer}${injected.address}`} target="_blank" rel="noreferrer" role="menuitem" className={`${item} justify-between`}>
                  <span className="font-mono text-xs">{shortAddress(injected.address)}</span>
                  <span className="flex items-center gap-1 text-xs text-muted">
                    Basescan <ArrowUpRight className="size-3.5" aria-hidden />
                  </span>
                </a>
              ) : (
                <p className="px-2.5 py-2 font-mono text-xs">{shortAddress(injected.address)}</p>
              )}
              {coins.available && (
                <>
                  <button type="button" role="menuitem" onClick={coins.mint} disabled={coins.busy} className={`${item} flex-col items-start gap-0`}>
                    <span>{coins.busy ? 'Minting test coins...' : 'Get test coins'}</span>
                    <span className="text-xs text-muted">$10,000 of each of the 8 coins, one transaction</span>
                  </button>
                  <a href={SEPOLIA_FAUCET} target="_blank" rel="noreferrer" role="menuitem" className={`${item} justify-between`}>
                    Get Base Sepolia ETH
                    <ArrowUpRight className="size-3.5 text-muted" aria-hidden />
                  </a>
                </>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  disconnect()
                  setOpen(false)
                }}
                className={`${item} text-muted hover:text-ink`}
              >
                Disconnect
              </button>
              {coins.error && <p className="px-2.5 py-1 text-xs text-down">{coins.error}</p>}
            </div>
          ) : (
            <div className="p-2">
              <p className={heading}>{DEV_ACCOUNTS ? 'Browser wallets' : 'Choose a wallet'}</p>
              {wallets.map((w) => (
                <button key={w.id} type="button" role="menuitem" onClick={() => connect(w)} disabled={connecting !== null} className={item}>
                  <WalletIcon option={w} />
                  <span className="flex-1">{w.name}</span>
                  {connecting === w.id && <Loader2 className="size-4 animate-spin text-muted" aria-hidden />}
                </button>
              ))}
              {wallets.length === 0 && (
                <div className="px-2.5 py-2 text-sm">
                  <p className="text-muted">No browser wallet found.</p>
                  <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 underline decoration-line underline-offset-2 hover:decoration-ink">
                    Install MetaMask <ArrowUpRight className="size-3.5" aria-hidden />
                  </a>
                </div>
              )}
              {error && <p className="px-2.5 py-1.5 text-xs text-down">{error}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
