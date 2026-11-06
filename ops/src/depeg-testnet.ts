import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StabrixClient, WAD, mockStablecoinAbi, stabrixOracleAbi } from '@stabrix/sdk'
import { type Hex, createWalletClient, formatUnits, http, parseAbi, parseEther, parseUnits, zeroAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ROOT, RPC_URL, connect, deployerKey, loadDeployment } from './env.js'

const MARKET_FEED_MAX_AGE = 90_000
const feedAbi = parseAbi(['function set(int256 answer)', 'function owner() view returns (address)'])

async function main() {
  const [command, symbol, value] = process.argv.slice(2)
  if (!['halt', 'resume', 'sell'].includes(command ?? '') || !symbol) {
    throw new Error('usage: depeg-testnet halt <SYMBOL> <price> | resume <SYMBOL> | sell <SYMBOL> <usd>')
  }
  const c = await connect()
  if (c.chainId === 8453) throw new Error('Base mainnet coins depeg for real; this demo is for testnets only')
  const d = loadDeployment(c.chainId)
  const client = new StabrixClient(c.publicClient, d)
  const wallet = createWalletClient({ chain: c.chain, account: privateKeyToAccount(deployerKey()), transport: http(RPC_URL) })
  const token = d.tokens.find((t) => t.symbol === symbol)
  if (!token) throw new Error(`unknown coin ${symbol}`)
  const send = async (label: string, hash: Hex) => {
    const receipt = await c.publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`${label} reverted in ${hash}`)
    console.log(`${label}: ${hash}`)
  }
  const oracle = { address: d.oracle, abi: stabrixOracleAbi } as const

  if (command === 'halt') {
    const price = Number(value)
    if (!(price > 0 && price < 1.5)) throw new Error('price must be a USD price such as 0.93')
    const answer = parseUnits(value!, 8)
    const [feed] = await c.publicClient.readContract({ ...oracle, functionName: 'marketFeeds', args: [token.address] })
    if (feed === zeroAddress) {
      const artifact = JSON.parse(readFileSync(join(ROOT, 'contracts/out/TestnetFeed.sol/TestnetFeed.json'), 'utf8'))
      const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [answer] })
      const receipt = await c.publicClient.waitForTransactionReceipt({ hash })
      await send(`${symbol} market feed deployed at ${receipt.contractAddress}`, hash)
      await send(
        'oracle reads it as the market price',
        await wallet.writeContract({ ...oracle, functionName: 'setMarketFeed', args: [token.address, receipt.contractAddress!, MARKET_FEED_MAX_AGE] }),
      )
    } else {
      await send(`${symbol} market price set to $${value}`, await wallet.writeContract({ address: feed, abi: feedAbi, functionName: 'set', args: [answer] }))
    }
    await send(`${symbol} halted by the guardian`, await wallet.writeContract({ ...oracle, functionName: 'guardianSet', args: [token.address, true] }))
    const depeg = await c.publicClient.readContract({ ...oracle, functionName: 'depegPrice', args: [token.address] })
    console.log(`backstops now buy ${symbol} below $${formatUnits(depeg, 18)}`)
    return
  }

  if (command === 'resume') {
    await send(`${symbol} resumed by the guardian`, await wallet.writeContract({ ...oracle, functionName: 'guardianSet', args: [token.address, false] }))
    const [feed] = await c.publicClient.readContract({ ...oracle, functionName: 'marketFeeds', args: [token.address] })
    if (feed !== zeroAddress) {
      const [face] = await c.publicClient.readContract({ ...oracle, functionName: 'priceOf', args: [token.address] })
      await send(`${symbol} market price back to $${formatUnits(face, 18)}`, await wallet.writeContract({ address: feed, abi: feedAbi, functionName: 'set', args: [face / 10n ** 10n] }))
    }
    return
  }

  const usd = BigInt(value ?? '1000')
  if (!(await c.publicClient.readContract({ ...oracle, functionName: 'isHalted', args: [token.address] }))) {
    throw new Error(`${symbol} is not halted; run halt first`)
  }
  const taker = createWalletClient({ chain: c.chain, account: privateKeyToAccount(generatePrivateKey()), transport: http(RPC_URL) })
  const usdc = d.tokens.find((t) => t.symbol === (symbol === 'USDC' ? 'USDT' : 'USDC'))!
  const amount = (usd * 10n ** BigInt(token.decimals) * WAD) / (await c.publicClient.readContract({ ...oracle, functionName: 'priceOf', args: [token.address] }))[0]
  console.log(`fresh taker ${taker.account.address}`)
  const gas = (await c.publicClient.getGasPrice()) * 6_000_000n
  await send('gas for the taker', await wallet.sendTransaction({ to: taker.account.address, value: gas > parseEther('0.0002') ? gas : parseEther('0.0002') }))
  await send(`taker gets ${formatUnits(amount, token.decimals)} test ${symbol}`, await taker.writeContract({ address: token.address, abi: mockStablecoinAbi, functionName: 'mint', args: [taker.account.address, amount] }))

  const tokens = d.tokens.map((t) => t.address)
  try {
    await c.publicClient.readContract({ ...oracle, functionName: 'prices', args: [tokens, token.address] })
    throw new Error('oracle still prices the coin for ranges')
  } catch (e) {
    if ((e as Error).message.includes('still prices')) throw e
    console.log(`every FX range refuses ${symbol}: the oracle reverts Halted`)
  }

  const market = await client.market()
  const quote = client.quoteExactIn(market, token.address, usdc.address, amount)
  if (quote.legs.length === 0 || quote.filled < amount) throw new Error('backstops cannot take the whole amount')
  const kinds = quote.legs.map((l) => quote.strategies.find((s) => s.id === l.id)!.kind)
  console.log(`route: ${quote.legs.length} leg(s), all ${[...new Set(kinds)].join(', ')}`)
  const done = await client.swap(taker, quote, 50)
  console.log(`sold ${formatUnits(amount, token.decimals)} ${symbol} for ${formatUnits(done.amountOut, usdc.decimals)} ${usdc.symbol}, quote ${formatUnits(quote.amountOut, usdc.decimals)}: ${done.hash}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
