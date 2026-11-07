'use client'

import { type Deployment, StabrixClient } from '@stabrix/sdk'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
import { Button } from '@/components/ui'
import { fetchActivity } from './activity'
import { ANVIL_ACCOUNTS, DEV_ACCOUNTS, POLL_MS, PRICE_API, PUBLIC_RPCS, RPC_URL } from './config'
import { type Eip1193, type WalletOption, onChain, rememberWallet, rememberedWallet, switchChain, useWalletOptions, walletError } from './wallets'

export type Wallet = WalletClient<Transport, Chain, Account>

export type Signer =
  | { kind: 'dev'; index: number; label: string; address: Address }
  | { kind: 'injected'; label: string; address: Address; walletId: string }

interface StabrixContext {
  deployment: Deployment
  rpcUrl: string
  chain: Chain
  publicClient: PublicClient
  client: StabrixClient
  signer: Signer | null
  wallet: Wallet | null
  setSigner: (s: Signer | null) => void
  wallets: WalletOption[]
  connectInjected: (option: WalletOption) => Promise<void>
  disconnect: () => void
}

const Ctx = createContext<StabrixContext | null>(null)

const CHAIN_NAMES: Record<number, string> = { 8453: 'Base', 84532: 'Base Sepolia' }
const EXPLORERS: Record<number, string> = { 8453: 'https://basescan.org', 84532: 'https://sepolia.basescan.org' }

interface RawDeployment extends Omit<Deployment, 'fromBlock'> {
  fromBlock: number | string
  network: string
  available: string[]
}

interface Loaded {
  deployment: Deployment
  network: string
  available: string[]
}

async function fetchDeployment(network: string): Promise<Loaded> {
  const res = await fetch(`/api/deployment${network ? `?network=${encodeURIComponent(network)}` : ''}`, { cache: 'no-store' })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? 'deployment unavailable')
  const { network: name, available, ...raw } = body as RawDeployment
  return {
    network: name,
    available,
    deployment: {
      ...raw,
      fromBlock: BigInt(raw.fromBlock),
      tokens: raw.tokens.map((t) => ({ ...t, address: getAddress(t.address) })),
    },
  }
}

const NETWORK_KEY = 'stabrix.network'

interface NetworkContext {
  network: string | null
  current: string | null
  available: string[]
  select: (network: string) => void
}

const NetCtx = createContext<NetworkContext>({ network: null, current: null, available: [], select: () => {} })

const newQueryClient = () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })

export function useNetwork() {
  return useContext(NetCtx)
}

function initialNetwork() {
  try {
    return new URL(window.location.href).searchParams.get('network') ?? localStorage.getItem(NETWORK_KEY) ?? ''
  } catch {
    return ''
  }
}

declare global {
  interface Window {
    ethereum?: Eip1193
  }
}

