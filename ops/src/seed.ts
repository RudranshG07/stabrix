import { type PresetId, StabrixClient, type Venue, WAD } from '@stabrix/sdk'
import { formatUnits, parseEther } from 'viem'
import { dealERC20 } from './deal.js'
import { connect, loadDeployment } from './env.js'

const LPS: { key: number; preset: PresetId; perCoin: bigint; venue: 'native' | 'official' }[] = [
  { key: 1, preset: 'tight', perCoin: 40_000n, venue: 'native' },
  { key: 2, preset: 'balanced', perCoin: 60_000n, venue: 'native' },
  { key: 3, preset: 'wide', perCoin: 80_000n, venue: 'official' },
]
const TRADER = 4
const TRADER_FUNDS = 250_000n

async function main() {
  const c = await connect()
  const deployment = loadDeployment(c.chainId)
  const client = new StabrixClient(c.publicClient, deployment)

  for (const k of [...LPS.map((l) => l.key), TRADER]) {
    await c.testClient.setBalance({ address: c.wallet(k).account.address, value: parseEther('100') })
  }

  for (const lp of LPS) {
    const wallet = c.wallet(lp.key)
    for (const t of deployment.tokens) {
      await dealERC20(c, t.address, wallet.account.address, lp.perCoin * 10n ** BigInt(t.decimals))
    }
    const venue: Venue =
      lp.venue === 'native' ? { kind: 'native' } : { kind: 'official', extruction: deployment.extruction }
    const config = client.buildRange(lp.preset, lp.perCoin * WAD)
    const shipped = await client.ship(wallet, config, lp.perCoin * WAD, venue, BigInt(lp.key))
    console.log(`lp${lp.key} ${lp.preset.padEnd(8)} ${lp.venue.padEnd(8)} ${shipped.strategyHash}`)
  }

  const trader = c.wallet(TRADER)
  for (const t of deployment.tokens) {
    await dealERC20(c, t.address, trader.account.address, TRADER_FUNDS * 10n ** BigInt(t.decimals))
  }

  const ranges = await client.listRanges()
  const [usdc, dai] = [deployment.tokens.find((t) => t.symbol === 'USDC')!, deployment.tokens.find((t) => t.symbol === 'DAI')!]
  const amount = 10_000n * 10n ** BigInt(usdc.decimals)
  const quote = client.quoteExactIn(ranges, usdc.address, dai.address, amount)
  await client.ensureAllowance(trader, usdc.address, deployment.batchTaker, amount)
  const simulated = await client.simulateQuote(quote, trader.account.address)
  console.log(`ranges live: ${ranges.length}`)
  console.log(
    `quote 10,000 USDC -> ${formatUnits(quote.amountOut, dai.decimals)} DAI over ${quote.legs.length} legs, on-chain sim ${formatUnits(simulated, dai.decimals)}`,
  )
  if (simulated !== quote.amountOut) throw new Error('sdk quote and on-chain simulation disagree')
  const done = await client.swap(trader, quote, 10)
  console.log(`swapped in tx ${done.hash}, received ${formatUnits(done.amountOut, dai.decimals)} DAI`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
