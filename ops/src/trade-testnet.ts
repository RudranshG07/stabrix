import { StabrixClient, WAD, mockStablecoinAbi } from '@stabrix/sdk'
import { createWalletClient, formatUnits, http, parseEther } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { RPC_URL, connect, deployerKey, loadDeployment } from './env.js'

async function main() {
  const [from = 'USDC', to = 'DAI', size = '10000'] = process.argv.slice(2)
  const c = await connect()
  if (c.chainId === 8453) throw new Error('testnets only: this mints test coins to a fresh wallet')
  const d = loadDeployment(c.chainId)
  const client = new StabrixClient(c.publicClient, d)
  const funder = createWalletClient({ chain: c.chain, account: privateKeyToAccount(deployerKey()), transport: http(RPC_URL) })
  const trader = createWalletClient({ chain: c.chain, account: privateKeyToAccount(generatePrivateKey()), transport: http(RPC_URL) })
  const tIn = d.tokens.find((t) => t.symbol === from)
  const tOut = d.tokens.find((t) => t.symbol === to)
  if (!tIn || !tOut) throw new Error('unknown coin')

  const market = await client.market()
  const price = (a: string) => market.prices.get(a.toLowerCase())?.priceE18 ?? WAD
  const amount = (BigInt(size) * WAD * 10n ** BigInt(tIn.decimals)) / price(tIn.address)
  const gas = (await c.publicClient.getGasPrice()) * 6_000_000n
  const wait = async (hash: `0x${string}`) => c.publicClient.waitForTransactionReceipt({ hash })
  await wait(await funder.sendTransaction({ to: trader.account.address, value: gas > parseEther('0.0002') ? gas : parseEther('0.0002') }))
  await wait(await trader.writeContract({ address: tIn.address, abi: mockStablecoinAbi, functionName: 'mint', args: [trader.account.address, amount] }))

  const quote = client.quoteExactIn(market, tIn.address, tOut.address, amount)
  if (quote.filled < amount) throw new Error('not enough liquidity for the whole amount')
  const done = await client.swap(trader, quote, 30)
  const valueIn = (amount * price(tIn.address)) / 10n ** BigInt(tIn.decimals)
  const valueOut = (done.amountOut * price(tOut.address)) / 10n ** BigInt(tOut.decimals)
  const bps = Number(((valueIn - valueOut) * 1_000_000n) / valueIn) / 100
  console.log(`trader ${trader.account.address}`)
  console.log(`swapped ${formatUnits(amount, tIn.decimals)} ${from} for ${formatUnits(done.amountOut, tOut.decimals)} ${to} (quote ${formatUnits(quote.amountOut, tOut.decimals)}), cost ${bps.toFixed(2)} bps over ${quote.legs.length} leg(s)`)
  console.log(`tx ${done.hash}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
