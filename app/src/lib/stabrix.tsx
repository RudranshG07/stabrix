'use client'

import { type Deployment, StabrixClient } from '@stabrix/sdk'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  type Account,
  type Address,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  getAddress,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ANVIL_ACCOUNTS, DEV_ACCOUNTS, POLL_MS, PRICE_API, RPC_URL } from './config'

export type Wallet = WalletClient<Transport, Chain, Account>

export type Signer =
  | { kind: 'dev'; index: number; label: string; address: Address }
  | { kind: 'injected'; label: string; address: Address }

interface StabrixContext {
  deployment: Deployment
  chain: Chain
  publicClient: PublicClient
  client: StabrixClient
  signer: Signer | null
  wallet: Wallet | null
  setSigner: (s: Signer | null) => void
  connectInjected: () => Promise<void>
}

const Ctx = createContext<StabrixContext | null>(null)

interface RawDeployment extends Omit<Deployment, 'fromBlock'> {
  fromBlock: number | string
}

async function fetchDeployment(): Promise<Deployment> {
  const res = await fetch('/api/deployment', { cache: 'no-store' })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? 'deployment unavailable')
  const raw = body as RawDeployment
  return {
    ...raw,
    fromBlock: BigInt(raw.fromBlock),
    tokens: raw.tokens.map((t) => ({ ...t, address: getAddress(t.address) })),
  }
}

declare global {
  interface Window {
    ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
  }
}

