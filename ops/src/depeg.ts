import { type LiveRange, StabrixClient } from '@stabrix/sdk'
import { formatUnits, parseEther } from 'viem'
import { dealERC20 } from './deal.js'
import { connect, loadDeployment } from './env.js'

const SYMBOL = process.argv[2] ?? 'USDe'
const PRICE = Number(process.argv[3] ?? '0.93')
const DUMPER = 5
const CHUNK = 2_000n
const priceApi = process.env.PRICE_API_URL ?? 'http://127.0.0.1:8790'

function valueOf(r: LiveRange, badIndex: number, badPrice: number) {
  return r.balances.reduce((sum, b, k) => {
    const usd = Number(formatUnits(b, r.config.decimals[k]!))
    return sum + (k === badIndex ? usd * badPrice : usd)
  }, 0)
}

async function main() {
  const c = await connect()
  const d = loadDeployment(c.chainId)
  const client = new StabrixClient(c.publicClient, d)
  const bad = d.tokens.find((t) => t.symbol === SYMBOL)
  if (!bad) throw new Error(`unknown symbol ${SYMBOL}`)

  await fetch(`${priceApi}/price`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ symbol: SYMBOL, price: PRICE }),
  }).catch(() => console.warn(`price api not reachable at ${priceApi}`))

  const dumper = c.wallet(DUMPER)
  await c.testClient.setBalance({ address: dumper.account.address, value: parseEther('100') })
  await dealERC20(c, bad.address, dumper.account.address, 2_000_000n * 10n ** BigInt(bad.decimals))

  const before = await client.listRanges()
  const badIndex = (r: LiveRange) => r.config.tokens.findIndex((t) => t.toLowerCase() === bad.address.toLowerCase())
  const startValue = new Map(before.map((r) => [r.hash, valueOf(r, badIndex(r), 1)]))

  const targets = d.tokens.filter((t) => t.address !== bad.address)
  let dumped = 0n
  let stalled = 0
  for (let k = 0; stalled < targets.length; k++) {
    const out = targets[k % targets.length]!
    const ranges = await client.listRanges()
    const halted = new Set((await client.sentinelStatus()).filter((s) => s.halted).map((s) => s.token.toLowerCase()))
    const quote = client.quoteExactIn(ranges, bad.address, out.address, CHUNK * 10n ** BigInt(bad.decimals), halted)
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

  const after = await client.listRanges()
  console.log(`${SYMBOL} marked at $${PRICE}; dumped ${formatUnits(dumped, bad.decimals)} ${SYMBOL} into Stabrix before every range refused it`)
  for (const r of after) {
    const start = startValue.get(r.hash) ?? 0
    const now = valueOf(r, badIndex(r), PRICE)
    const absorbed = Number(formatUnits(r.balances[badIndex(r)]!, bad.decimals))
    console.log(
      `${r.maker.slice(0, 8)} ${r.venue.kind.padEnd(8)} absorbed ${absorbed.toFixed(0).padStart(7)} ${SYMBOL}  value ${start.toFixed(0)} -> ${now.toFixed(0)} (${(((now - start) / start) * 100).toFixed(2)}%)`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
