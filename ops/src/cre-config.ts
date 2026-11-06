import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zeroAddress } from 'viem'
import { ROOT, loadDeployment } from './env.js'

type Target = 'fork' | 'testnet' | 'production'

const COINGECKO: Record<string, string> = {
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  USDS: 'usds',
  USDe: 'ethena-usde',
  EURC: 'euro-coin',
  BRZ: 'brz',
  IDRX: 'idrx',
}

const BASE_MAINNET: Record<string, string> = {
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  USDS: '0x820C137fa70C8691f0e44Dc420a5e53c168921Dc',
  USDe: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34',
  EURC: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
  BRZ: '0xE9185Ee218cae427aF7B9764A011bb89FeA761B4',
  IDRX: '0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22',
}

const CHAIN: Record<Target, { id: number; name: string }> = {
  fork: { id: 8453, name: 'ethereum-mainnet-base-1' },
  testnet: { id: 84532, name: 'ethereum-testnet-sepolia-base-1' },
  production: { id: 8453, name: 'ethereum-mainnet-base-1' },
}

const target = (process.argv[2] ?? 'fork') as Target
if (!CHAIN[target]) throw new Error(`target must be fork, testnet or production, got ${target}`)

const d = loadDeployment(CHAIN[target].id)
if (d.chainId !== CHAIN[target].id) throw new Error(`${target} needs a chain ${CHAIN[target].id} deployment, got ${d.chainId}`)
const feed = (a: string) => (a === zeroAddress ? '' : a)

const symbols = d.tokens.map((t) => t.symbol)
const missing = symbols.filter((s) => !COINGECKO[s] || !BASE_MAINNET[s])
if (target !== 'fork' && missing.length > 0) throw new Error(`no public price source for ${missing.join(', ')}`)

const live = {
  apiUrls: [
    `https://api.coingecko.com/api/v3/simple/price?ids=${symbols.map((s) => COINGECKO[s]).join(',')}&vs_currencies=usd&precision=full`,
    `https://coins.llama.fi/prices/current/${symbols.map((s) => `base:${BASE_MAINNET[s]}`).join(',')}`,
  ],
  paths: (s: string) => [`${COINGECKO[s]}.usd`, `coins.base:${BASE_MAINNET[s]}.price`],
}
const local = {
  apiUrls: [`${process.env.PRICE_API_URL ?? 'http://127.0.0.1:8790'}/prices`],
  paths: (s: string) => [s],
}
const source = target === 'fork' ? local : live

const config = {
  schedule: '*/30 * * * * *',
  chainName: CHAIN[target].name,
  oracle: d.oracle,
  multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
  hardBps: 300,
  softBps: 75,
  resumeBps: 25,
  pushBps: 2,
  heartbeatSec: 600,
  refMaxAgeSec: Number(process.env.FEED_MAX_AGE ?? 4500),
  marketMaxAgeSec: Number(process.env.MARKET_FEED_MAX_AGE ?? 90_000),
  feedDecimals: 8,
  gasLimit: 600_000,
  apiUrls: source.apiUrls,
  tokens: d.tokens.map((t) => ({
    symbol: t.symbol,
    address: t.address,
    refFeed: feed(t.feed),
    marketFeed: feed(t.marketFeed),
    apiPaths: source.paths(t.symbol),
  })),
}

const file = join(ROOT, 'cre', 'depeg-sentinel', `config.${target}.json`)
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
console.log(`wrote ${file} for oracle ${d.oracle}`)
