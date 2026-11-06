'use client'

import { useEffect, useState } from 'react'

export interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, handler: (...args: never[]) => void) => void
  removeListener?: (event: string, handler: (...args: never[]) => void) => void
}

export interface WalletOption {
  id: string
  name: string
  icon?: string
  provider: Eip1193
}

interface Announcement {
  info: { uuid: string; name: string; icon: string; rdns: string }
  provider: Eip1193
}

export const WALLET_KEY = 'stabrix-wallet'

export function useWalletOptions(): WalletOption[] {
  const [options, setOptions] = useState<WalletOption[]>([])

  useEffect(() => {
    const found = new Map<string, WalletOption>()
    const onAnnounce = (event: Event) => {
      const { info, provider } = (event as CustomEvent<Announcement>).detail
      const id = info.rdns || info.uuid
      if (found.has(id)) return
      const icon = typeof info.icon === 'string' ? info.icon.trim() : ''
      found.set(id, { id, name: info.name, icon: icon.startsWith('data:image/') ? icon : undefined, provider })
      setOptions([...found.values()])
    }
    window.addEventListener('eip6963:announceProvider', onAnnounce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    const fallback = setTimeout(() => {
      if (found.size === 0 && window.ethereum) setOptions([{ id: 'injected', name: 'Browser wallet', provider: window.ethereum }])
    }, 500)
    return () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce)
      clearTimeout(fallback)
    }
  }, [])

  return options
}

export function rememberWallet(id: string | null) {
  try {
    if (id) localStorage.setItem(WALLET_KEY, id)
    else localStorage.removeItem(WALLET_KEY)
  } catch {}
}

export function rememberedWallet(): string | null {
  try {
    return localStorage.getItem(WALLET_KEY)
  } catch {
    return null
  }
}

export function walletError(e: unknown, wallet: string, chainName: string): string {
  const err = e as { code?: number; shortMessage?: string; message?: string }
  if (err.code === 4001) return 'Request rejected in the wallet.'
  if (err.code === -32002) return `${wallet} already has a request open. Open the extension to finish it.`
  if (err.code === 4902 || /chain|network/i.test(err.message ?? '')) return `${wallet} could not switch to ${chainName}. Switch the network in the wallet, then connect again.`
  return err.shortMessage ?? err.message ?? `Could not connect to ${wallet}.`
}
