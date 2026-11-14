'use client'

import type { SolanaSigner } from '@stabrix/sdk/solana'
import { SolanaSignTransaction, type SolanaSignTransactionFeature } from '@solana/wallet-standard-features'
import { PublicKey, VersionedTransaction } from '@solana/web3.js'
import { getWallets } from '@wallet-standard/app'
import type { Wallet as StandardWallet, WalletAccount } from '@wallet-standard/base'
import {
  StandardConnect,
  type StandardConnectFeature,
  StandardDisconnect,
  type StandardDisconnectFeature,
  StandardEvents,
  type StandardEventsFeature,
} from '@wallet-standard/features'
import { useEffect, useState } from 'react'

export interface SolanaWalletOption {
  id: string
  name: string
  icon?: string
  wallet: StandardWallet
}

const KEY = 'stabrix-solana-wallet'

export const solanaChainOf = (cluster: string) => (cluster === 'mainnet-beta' ? 'solana:mainnet' : cluster === 'devnet' ? 'solana:devnet' : 'solana:localnet')

function usable(w: StandardWallet) {
  return StandardConnect in w.features && SolanaSignTransaction in w.features && w.chains.some((c) => c.startsWith('solana:'))
}

function toOption(w: StandardWallet): SolanaWalletOption {
  return { id: `sol:${w.name}`, name: w.name, icon: w.icon, wallet: w }
}

export function useSolanaWallets(enabled: boolean): SolanaWalletOption[] {
  const [list, setList] = useState<SolanaWalletOption[]>([])
  useEffect(() => {
    if (!enabled) return
    const registry = getWallets()
    const refresh = () => setList(registry.get().filter(usable).map(toOption))
    refresh()
    const offRegister = registry.on('register', refresh)
    const offUnregister = registry.on('unregister', refresh)
    return () => {
      offRegister()
      offUnregister()
    }
  }, [enabled])
  return list
}

export async function connectSolana(option: SolanaWalletOption, silent = false): Promise<WalletAccount> {
  const feature = option.wallet.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect]
  const { accounts } = await feature.connect(silent ? { silent: true } : undefined)
  const account = accounts.find((a) => a.chains.some((c) => c.startsWith('solana:'))) ?? accounts[0]
  if (!account) throw new Error(`No account selected in ${option.name}.`)
  return account
}

export async function disconnectSolana(option: SolanaWalletOption) {
  const feature = option.wallet.features[StandardDisconnect] as StandardDisconnectFeature[typeof StandardDisconnect] | undefined
  await feature?.disconnect().catch(() => {})
}

export function onSolanaAccounts(option: SolanaWalletOption, cb: (address: string | null) => void) {
  const feature = option.wallet.features[StandardEvents] as StandardEventsFeature[typeof StandardEvents] | undefined
  if (!feature) return () => {}
  return feature.on('change', ({ accounts }) => {
    if (!accounts) return
    const a = accounts.find((x) => x.chains.some((c) => c.startsWith('solana:'))) ?? accounts[0]
    cb(a?.address ?? null)
  })
}

export function solanaSigner(option: SolanaWalletOption, account: WalletAccount, chain: string): SolanaSigner {
  const feature = option.wallet.features[SolanaSignTransaction] as SolanaSignTransactionFeature[typeof SolanaSignTransaction]
  return {
    publicKey: new PublicKey(account.address),
    signTransactions: async (txs: VersionedTransaction[]) => {
      const outputs = await feature.signTransaction(
        ...txs.map((tx) => ({ account, transaction: tx.serialize(), chain: chain as `${string}:${string}` })),
      )
      return outputs.map((o) => VersionedTransaction.deserialize(o.signedTransaction))
    },
  }
}

export const rememberSolanaWallet = (id: string | null) => {
  try {
    if (id) localStorage.setItem(KEY, id)
    else localStorage.removeItem(KEY)
  } catch {}
}

export const rememberedSolanaWallet = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function solanaWalletError(e: unknown, name: string): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/reject|denied|cancel/i.test(msg)) return `Request rejected in ${name}.`
  return msg || `Could not connect ${name}.`
}
