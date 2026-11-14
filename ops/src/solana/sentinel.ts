import { ix, readPyth } from '@stabrix/sdk/solana'
import { PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { COINS, type CoinSpec, MARKET_MAX_AGE, clientFor, cluster, connect, loadKeypair } from './common.js'

const E9 = 1_000_000_000n
const POLICY = { hardBps: 300n, softBps: 75n, resumeBps: 25n, pushBps: 2n, heartbeatSec: 600 }

export interface Observation {
  pegged: boolean
  ref: bigint | null
  feed: bigint | null
  api: (bigint | null)[]
  halted: boolean
  onchainPrice: bigint
  onchainAt: number
}

export interface Decision {
  known: boolean
  halt: boolean
  price: bigint | null
  push: boolean
  reason: string
}

const dev = (p: bigint, ref: bigint) => ((p > ref ? p - ref : ref - p) * 10_000n) / ref
const min = (xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a))

export function decide(o: Observation, now: number): Decision {
  const ref = o.pegged ? E9 : o.ref
  if (!ref || ref <= 0n) return { known: false, halt: o.halted, price: null, push: false, reason: 'no reference rate' }
  const quotes = o.api.filter((q): q is bigint => q != null && q > 0n)
  const feedOk = o.feed != null && o.feed > 0n
  const apiOk = quotes.length > 0
  const apiAll = apiOk && quotes.length >= o.api.length
  if (!feedOk && !apiOk && o.halted) return { known: false, halt: true, price: null, push: false, reason: 'no market data while halted' }

  const feedDev = feedOk ? dev(o.feed!, ref) : 0n
  const apiDev = apiOk ? min(quotes.map((q) => dev(q, ref))) : 0n
  const apiWorst = apiOk ? quotes.map((q) => dev(q, ref)).reduce((a, b) => (b > a ? b : a)) : 0n

  let halt = false
  let reason = 'within peg'
  if (apiAll && apiDev >= POLICY.hardBps) [halt, reason] = [true, `offchain ${apiDev}bps >= hard ${POLICY.hardBps}bps`]
  else if (feedOk && feedDev >= POLICY.hardBps) [halt, reason] = [true, `pyth ${feedDev}bps >= hard ${POLICY.hardBps}bps`]
  else if (apiAll && feedOk && apiDev >= POLICY.softBps && feedDev >= POLICY.softBps) [halt, reason] = [true, `both sources >= soft ${POLICY.softBps}bps`]
  else if (o.halted) {
    const calm = (!apiOk || apiWorst <= POLICY.resumeBps) && (!feedOk || feedDev <= POLICY.resumeBps)
    halt = !calm
    reason = calm ? 'back within resume band' : 'holding halt until sources are within resume band'
  }

  let price: bigint
  if (halt) price = min([...quotes, ...(feedOk ? [o.feed!] : [])])
  else if (apiOk) price = quotes.reduce((best, q) => (dev(q, ref) < dev(best, ref) ? q : best))
  else if (feedOk) price = o.feed!
  else price = ref

  let push = halt !== o.halted
  if (!push && (!o.pegged || halt)) {
    push = o.onchainPrice <= 0n || dev(price, o.onchainPrice) >= POLICY.pushBps || now - o.onchainAt >= POLICY.heartbeatSec
  }
  return { known: true, halt, price, push, reason }
}

const toE9 = (n: number) => BigInt(Math.round(n * 1e9))

