import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zeroAddress } from 'viem'
import { ROOT, loadDeployment } from './env.js'

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

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const priceApi = process.env.PRICE_API_URL ?? 'http://127.0.0.1:8790'

const policy = {
  hardBps: 300,
  softBps: 75,
  resumeBps: 25,
  pushBps: 2,
  heartbeatSec: 600,
  refMaxAgeSec: 4500,
  marketMaxAgeSec: 90_000,
  feedDecimals: 8,
  gasLimit: 600_000,
}

const d = loadDeployment(8453)
const feed = (a: string) => (a === zeroAddress ? '' : a)
const base = {
  schedule: '*/30 * * * * *',
  chainName: 'ethereum-mainnet-base-1',
  oracle: d.oracle,
  multicall: MULTICALL3,
  ...policy,
}

const fork = {
  ...base,
  apiUrls: [`${priceApi}/prices`],
  tokens: d.tokens.map((t) => ({
    symbol: t.symbol,
    address: t.address,
    refFeed: feed(t.feed),
    marketFeed: feed(t.marketFeed),
    apiPaths: [t.symbol],
  })),
}

const missing = d.tokens.filter((t) => !COINGECKO[t.symbol]).map((t) => t.symbol)
if (missing.length > 0) throw new Error(`no CoinGecko id for ${missing.join(', ')}`)

const production = {
  ...base,
  apiUrls: [
    `https://api.coingecko.com/api/v3/simple/price?ids=${d.tokens.map((t) => COINGECKO[t.symbol]).join(',')}&vs_currencies=usd`,
    `https://coins.llama.fi/prices/current/${d.tokens.map((t) => `base:${t.address}`).join(',')}`,
  ],
  tokens: d.tokens.map((t) => ({
    symbol: t.symbol,
    address: t.address,
    refFeed: feed(t.feed),
    marketFeed: feed(t.marketFeed),
    apiPaths: [`${COINGECKO[t.symbol]}.usd`, `coins.base:${t.address}.price`],
  })),
}

const dir = join(ROOT, 'cre', 'depeg-sentinel')
writeFileSync(join(dir, 'config.fork.json'), `${JSON.stringify(fork, null, 2)}\n`)
writeFileSync(join(dir, 'config.production.json'), `${JSON.stringify(production, null, 2)}\n`)
console.log(`wrote cre configs for oracle ${d.oracle}`)
