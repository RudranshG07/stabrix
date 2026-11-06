import { StabrixClient, type Venue, WAD, buildBackstopOrder, buildOrder } from '@stabrix/sdk'
import { type Address, createWalletClient, formatUnits, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { RPC_URL, connect, deployerKey, loadDeployment } from './env.js'

const MIN_COIN_USD = Number(process.env.MIN_COIN_USD ?? '1')
const RANGE_SHARE = 0.9
const BACKSTOP = { startBps: 200, endBps: 1000 }
const SALTS = { balanced: 1n, wide: 2n, backstop: 3n }

async function main() {
  const key = deployerKey()
  const c = await connect()
  if (c.chainId !== 8453) throw new Error(`expected Base mainnet (8453), got ${c.chainId}`)
  const d = loadDeployment(c.chainId)
  const client = new StabrixClient(c.publicClient, d)
  const wallet = createWalletClient({ chain: c.chain, account: privateKeyToAccount(key), transport: http(RPC_URL) })
  const me = wallet.account.address

  const [balances, prices] = await Promise.all([client.balancesOf(me), client.prices()])
  const held: { address: Address; symbol: string; usd: number }[] = []
  d.tokens.forEach((t, k) => {
    const p = prices.get(t.address.toLowerCase())?.priceE18
    if (p == null) return
    const usd = Number(formatUnits((balances[k]! * p) / 10n ** BigInt(t.decimals), 18))
    console.log(`${t.symbol.padEnd(5)} ${formatUnits(balances[k]!, t.decimals).padStart(18)}  ~$${usd.toFixed(2)}`)
    if (usd >= MIN_COIN_USD) held.push({ address: t.address, symbol: t.symbol, usd })
  })
  if (held.length < 2) throw new Error(`hold at least two of ${d.tokens.map((t) => t.symbol).join(', ')} worth $${MIN_COIN_USD}+ each`)

  const perCoinUsd = Math.floor(Math.min(...held.map((h) => h.usd)) * RANGE_SHARE * 100) / 100
  const perCoin = BigInt(Math.round(perCoinUsd * 100)) * (WAD / 100n)
  const tokens = held.map((h) => h.address)
  console.log(`shipping ranges over ${held.map((h) => h.symbol).join(', ')} at $${perCoinUsd} per coin`)

  const ranges: { name: 'balanced' | 'wide'; venue: Venue }[] = [
    { name: 'balanced', venue: { kind: 'native' } },
    { name: 'wide', venue: { kind: 'official', extruction: d.extruction } },
  ]
  let backedUsd = 0
  for (const r of ranges) {
    const config = client.buildRange(r.name, perCoin, { tokens })
    const order = buildOrder(me, config, r.venue, SALTS[r.name])
    backedUsd += perCoinUsd * tokens.length
    if (await client.isShipped(me, order, client.appFor(r.venue), config.tokens[0]!)) {
      console.log(`${r.name.padEnd(8)} already live`)
      continue
    }
    const done = await client.ship(wallet, config, perCoin, r.venue, SALTS[r.name])
    console.log(`${r.name.padEnd(8)} ${r.venue.kind.padEnd(8)} ${done.strategyHash} tx ${done.hash}`)
  }

  const usdc = held.find((h) => h.symbol === 'USDC')
  if (usdc) {
    const pledgeUsd = Math.floor(usdc.usd * RANGE_SHARE * 100) / 100
    const bsTokens = d.tokens.map((t) => t.address)
    const bs = client.buildBackstop(BACKSTOP.startBps, BACKSTOP.endBps, (BigInt(Math.round(pledgeUsd * 100)) * WAD) / 100n, bsTokens)
    const pledges = bs.tokens.map((t, k) =>
      t.toLowerCase() === usdc.address.toLowerCase() ? (BigInt(Math.round(pledgeUsd * 100)) * 10n ** BigInt(bs.decimals[k]!)) / 100n : 0n,
    )
    const venue: Venue = { kind: 'native' }
    const order = buildBackstopOrder(me, bs, venue, SALTS.backstop)
    backedUsd += pledgeUsd
    if (await client.isShipped(me, order, client.appFor(venue), bs.tokens[0]!)) {
      console.log('backstop already live')
    } else {
      const done = await client.shipBackstop(wallet, bs, pledges, venue, SALTS.backstop)
      console.log(`backstop native   pledging $${pledgeUsd} USDC for ${d.tokens.length - 1} coins ${done.strategyHash} tx ${done.hash}`)
    }
  }

  const walletUsd = held.reduce((a, h) => a + h.usd, 0)
  console.log(
    `one wallet worth $${walletUsd.toFixed(2)} backs $${backedUsd.toFixed(2)} of virtual balances across strategies (shared liquidity ratio ${(backedUsd / walletUsd).toFixed(2)}x)${usdc ? `, and its backstop covers ${d.tokens.length - 1} coins` : ''}`,
  )
  const market = await client.market()
  console.log(`live on Base: ${market.ranges.length} ranges, ${market.backstops.length} backstops`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
