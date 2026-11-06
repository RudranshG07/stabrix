import { type PresetId, StabrixClient, type Venue, WAD, buildBackstopOrder, buildOrder, mockStablecoinAbi } from '@stabrix/sdk'
import { type Address, createWalletClient, formatUnits, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { RPC_URL, connect, deployerKey, loadDeployment } from './env.js'

type VenueId = 'native' | 'official'

const RANGES: { preset: PresetId; perCoin: bigint; venue: VenueId }[] = [
  { preset: 'tight', perCoin: 40_000n, venue: 'native' },
  { preset: 'balanced', perCoin: 60_000n, venue: 'native' },
  { preset: 'wide', perCoin: 80_000n, venue: 'official' },
  { preset: 'tight', perCoin: 5_000_000n, venue: 'official' },
]
const TRADING_FLOAT = 50_000n
const BACKSTOPS: { startBps: number; endBps: number; capUsd: bigint; pledgeUsd: bigint; salt: bigint; venue: VenueId }[] = [
  { startBps: 200, endBps: 1000, capUsd: 20_000n, pledgeUsd: 30_000n, salt: 101n, venue: 'native' },
  { startBps: 200, endBps: 1000, capUsd: 100_000n, pledgeUsd: 100_000n, salt: 102n, venue: 'official' },
]
const PAYOUT = ['USDC', 'USDT']

async function main() {
  const c = await connect()
  const deployment = loadDeployment(c.chainId)
  const client = new StabrixClient(c.publicClient, deployment)
  const wallet = createWalletClient({ chain: c.chain, account: privateKeyToAccount(deployerKey()), transport: http(RPC_URL) })
  const me = wallet.account.address
  const venueOf = (v: VenueId, target: Address): Venue => (v === 'native' ? { kind: 'native' } : { kind: 'official', extruction: target })

  const prices = await client.prices()
  const held = await client.balancesOf(me)
  for (const [k, t] of deployment.tokens.entries()) {
    const price = prices.get(t.address.toLowerCase())?.priceE18
    if (price == null) throw new Error(`no fresh price for ${t.symbol}`)
    const pledged = PAYOUT.includes(t.symbol) ? BACKSTOPS.reduce((a, b) => a + b.pledgeUsd, 0n) : 0n
    const usd = RANGES.reduce((a, r) => a + r.perCoin, TRADING_FLOAT + pledged)
    const need = (usd * 10n ** BigInt(t.decimals) * WAD) / price
    if (held[k]! >= need) continue
    const hash = await wallet.writeContract({ address: t.address, abi: mockStablecoinAbi, functionName: 'mint', args: [me, need - held[k]!] })
    await c.publicClient.waitForTransactionReceipt({ hash })
    console.log(`minted ${formatUnits(need - held[k]!, t.decimals)} ${t.symbol}, wallet now covers $${usd}`)
  }

  for (const [k, r] of RANGES.entries()) {
    const venue = venueOf(r.venue, deployment.extruction)
    const config = client.buildRange(r.preset, r.perCoin * WAD)
    const order = buildOrder(me, config, venue, BigInt(k + 1))
    if (await client.isShipped(me, order, client.appFor(venue), config.tokens[0]!)) {
      console.log(`${r.preset.padEnd(8)} $${r.perCoin} per coin already live`)
      continue
    }
    const shipped = await client.ship(wallet, config, r.perCoin * WAD, venue, BigInt(k + 1))
    console.log(`${r.preset.padEnd(8)} $${r.perCoin} per coin on ${r.venue} ${shipped.strategyHash} tx ${shipped.hash}`)
  }

  for (const b of BACKSTOPS) {
    const venue = venueOf(b.venue, deployment.backstop)
    const config = client.buildBackstop(b.startBps, b.endBps, b.capUsd * WAD)
    const order = buildBackstopOrder(me, config, venue, b.salt)
    if (await client.isShipped(me, order, client.appFor(venue), config.tokens[0]!)) {
      console.log(`backstop cap $${b.capUsd} already live`)
      continue
    }
    const pledges = config.tokens.map((t, k) => {
      const price = prices.get(t.toLowerCase())?.priceE18 ?? WAD
      return PAYOUT.includes(client.token(t).symbol) ? (b.pledgeUsd * 10n ** BigInt(config.decimals[k]!) * WAD) / price : 0n
    })
    const done = await client.shipBackstop(wallet, config, pledges, venue, b.salt)
    console.log(`backstop cap $${b.capUsd} on ${b.venue} ${done.strategyHash} tx ${done.hash}`)
  }

  const market = await client.market()
  console.log(`live: ${market.ranges.length} ranges, ${market.backstops.length} backstops`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
