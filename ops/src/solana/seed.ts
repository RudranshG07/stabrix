import type { PresetId } from '@stabrix/sdk'
import { clientFor, cluster, connect, lamportsLeft, loadKeypair, signerOf } from './common.js'

const c = cluster()
const client = clientFor(c)
const conn = connect(c)
const admin = loadKeypair()
const signer = signerOf(admin)
const usd = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n
const scale = Number(process.env.SEED_USD_SCALE ?? (c === 'mainnet' ? '0' : '1'))
if (!scale) throw new Error('set SEED_USD_SCALE for mainnet, for example SEED_USD_SCALE=0.000001 seeds $1 where devnet seeds $1,000,000')

const ranges: { preset: PresetId; perCoin: number; salt: bigint }[] = [
  { preset: 'tight', perCoin: 1_000_000, salt: 11n },
  { preset: 'balanced', perCoin: 200_000, salt: 12n },
  { preset: 'wide', perCoin: 100_000, salt: 13n },
]
const backstop = { startBps: 200, endBps: 1000, pledge: 200_000, cap: 300_000, salt: 21n }

const before = await lamportsLeft(conn, admin)
const existing = await client.strategies(admin.publicKey)
const have = new Set(existing.map((s) => s.salt))
const need = ranges.reduce((a, r) => a + r.perCoin, 0) * scale + backstop.pledge * scale
if (client.deployment.faucet) {
  const balances = await client.balancesOf(admin.publicKey)
  const prices = await client.prices()
  const short = client.tokens.some((t, k) => {
    const p = prices.get(t.address.toLowerCase())?.priceE18 ?? 10n ** 18n
    return (balances[k]! * p) / 10n ** BigInt(t.decimals) < usd(need)
  })
  if (short) {
    await client.faucet(signer, Math.ceil(need * 1.05))
    console.log(`minted test coins, about $${Math.ceil(need * 1.05).toLocaleString('en-US')} of each`)
  }
}

for (const r of ranges) {
  if (have.has(r.salt)) {
    console.log(`${r.preset} range already open`)
    continue
  }
  const config = client.buildRange(r.preset, usd(r.perCoin * scale))
  const done = await client.ship(signer, config, usd(r.perCoin * scale), undefined, r.salt)
  console.log(`${r.preset} range $${(r.perCoin * scale).toLocaleString('en-US')} per coin: ${done.hash}`)
}

if (!have.has(backstop.salt)) {
  const config = client.buildBackstop(backstop.startBps, backstop.endBps, usd(backstop.cap * scale))
  const prices = await client.prices()
  const pledges = config.tokens.map((t) => {
    const token = client.token(t)
    if (token.symbol !== 'USDC' && token.symbol !== 'USDT') return 0n
    const p = prices.get(t.toLowerCase())!.priceE18!
    return (usd(backstop.pledge * scale) * 10n ** BigInt(token.decimals)) / p
  })
  const done = await client.shipBackstop(signer, config, pledges, undefined, backstop.salt)
  console.log(`backstop pledging $${(backstop.pledge * scale).toLocaleString('en-US')} each USDC and USDT: ${done.hash}`)
} else {
  console.log('backstop already open')
}

const market = await client.market()
console.log(`${market.ranges.length} ranges, ${market.backstops.length} backstops live; spent ${(before - (await lamportsLeft(conn, admin))).toFixed(6)} SOL`)
