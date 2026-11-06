export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8555'
export const PRICE_API = process.env.NEXT_PUBLIC_PRICE_API ?? 'http://127.0.0.1:8790'
export const DEV_ACCOUNTS = process.env.NEXT_PUBLIC_DEV_ACCOUNTS === '1'
export const POLL_MS = 2500

export const CHAINLINK_FEEDS: Record<string, `0x${string}`> = {
  USDC: '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',
  USDT: '0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9',
  DAI: '0x591e79239a7d679378eC8c847e5038150364C78F',
  USDS: '0x2330aaE3bca5F05169d5f4597964D44522F62930',
  USDe: '0x790181e93e9F4Eedb5b864860C12e4d2CffFe73B',
}

export const ANVIL_ACCOUNTS = [
  { label: 'Trader', index: 4, key: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a' },
  { label: 'LP Tight', index: 1, key: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' },
  { label: 'LP Balanced', index: 2, key: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' },
  { label: 'LP Wide', index: 3, key: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' },
  { label: 'Guardian', index: 0, key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' },
] as const
