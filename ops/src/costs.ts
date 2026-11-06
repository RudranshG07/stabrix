import { StabrixClient, WAD } from '@stabrix/sdk'
import { connect, loadDeployment } from './env.js'

const SIZES = [1_000n, 10_000n, 100_000n]
const PAIRS: [string, string][] = [
  ['USDC', 'DAI'],
  ['USDC', 'EURC'],
]

async function main() {
  const c = await connect()
  const d = loadDeployment(c.chainId)
  const client = new StabrixClient(c.publicClient, d)
  const market = await client.market()
  const bySymbol = (s: string) => d.tokens.find((t) => t.symbol === s)!
  const price = (a: string) => market.prices.get(a.toLowerCase())?.priceE18 ?? WAD

  console.log(`chain ${c.chainId}, ${market.ranges.length} ranges, block ${market.block}`)
  console.log('pair        size       out                  cost (bps)  legs')
  for (const [a, b] of PAIRS) {
    const tIn = bySymbol(a)
    const tOut = bySymbol(b)
    for (const usd of SIZES) {
      const amountIn = (usd * WAD * 10n ** BigInt(tIn.decimals)) / price(tIn.address)
      const q = client.quoteExactIn(market, tIn.address, tOut.address, amountIn)
      const valueIn = (q.filled * price(tIn.address)) / 10n ** BigInt(tIn.decimals)
      const valueOut = (q.amountOut * price(tOut.address)) / 10n ** BigInt(tOut.decimals)
      const bps = valueIn === 0n ? '-' : (Number(((valueIn - valueOut) * 1_000_000n) / valueIn) / 100).toFixed(2)
      const out = (Number(q.amountOut) / 10 ** tOut.decimals).toLocaleString('en-US', { maximumFractionDigits: 2 })
      const partial = q.filled < amountIn ? ' (partial fill)' : ''
      console.log(`${`${a}>${b}`.padEnd(12)}$${usd.toLocaleString('en-US').padEnd(10)}${`${out} ${b}`.padEnd(21)}${bps.padEnd(12)}${q.legs.length}${partial}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
