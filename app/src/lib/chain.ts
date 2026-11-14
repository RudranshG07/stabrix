export const SOLANA_CHAINS = new Set([101, 103, 104])

export const isSolanaChain = (chainId: number) => SOLANA_CHAINS.has(chainId)

const EXPLORERS: Record<number, { name: string; tx: (h: string) => string; address: (a: string) => string }> = {
  8453: { name: 'Basescan', tx: (h) => `https://basescan.org/tx/${h}`, address: (a) => `https://basescan.org/address/${a}` },
  84532: {
    name: 'Basescan',
    tx: (h) => `https://sepolia.basescan.org/tx/${h}`,
    address: (a) => `https://sepolia.basescan.org/address/${a}`,
  },
  101: { name: 'Solscan', tx: (h) => `https://solscan.io/tx/${h}`, address: (a) => `https://solscan.io/account/${a}` },
  103: {
    name: 'Solscan',
    tx: (h) => `https://solscan.io/tx/${h}?cluster=devnet`,
    address: (a) => `https://solscan.io/account/${a}?cluster=devnet`,
  },
}

export const explorerFor = (chainId: number) => EXPLORERS[chainId]

export const CHAIN_NAMES: Record<number, string> = {
  8453: 'Base',
  84532: 'Base Sepolia',
  101: 'Solana',
  103: 'Solana Devnet',
  104: 'Solana Localnet',
}

export interface ChainCopy {
  oracle: string
  guard: string
  haltSource: string
  venue: string
  swapIntro: string
  pricesNote: string
  rateStale: (coins: string[]) => string
  gas: string
}

const EVM: ChainCopy = {
  oracle: 'Chainlink',
  guard: 'Chainlink CRE',
  haltSource: 'Chainlink CRE',
  venue: 'Stabrix router',
  swapIntro:
    'Any pair across eight stablecoins. One quote splits across LP strategies on the 1inch router and the Stabrix router, settled in one transaction.',
  pricesNote: 'Pegged coins count at $1 unless CRE halts them. FX coins use live Chainlink rates. Tap a coin to receive it.',
  rateStale: (coins) =>
    coins.length > 1
      ? `The Chainlink rates for ${coins.join(', ')} are stale, so ranges with these coins pause until they update.`
      : `The Chainlink rate for ${coins[0]} is stale, so ranges with it pause until it updates.`,
  gas: 'ETH',
}

const SOLANA: ChainCopy = {
  oracle: 'Pyth',
  guard: 'the Stabrix sentinel',
  haltSource: 'the Stabrix sentinel',
  venue: 'Stabrix program',
  swapIntro:
    'Any pair across eight Solana stablecoins. One quote splits across LP strategies and settles in one transaction, paid straight from the LPs’ wallets.',
  pricesNote: 'Pegged coins count at $1 unless the sentinel halts them. FX coins use Pyth rates checked by the sentinel. Tap a coin to receive it.',
  rateStale: (coins) =>
    coins.length > 1
      ? `The Pyth rates for ${coins.join(', ')} are stale, so ranges with these coins pause until they update.`
      : `The Pyth rate for ${coins[0]} is stale, so ranges with it pause until it updates.`,
  gas: 'SOL',
}

export const copyFor = (chainId: number): ChainCopy => (isSolanaChain(chainId) ? SOLANA : EVM)