async function json(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

async function fxRates(): Promise<Map<string, number>> {
  const sources = await Promise.allSettled([
    json('https://api.frankfurter.dev/v1/latest?from=USD&to=EUR,BRL').then((b) => (b as { rates: Record<string, number> }).rates),
    json('https://open.er-api.com/v6/latest/USD').then((b) => (b as { rates: Record<string, number> }).rates),
  ])
  const out = new Map<string, number>()
  for (const ccy of ['EUR', 'BRL']) {
    const quotes = sources.flatMap((r) => (r.status === 'fulfilled' && r.value[ccy] ? [r.value[ccy]!] : []))
    if (quotes.length) out.set(ccy, quotes.reduce((a, b) => a + b, 0) / quotes.length)
  }
  return out
}

async function coingecko(coins: CoinSpec[]): Promise<Map<string, number>> {
  const body = (await json(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coins.map((c) => c.coingecko).join(',')}&vs_currencies=usd&precision=full`,
  )) as Record<string, { usd?: number }>
  return new Map(coins.flatMap((c) => (body[c.coingecko]?.usd ? [[c.symbol, body[c.coingecko]!.usd!]] : [])))
}

async function defillama(coins: CoinSpec[]): Promise<Map<string, number>> {
  const keys = coins.map((c) => `solana:${c.mainnetMint}`)
  const body = (await json(`https://coins.llama.fi/prices/current/${keys.join(',')}`)) as { coins: Record<string, { price: number }> }
  return new Map(coins.flatMap((c) => (body.coins[`solana:${c.mainnetMint}`]?.price ? [[c.symbol, body.coins[`solana:${c.mainnetMint}`]!.price]] : [])))
}

function overrides(): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of process.argv) {
    const m = /^--override=(\w+)=([\d.]+)$/.exec(a)
    if (m) out.set(m[1]!, Number(m[2]))
  }
  return out
}

export async function runOnce(c = cluster()) {
  const client = clientFor(c)
  const conn = connect(c)
  const reporter = loadKeypair(process.env.REPORTER_KEYPAIR)
  const forced = overrides()
  if (forced.size > 0 && c === 'mainnet') throw new Error('price overrides are for devnet and localnet demos only')

  const state = await client.oracle()
  const settle = <T>(p: Promise<T>) => p.catch((e) => (console.warn(String(e).slice(0, 120)), null))
  const [fx, cg, llama] = await Promise.all([
    settle(fxRates()),
    settle(coingecko(COINS)),
    settle(defillama(COINS)),
  ])
  const marketKeys = c === 'mainnet' ? COINS.map((x) => (x.marketFeed ? new PublicKey(x.marketFeed) : null)) : COINS.map(() => null)
  const feedInfos = await conn.getMultipleAccountsInfo(marketKeys.filter((k): k is PublicKey => !!k))
  const feedData = new Map(marketKeys.filter((k): k is PublicKey => !!k).map((k, x) => [k.toBase58(), feedInfos[x]?.data ?? null]))
  const now = Math.floor(Date.now() / 1000)

  const rows: { index: number; priceE9: bigint; halted: boolean }[] = []
  for (const coin of COINS) {
    const t = client.tokens.find((x) => x.symbol === coin.symbol)
    const e = t && state.entries.find((x) => x.mint.toBase58() === t.address)
    if (!e) continue
    let ref: bigint | null = null
    if (coin.currency) {
      const perUsd = fx?.get(coin.currency)
      if (perUsd) ref = toE9(1 / perUsd)
    }
    const key = marketKeys[COINS.indexOf(coin)]
    let feed = key ? readPyth(feedData.get(key.toBase58()), MARKET_MAX_AGE, now) : null
    let api = [cg?.get(coin.symbol), llama?.get(coin.symbol)].map((v) => (v ? toE9(v) : null))
    const f = forced.get(coin.symbol)
    if (f !== undefined) {
      api = api.map(() => toE9(f))
      feed = null
    }
    const d = decide(
      { pegged: !coin.fx, ref, feed, api, halted: e.reportHalted, onchainPrice: e.priceE9, onchainAt: e.observedAt },
      now,
    )
    const shown = d.price != null ? (Number(d.price) / 1e9).toFixed(6) : '-'
    console.log(`${coin.symbol.padEnd(6)} ${d.halt ? 'HALT ' : 'ok   '} ${shown.padStart(10)} ${d.push ? 'push' : '    '} ${d.reason}`)
    if (d.known && d.push && d.price != null) rows.push({ index: e.index, priceE9: d.price, halted: d.halt })
  }
  if (rows.length === 0) {
    console.log('nothing to report')
    return null
  }
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix.report(client.program, reporter.publicKey, now, rows)), [reporter])
  console.log(`reported ${rows.length} coins: ${sig}`)
  return sig
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const loop = process.argv.find((a) => a.startsWith('--loop='))?.split('=')[1]
  if (!loop) {
    await runOnce()
  } else {
    for (;;) {
      await runOnce().catch((e) => console.error(String(e)))
      await new Promise((r) => setTimeout(r, Number(loop) * 1000))
    }
  }
}
