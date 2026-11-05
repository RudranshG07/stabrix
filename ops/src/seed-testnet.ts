import { type PresetId, StabrixClient, type Venue, WAD, mockStablecoinAbi } from '@stabrix/sdk'
import { type Hex, createWalletClient, formatUnits, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { RPC_URL, connect, loadDeployment } from './env.js'

const RANGES: { preset: PresetId; perCoin: bigint; venue: 'native' | 'official' }[] = [
  { preset: 'tight', perCoin: 40_000n, venue: 'native' },
  { preset: 'balanced', perCoin: 60_000n, venue: 'native' },
  { preset: 'wide', perCoin: 80_000n, venue: 'official' },
]
const TRADING_FLOAT = 50_000n

async function main() {
  const key = process.env.PRIVATE_KEY as Hex | undefined
  if (!key) throw new Error('PRIVATE_KEY is required')
  const c = await connect()
  const deployment = loadDeployment(c.chainId)
  const client = new StabrixClient(c.publicClient, deployment)
  const wallet = createWalletClient({ chain: c.chain, account: privateKeyToAccount(key), transport: http(RPC_URL) })
  const me = wallet.account.address

  const total = RANGES.reduce((s, r) => s + r.perCoin, TRADING_FLOAT)
  for (const t of deployment.tokens) {
    const hash = await wallet.writeContract({
      address: t.address,
      abi: mockStablecoinAbi,
      functionName: 'mint',
      args: [me, total * 10n ** BigInt(t.decimals)],
    })
    await c.publicClient.waitForTransactionReceipt({ hash })
    console.log(`minted ${total} ${t.symbol}`)
  }

  for (const [k, r] of RANGES.entries()) {
    const venue: Venue = r.venue === 'native' ? { kind: 'native' } : { kind: 'official', extruction: deployment.extruction }
    const config = client.buildRange(r.preset, r.perCoin * WAD)
    if (await client.isShipped(me, config, venue, BigInt(k + 1))) {
      console.log(`${r.preset.padEnd(8)} already live, skipping`)
      continue
    }
    const shipped = await client.ship(wallet, config, r.perCoin * WAD, venue, BigInt(k + 1))
    console.log(`${r.preset.padEnd(8)} ${r.venue.padEnd(8)} ${shipped.strategyHash} tx ${shipped.hash}`)
  }

  const ranges = await client.listRanges()
  const usdc = deployment.tokens.find((t) => t.symbol === 'USDC')!
  const dai = deployment.tokens.find((t) => t.symbol === 'DAI')!
  const quote = client.quoteExactIn(ranges, usdc.address, dai.address, 1_000n * 10n ** BigInt(usdc.decimals))
  const done = await client.swap(wallet, quote, 30)
  console.log(`ranges live: ${ranges.length}; swapped 1,000 USDC for ${formatUnits(done.amountOut, dai.decimals)} DAI in ${done.hash}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
