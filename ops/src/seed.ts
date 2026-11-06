import { type PresetId, StabrixClient, type Venue, WAD } from '@stabrix/sdk'
import { formatUnits, parseEther } from 'viem'
import { dealERC20 } from './deal.js'
import { connect, loadDeployment } from './env.js'

const LPS: { key: number; preset: PresetId; usdPerCoin: bigint; venue: 'native' | 'official'; backstopUsd: bigint }[] = [
  { key: 1, preset: 'tight', usdPerCoin: 40_000n, venue: 'native', backstopUsd: 30_000n },
  { key: 2, preset: 'balanced', usdPerCoin: 60_000n, venue: 'native', backstopUsd: 0n },
  { key: 3, preset: 'wide', usdPerCoin: 80_000n, venue: 'official', backstopUsd: 50_000n },
]
const BACKSTOP = { startBps: 200, endBps: 1000, capUsd: 20_000n }
const TRADER = 4
const TRADER_USD = 250_000n

async function main() {
  const c = await connect()
  const d = loadDeployment(c.chainId)
  const client = new StabrixClient(c.publicClient, d)
  const prices = await client.prices()
  const units = (address: string, decimals: number, usd: bigint) => {
    const p = prices.get(address.toLowerCase())?.priceE18
    if (p == null) throw new Error(`no fresh price for ${address}`)
    return (usd * 10n ** BigInt(decimals) * WAD) / p
  }

  for (const k of [...LPS.map((l) => l.key), TRADER]) {
    await c.testClient.setBalance({ address: c.wallet(k).account.address, value: parseEther('100') })
  }

  for (const lp of LPS) {
    const wallet = c.wallet(lp.key)
    for (const t of d.tokens) {
      await dealERC20(c, t.address, wallet.account.address, units(t.address, t.decimals, lp.usdPerCoin))
    }
    const native = lp.venue === 'native'
    const venue: Venue = native ? { kind: 'native' } : { kind: 'official', extruction: d.extruction }
    const config = client.buildRange(lp.preset, lp.usdPerCoin * WAD)
    const shipped = await client.ship(wallet, config, lp.usdPerCoin * WAD, venue, BigInt(lp.key))
    console.log(`lp${lp.key} ${lp.preset.padEnd(8)} ${lp.venue.padEnd(8)} range    ${shipped.strategyHash}`)

    if (lp.backstopUsd > 0n) {
      const bs = client.buildBackstop(BACKSTOP.startBps, BACKSTOP.endBps, BACKSTOP.capUsd * WAD)
      const pledges = bs.tokens.map((t, k) => {
        const sym = client.token(t).symbol
        return sym === 'USDC' || sym === 'USDT' ? units(t, bs.decimals[k]!, lp.backstopUsd) : 0n
      })
      const bsVenue: Venue = native ? { kind: 'native' } : { kind: 'official', extruction: d.backstop }
      const done = await client.shipBackstop(wallet, bs, pledges, bsVenue, BigInt(100 + lp.key))
      console.log(`lp${lp.key} backstop ${lp.venue.padEnd(8)} same wallet ${done.strategyHash}`)
    }
  }

  const trader = c.wallet(TRADER)
  for (const t of d.tokens) {
    await dealERC20(c, t.address, trader.account.address, units(t.address, t.decimals, TRADER_USD))
  }

  const sym = (s: string) => d.tokens.find((t) => t.symbol === s)!
  for (const [from, to, usd] of [
    ['USDC', 'DAI', 10_000n],
    ['USDC', 'EURC', 5_000n],
  ] as const) {
    const a = sym(from)
    const b = sym(to)
    const market = await client.market()
    const amount = units(a.address, a.decimals, usd)
    const quote = client.quoteExactIn(market, a.address, b.address, amount)
    await client.ensureAllowance(trader, a.address, d.batchTaker, amount)
    const simulated = await client.simulateQuote(quote, trader.account.address)
    if (simulated !== quote.amountOut) throw new Error(`sdk quote ${quote.amountOut} and on-chain simulation ${simulated} disagree`)
    const done = await client.swap(trader, quote, 10)
    console.log(
      `${formatUnits(amount, a.decimals)} ${from} -> ${formatUnits(done.amountOut, b.decimals)} ${to} over ${quote.legs.length} legs, quote equals chain`,
    )
  }
  const market = await client.market()
  console.log(`live: ${market.ranges.length} ranges, ${market.backstops.length} backstops`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
