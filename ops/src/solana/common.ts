import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { type SolanaDeployment, type SolanaSigner, SolanaStabrixClient } from '@stabrix/sdk/solana'
import { Connection, Keypair, type VersionedTransaction } from '@solana/web3.js'
import { ROOT } from '../env.js'

export type Cluster = 'localnet' | 'devnet' | 'mainnet'

export const CLUSTERS: Record<Cluster, { name: SolanaDeployment['cluster']; chainId: number; rpc: string; file: string }> = {
  localnet: { name: 'localnet', chainId: 104, rpc: 'http://127.0.0.1:8899', file: 'solana-localnet' },
  devnet: { name: 'devnet', chainId: 103, rpc: 'https://api.devnet.solana.com', file: 'solana-devnet' },
  mainnet: { name: 'mainnet-beta', chainId: 101, rpc: 'https://api.mainnet-beta.solana.com', file: 'solana-mainnet' },
}

export function cluster(): Cluster {
  const arg = process.argv.find((a) => a.startsWith('--cluster='))?.split('=')[1] ?? process.env.SOLANA_CLUSTER ?? 'localnet'
  if (!(arg in CLUSTERS)) throw new Error(`unknown cluster ${arg}`)
  return arg as Cluster
}

export function rpcFor(c: Cluster) {
  return process.env.SOLANA_RPC_URL ?? CLUSTERS[c].rpc
}

export function connect(c: Cluster) {
  return new Connection(rpcFor(c), 'confirmed')
}

export function loadKeypair(path = process.env.SOLANA_KEYPAIR ?? join(homedir(), '.config', 'solana', 'id.json')) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
}

export function programKeypair() {
  return loadKeypair(join(ROOT, 'solana', 'program-keypair.json'))
}

export function signerOf(kp: Keypair): SolanaSigner {
  return {
    publicKey: kp.publicKey,
    signTransactions: async (txs: VersionedTransaction[]) => {
      for (const tx of txs) tx.sign([kp])
      return txs
    },
  }
}

export const deploymentPath = (c: Cluster) => join(ROOT, 'deployments', `${CLUSTERS[c].file}.json`)

export function readDeployment(c: Cluster): SolanaDeployment | null {
  const path = deploymentPath(c)
  if (!existsSync(path)) return null
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  return { ...raw, fromBlock: BigInt(raw.fromBlock) }
}

export function writeDeployment(c: Cluster, d: SolanaDeployment) {
  writeFileSync(deploymentPath(c), `${JSON.stringify({ ...d, fromBlock: Number(d.fromBlock) }, null, 2)}\n`)
}

export function clientFor(c: Cluster) {
  const d = readDeployment(c)
  if (!d) throw new Error(`no deployment for ${c}, run solana:setup first`)
  return new SolanaStabrixClient(connect(c), d)
}

export interface CoinSpec {
  symbol: string
  name: string
  decimals: number
  token2022: boolean
  mainnetMint: string
  fx: boolean
  refFeed?: string
  marketFeed?: string
  coingecko: string
  currency?: 'EUR' | 'BRL'
}

export const COINS: CoinSpec[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    token2022: false,
    mainnetMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    fx: false,
    marketFeed: 'Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX',
    coingecko: 'usd-coin',
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    token2022: false,
    mainnetMint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    fx: false,
    marketFeed: 'HT2PLQBcG5EiCcNSaMHAjSgd9F98ecpATbk4Sk5oYuM',
    coingecko: 'tether',
  },
  {
    symbol: 'PYUSD',
    name: 'PayPal USD',
    decimals: 6,
    token2022: true,
    mainnetMint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
    fx: false,
    coingecko: 'paypal-usd',
  },
  {
    symbol: 'USDG',
    name: 'Global Dollar',
    decimals: 6,
    token2022: true,
    mainnetMint: '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH',
    fx: false,
    marketFeed: '6JkZmXGgWnzsyTQaqRARzP64iFYnpMNT4siiuUDUaB8s',
    coingecko: 'global-dollar',
  },
  {
    symbol: 'USDS',
    name: 'USDS Stablecoin',
    decimals: 6,
    token2022: false,
    mainnetMint: 'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA',
    fx: false,
    coingecko: 'usds',
  },
  {
    symbol: 'USDe',
    name: 'USDe',
    decimals: 9,
    token2022: false,
    mainnetMint: 'DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT',
    fx: false,
    marketFeed: 'Cr8vurLth4b7CFNdvoXDpxuRi21CWvbQFLKy8BTwN4Wf',
    coingecko: 'ethena-usde',
  },
  {
    symbol: 'EURC',
    name: 'EURC',
    decimals: 6,
    token2022: false,
    mainnetMint: 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr',
    fx: true,
    refFeed: 'HyBsZY1UiGttbQ3ppBmnFVss9rmDAEvEbtYxdfjNAqBZ',
    coingecko: 'euro-coin',
    currency: 'EUR',
  },
  {
    symbol: 'BRZ',
    name: 'BRZ Token',
    decimals: 4,
    token2022: false,
    mainnetMint: 'FtgGSFADXBtroxq8VCausXRr2of47QBf5AS1NtZCu4GD',
    fx: true,
    coingecko: 'brz',
    currency: 'BRL',
  },
]

export const reportMaxAge = (c: Cluster) => (c === 'mainnet' ? 900 : 30 * 86_400)
export const MAX_DEVIATION_BPS = 50
export const REF_MAX_AGE = 4500
export const MARKET_MAX_AGE = 3600

export async function lamportsLeft(conn: Connection, kp: Keypair) {
  return (await conn.getBalance(kp.publicKey)) / 1e9
}
