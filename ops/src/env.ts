import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Deployment } from '@stabrix/sdk'
import {
  type Chain,
  type Hex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  publicActions,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'

export const ANVIL_KEYS: readonly Hex[] = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
]

export function loadDeployment(chainId: number): Deployment {
  const name = process.env.DEPLOYMENT_NAME ?? String(chainId)
  const raw = JSON.parse(readFileSync(join(ROOT, 'deployments', `${name}.json`), 'utf8'))
  return {
    chainId: raw.chainId,
    fromBlock: BigInt(raw.fromBlock),
    aqua: getAddress(raw.aqua),
    router: getAddress(raw.router),
    officialRouter: getAddress(raw.officialRouter),
    extruction: getAddress(raw.extruction),
    batchTaker: getAddress(raw.batchTaker),
    oracle: getAddress(raw.oracle),
    lens: getAddress(raw.lens),
    tokens: raw.tokens.map((t: { address: string; symbol: string; name: string; decimals: number; feed: string }) => ({
      ...t,
      address: getAddress(t.address),
      feed: getAddress(t.feed),
    })),
  }
}

export async function connect() {
  const probe = createPublicClient({ transport: http(RPC_URL) })
  const chainId = await probe.getChainId()
  const chain: Chain =
    chainId === base.id
      ? { ...base, rpcUrls: { default: { http: [RPC_URL] } } }
      : defineChain({
          id: chainId,
          name: `chain-${chainId}`,
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: [RPC_URL] } },
          contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
        })
  const transport = http(RPC_URL, { retryCount: 6, retryDelay: 400 })
  const publicClient = createPublicClient({ chain, transport })
  const testClient = createTestClient({ chain, mode: 'anvil', transport }).extend(publicActions)
  const wallet = (k: number) =>
    createWalletClient({ chain, account: privateKeyToAccount(ANVIL_KEYS[k]!), transport })
  return { chain, chainId, publicClient, testClient, wallet }
}
