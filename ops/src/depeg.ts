import { type LiveBackstop, type LiveRange, type PriceInfo, StabrixClient, WAD } from '@stabrix/sdk'
import { type Address, formatUnits, parseEther, parseUnits } from 'viem'
import { dealERC20 } from './deal.js'
import { connect, loadDeployment } from './env.js'

const SYMBOL = process.argv[2] ?? 'USDe'
const PRICE = process.argv[3] ?? '0.93'
const DUMPER = 5
const CHUNK_USD = 2_000n
const priceApi = process.env.PRICE_API_URL ?? 'http://127.0.0.1:8790'

type Held = LiveRange | LiveBackstop

function usdValue(s: Held, prices: Map<string, PriceInfo>, bad: Address, badPrice: bigint) {
  return s.balances.reduce((sum, b, k) => {
    const t = s.config.tokens[k]!
    const p = t.toLowerCase() === bad.toLowerCase() ? badPrice : (prices.get(t.toLowerCase())?.priceE18 ?? WAD)
    return sum + (b * p) / 10n ** BigInt(s.config.decimals[k]!)
  }, 0n)
}

async function main() {
  const c = await connect()
  const d = loadDeployment(c.chainId)
  const client = new StabrixClient(c.publicClient, d)
  const bad = d.tokens.find((t) => t.symbol === SYMBOL)
  if (!bad) throw new Error(`unknown symbol ${SYMBOL}`)
  const priceE18 = parseUnits(PRICE, 18)

  await fetch(`${priceApi}/price`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ symbol: SYMBOL, price: Number(PRICE) }),
  }).catch(() => console.warn(`price api not reachable at ${priceApi}`))

  const dumper = c.wallet(DUMPER)
  await c.testClient.setBalance({ address: dumper.account.address, value: parseEther('100') })
  await dealERC20(c, bad.address, dumper.account.address, 2_000_000n * 10n ** BigInt(bad.decimals))

  const before = await client.market()
  const start = new Map<string, bigint>()
  for (const s of [...before.ranges, ...before.backstops]) start.set(s.id, usdValue(s, before.prices, bad.address, WAD))

  const targets = d.tokens.filter((t) => t.address !== bad.address)
  const chunk = CHUNK_USD * 10n ** BigInt(bad.decimals)
  let dumped = 0n
  let stalled = 0
  for (let k = 0; stalled < targets.length; k++) {
    const out = targets[k % targets.length]!
    const market = await client.market()
    const quote = client.quoteExactIn(market, bad.address, out.address, chunk)
    if (quote.legs.length === 0 || quote.filled === 0n) {
      stalled++
      continue
    }
    stalled = 0
    try {
      await client.swap(dumper, { ...quote, amountIn: quote.filled }, 50)
      dumped += quote.filled
    } catch (e) {
      stalled++
      console.log(`swap rejected: ${(e as Error).message.split('\n')[0]}`)
    }
  }

  const after = await client.market()
  const halted = after.prices.get(bad.address.toLowerCase())?.halted
  console.log(`${SYMBOL} at $${PRICE}, ${halted ? 'halted by the oracle' : 'not halted'}; dumped ${formatUnits(dumped, bad.decimals)} ${SYMBOL}`)
  for (const s of [...after.ranges, ...after.backstops]) {
    const k = s.config.tokens.findIndex((t) => t.toLowerCase() === bad.address.toLowerCase())
    const was = start.get(s.id) ?? 0n
    const now = usdValue(s, after.prices, bad.address, priceE18)
    const pct = was === 0n ? 0 : (Number(now - was) / Number(was)) * 100
    console.log(
      `${s.maker.slice(0, 8)} ${s.kind.padEnd(8)} ${s.venue.kind.padEnd(8)} absorbed ${formatUnits(s.balances[k]!, bad.decimals).split('.')[0]!.padStart(7)} ${SYMBOL}  value $${formatUnits(was, 18).split('.')[0]} -> $${formatUnits(now, 18).split('.')[0]} (${pct.toFixed(2)}%)`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
