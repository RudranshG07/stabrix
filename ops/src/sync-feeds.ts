import { type Hex, createPublicClient, createWalletClient, http, parseAbi, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import { RPC_URL, connect, loadDeployment } from './env.js'

const MAINNET_FX: Record<string, `0x${string}`> = {
  EURC: '0xc91D87E81faB8f93699ECf7Ee9B44D11e1D53F0F',
  BRZ: '0x0b0E64c05083FdF9ED7C5D3d8262c4216eFc9394',
  IDRX: '0x05A6cF213EcC5501A11a08EBefA4A8a60313ef97',
}

const feedAbi = parseAbi([
  'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)',
  'function set(int256 answer)',
])

async function main() {
  const key = process.env.PRIVATE_KEY as Hex | undefined
  if (!key) throw new Error('PRIVATE_KEY is required')
  const c = await connect()
  if (c.chainId === 8453) throw new Error('Base mainnet uses real Chainlink feeds; nothing to sync')
  const d = loadDeployment(c.chainId)
  const mainnet = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? 'https://mainnet.base.org') })
  const wallet = createWalletClient({ chain: c.chain, account: privateKeyToAccount(key), transport: http(RPC_URL) })

  for (const t of d.tokens) {
    const source = MAINNET_FX[t.symbol]
    if (t.feed === zeroAddress || !source) continue
    const [, answer] = await mainnet.readContract({ address: source, abi: feedAbi, functionName: 'latestRoundData' })
    const hash = await wallet.writeContract({ address: t.feed, abi: feedAbi, functionName: 'set', args: [answer] })
    await c.publicClient.waitForTransactionReceipt({ hash })
    console.log(`${t.symbol} feed set to ${Number(answer) / 1e8} from Base mainnet Chainlink in ${hash}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