function Inner({ deployment, children }: { deployment: Deployment; children: ReactNode }) {
  const chain = useMemo(
    () =>
      defineChain({
        id: deployment.chainId,
        name: deployment.chainId === 8453 ? 'Base' : `Chain ${deployment.chainId}`,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [RPC_URL] } },
        contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
      }),
    [deployment.chainId],
  )
  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: http(RPC_URL, { batch: true }) }) as PublicClient,
    [chain],
  )
  const client = useMemo(() => new StabrixClient(publicClient, deployment), [publicClient, deployment])

  const [signer, setSigner] = useState<Signer | null>(null)
  const autoSelected = useRef(false)

  useEffect(() => {
    if (!DEV_ACCOUNTS || autoSelected.current) return
    autoSelected.current = true
    const first = ANVIL_ACCOUNTS[0]
    setSigner({ kind: 'dev', index: first.index, label: first.label, address: privateKeyToAccount(first.key).address })
  }, [])

  const wallet = useMemo<Wallet | null>(() => {
    if (!signer) return null
    if (signer.kind === 'dev') {
      const entry = ANVIL_ACCOUNTS.find((a) => a.index === signer.index)
      if (!entry) return null
      return createWalletClient({ chain, account: privateKeyToAccount(entry.key), transport: http(RPC_URL) })
    }
    if (typeof window === 'undefined' || !window.ethereum) return null
    return createWalletClient({
      chain,
      account: { address: signer.address, type: 'json-rpc' } as Account,
      transport: custom(window.ethereum),
    }) as Wallet
  }, [signer, chain])

  const connectInjected = async () => {
    if (!window.ethereum) throw new Error('No browser wallet found')
    const [address] = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[]
    if (!address) throw new Error('No account selected')
    await window.ethereum
      .request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${chain.id.toString(16)}` }] })
      .catch(() => undefined)
    setSigner({ kind: 'injected', label: 'Browser wallet', address: getAddress(address) })
  }

  const value = { deployment, chain, publicClient, client, signer, wallet, setSigner, connectInjected }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function useDeploymentQuery() {
  return useQuery({ queryKey: ['deployment'], queryFn: fetchDeployment, retry: 1, staleTime: Number.POSITIVE_INFINITY })
}

function Loader({ children }: { children: ReactNode }) {
  const { data } = useDeploymentQuery()
  return data ? <Inner deployment={data}>{children}</Inner> : <>{children}</>
}

export function RequireDeployment({ children }: { children: ReactNode }) {
  const ctx = useContext(Ctx)
  const { error, isLoading, refetch } = useDeploymentQuery()
  if (ctx) return <>{children}</>
  if (isLoading) {
    return (
      <div className="py-12" aria-busy="true">
        <div className="h-10 w-64 animate-pulse rounded-lg bg-surface-hover" />
        <div className="mt-8 h-80 animate-pulse rounded-[26px] bg-surface-hover" />
      </div>
    )
  }
  return (
    <div className="max-w-xl py-12">
      <p className="font-display text-[17px] tracking-[0.2em] uppercase">Not connected</p>
      <h1 className="title mt-3 text-[44px] leading-none">No deployment found</h1>
      <p className="mt-3 text-muted">{(error as Error)?.message ?? 'Start the devnet with ops/devnet.sh, then retry.'}</p>
      <button
        type="button"
        onClick={() => refetch()}
        className="font-pill mt-6 min-h-12 rounded-full border-[3px] border-surface-line bg-ink px-7 pt-[3px] text-[15px] text-on-accent uppercase"
      >
        Retry
      </button>
    </div>
  )
}

export function StabrixProvider({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }))
  return (
    <QueryClientProvider client={qc}>
      <Loader>{children}</Loader>
    </QueryClientProvider>
  )
}

export function useMaybeStabrix() {
  return useContext(Ctx)
}

export function useStabrix() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStabrix outside provider')
  return ctx
}

export function useRanges() {
  const { client } = useStabrix()
  return useQuery({ queryKey: ['ranges'], queryFn: () => client.listRanges(), refetchInterval: POLL_MS })
}

export function useMarket() {
  const { client } = useStabrix()
  return useQuery({ queryKey: ['market'], queryFn: () => client.market(), refetchInterval: POLL_MS })
}

export function useOracleStatus() {
  const { client } = useStabrix()
  return useQuery({ queryKey: ['oracle-status'], queryFn: () => client.oracleStatus(), refetchInterval: POLL_MS })
}

export function useBalances(owner: Address | undefined) {
  const { client } = useStabrix()
  return useQuery({
    queryKey: ['balances', owner],
    queryFn: () => client.balancesOf(owner!),
    enabled: !!owner,
    refetchInterval: POLL_MS,
  })
}

const feedAbi = [
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const

export function useChainlinkPrices() {
  const { deployment, publicClient } = useStabrix()
  return useQuery({
    queryKey: ['feeds', deployment.chainId],
    enabled: deployment.chainId === 8453,
    refetchInterval: POLL_MS * 4,
    queryFn: async () => {
      const zero = '0x0000000000000000000000000000000000000000'
      const feeds = deployment.tokens
        .map((t) => ({ symbol: t.symbol, feed: t.marketFeed !== zero ? t.marketFeed : t.feed }))
        .filter((f) => f.feed !== zero)
      const results = await publicClient.multicall({
        contracts: feeds.map((f) => ({ address: f.feed, abi: feedAbi, functionName: 'latestRoundData' })),
      })
      return Object.fromEntries(
        feeds.map((f, k) => [f.symbol, results[k]?.status === 'success' ? (results[k].result as readonly bigint[])[1]! : null]),
      ) as Record<string, bigint | null>
    },
  })
}

export function useApiPrices() {
  return useQuery({
    queryKey: ['api-prices'],
    refetchInterval: POLL_MS,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`${PRICE_API}/prices`)
      if (!res.ok) throw new Error('price api unavailable')
      return (await res.json()) as Record<string, number>
    },
  })
}

export async function setApiPrice(symbol: string, price: number) {
  const res = await fetch(`${PRICE_API}/price`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ symbol, price }),
  })
  if (!res.ok) throw new Error('price api rejected the update')
}

export async function clearApiPrice(symbol: string) {
  const res = await fetch(`${PRICE_API}/price/${symbol}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('price api rejected the update')
}

export { ANVIL_ACCOUNTS, DEV_ACCOUNTS }