function Inner({ deployment, rpcUrl, children }: { deployment: Deployment; rpcUrl: string; children: ReactNode }) {
  const chain = useMemo(
    () =>
      defineChain({
        id: deployment.chainId,
        name: CHAIN_NAMES[deployment.chainId] ?? `Chain ${deployment.chainId}`,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
        blockExplorers: EXPLORERS[deployment.chainId] ? { default: { name: 'Basescan', url: EXPLORERS[deployment.chainId]! } } : undefined,
        contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
      }),
    [deployment.chainId, rpcUrl],
  )
  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: http(rpcUrl, { batch: true }) }) as PublicClient,
    [chain, rpcUrl],
  )
  const client = useMemo(() => new StabrixClient(publicClient, deployment), [publicClient, deployment])

  const [signer, setSigner] = useState<Signer | null>(null)
  const [provider, setProvider] = useState<Eip1193 | null>(null)
  const wallets = useWalletOptions()
  const autoSelected = useRef(false)
  const reconnected = useRef(false)

  useEffect(() => {
    if (!DEV_ACCOUNTS || autoSelected.current) return
    autoSelected.current = true
    const first = ANVIL_ACCOUNTS[0]
    if (!first) return
    setSigner({ kind: 'dev', index: first.index, label: first.label, address: privateKeyToAccount(first.key).address })
  }, [])

  const wallet = useMemo<Wallet | null>(() => {
    if (!signer) return null
    if (signer.kind === 'dev') {
      const entry = ANVIL_ACCOUNTS.find((a) => a.index === signer.index)
      if (!entry) return null
      return createWalletClient({ chain, account: privateKeyToAccount(entry.key), transport: http(rpcUrl) })
    }
    if (!provider) return null
    return createWalletClient({
      chain,
      account: { address: signer.address, type: 'json-rpc' } as Account,
      transport: custom(onChain(provider, chain)),
    }) as Wallet
  }, [signer, chain, provider, rpcUrl])

  useEffect(() => {
    if (reconnected.current || signer || wallets.length === 0) return
    const id = rememberedWallet()
    const option = wallets.find((w) => w.id === id)
    if (!option) return
    reconnected.current = true
    option.provider
      .request({ method: 'eth_accounts' })
      .then((accounts) => {
        const [address] = accounts as string[]
        if (!address) return
        setProvider(option.provider)
        setSigner({ kind: 'injected', label: option.name, address: getAddress(address), walletId: option.id })
      })
      .catch(() => {})
  }, [wallets, signer])

  useEffect(() => {
    if (!provider?.on || signer?.kind !== 'injected') return
    const onAccounts = (accounts: string[]) => {
      if (accounts.length === 0) {
        setSigner(null)
        setProvider(null)
        rememberWallet(null)
      } else {
        setSigner((s) => (s && s.kind === 'injected' ? { ...s, address: getAddress(accounts[0]!) } : s))
      }
    }
    provider.on('accountsChanged', onAccounts as (...args: never[]) => void)
    return () => provider.removeListener?.('accountsChanged', onAccounts as (...args: never[]) => void)
  }, [provider, signer?.kind])

  const connectInjected = async (option: WalletOption) => {
    const p = option.provider
    try {
      const [address] = (await p.request({ method: 'eth_requestAccounts' })) as string[]
      if (!address) throw new Error('No account selected in the wallet.')
      await switchChain(p, chain)
      setProvider(p)
      setSigner({ kind: 'injected', label: option.name, address: getAddress(address), walletId: option.id })
      rememberWallet(option.id)
    } catch (e) {
      throw new Error(walletError(e, option.name, chain.name))
    }
  }

  const disconnect = () => {
    setSigner(null)
    setProvider(null)
    rememberWallet(null)
  }

  const value = { deployment, rpcUrl, chain, publicClient, client, signer, wallet, setSigner, wallets, connectInjected, disconnect }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function useDeploymentQuery() {
  const { network } = useNetwork()
  return useQuery({
    queryKey: ['deployment', network],
    queryFn: () => fetchDeployment(network ?? ''),
    enabled: network !== null,
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

function Loader({ children, onLoad }: { children: ReactNode; onLoad: (current: string, available: string[]) => void }) {
  const { data } = useDeploymentQuery()
  useEffect(() => {
    if (data) onLoad(data.network, data.available)
  }, [data, onLoad])
  if (!data) return <>{children}</>
  const rpcUrl = data.available.length > 1 ? (PUBLIC_RPCS[data.deployment.chainId] ?? RPC_URL) : RPC_URL
  return (
    <Inner deployment={data.deployment} rpcUrl={rpcUrl}>
      {children}
    </Inner>
  )
}

export function RequireDeployment({ children }: { children: ReactNode }) {
  const ctx = useContext(Ctx)
  const { error, isPending, refetch } = useDeploymentQuery()
  if (ctx) return <>{children}</>
  if (isPending) {
    return (
      <div className="py-12" aria-busy="true">
        <div className="h-7 w-48 animate-pulse rounded-lg bg-surface-hover" />
        <div className="mt-6 h-80 animate-pulse rounded-(--radius-card) bg-surface-hover" />
      </div>
    )
  }
  return (
    <div className="max-w-xl py-12">
      <p className="label">Not connected</p>
      <h1 className="title mt-2 text-[24px] leading-tight">No deployment found</h1>
      <p className="mt-2 text-[14px] text-muted">{(error as Error)?.message ?? 'Start the devnet with ops/devnet.sh, then retry.'}</p>
      <Button className="mt-5" onClick={() => refetch()}>
        Retry
      </Button>
    </div>
  )
}

export function StabrixProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<{ current: string | null; available: string[] }>({ current: null, available: [] })
  const [qc, setQc] = useState(newQueryClient)
  useEffect(() => setNetwork(initialNetwork()), [])
  const onLoad = useCallback((current: string, available: string[]) => setLoaded({ current, available }), [])
  const select = useCallback((next: string) => {
    try {
      localStorage.setItem(NETWORK_KEY, next)
      const url = new URL(window.location.href)
      url.searchParams.set('network', next)
      window.history.replaceState(null, '', url)
    } catch {}
    setQc(newQueryClient())
    setNetwork(next)
  }, [])
  const net = useMemo(() => ({ network, ...loaded, select }), [network, loaded, select])
  return (
    <NetCtx.Provider value={net}>
      <QueryClientProvider client={qc}>
        <Loader onLoad={onLoad}>{children}</Loader>
      </QueryClientProvider>
    </NetCtx.Provider>
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

export function useActivity() {
  const { deployment, publicClient } = useStabrix()
  return useQuery({ queryKey: ['activity', deployment.batchTaker], queryFn: () => fetchActivity(publicClient, deployment), refetchInterval: POLL_MS * 2 })
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
