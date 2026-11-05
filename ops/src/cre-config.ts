import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, loadDeployment } from './env.js'

const FEEDS: Record<string, { feed: string; coingecko: string }> = {
  USDC: { feed: '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B', coingecko: 'usd-coin' },
  USDT: { feed: '0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9', coingecko: 'tether' },
  DAI: { feed: '0x591e79239a7d679378eC8c847e5038150364C78F', coingecko: 'dai' },
  USDS: { feed: '0x2330aaE3bca5F05169d5f4597964D44522F62930', coingecko: 'usds' },
  USDe: { feed: '0x790181e93e9F4Eedb5b864860C12e4d2CffFe73B', coingecko: 'ethena-usde' },
}

const policy = { hardBps: 300, softBps: 75, resumeBps: 25, maxFeedAgeSec: 90_000, gasLimit: 400_000 }
const priceApi = process.env.PRICE_API_URL ?? 'http://127.0.0.1:8790'

const d = loadDeployment(8453)
const base = {
  schedule: '*/30 * * * * *',
  chainName: 'ethereum-mainnet-base-1',
  sentinel: d.sentinel,
  ...policy,
}

const fork = {
  ...base,
  tokens: d.tokens.map((t) => ({
    symbol: t.symbol,
    address: t.address,
    feed: FEEDS[t.symbol]!.feed,
    apiUrl: `${priceApi}/price/${t.symbol}`,
    jsonPath: 'price',
  })),
}

const production = {
  ...base,
  tokens: d.tokens.map((t) => ({
    symbol: t.symbol,
    address: t.address,
    feed: FEEDS[t.symbol]!.feed,
    apiUrl: `https://api.coingecko.com/api/v3/simple/price?ids=${FEEDS[t.symbol]!.coingecko}&vs_currencies=usd`,
    jsonPath: `${FEEDS[t.symbol]!.coingecko}.usd`,
  })),
}

const dir = join(ROOT, 'cre', 'depeg-sentinel')
writeFileSync(join(dir, 'config.fork.json'), `${JSON.stringify(fork, null, 2)}\n`)
writeFileSync(join(dir, 'config.production.json'), `${JSON.stringify(production, null, 2)}\n`)
console.log(`wrote cre configs for sentinel ${d.sentinel}`)
