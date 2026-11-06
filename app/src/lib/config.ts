export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8555'
export const PRICE_API = process.env.NEXT_PUBLIC_PRICE_API ?? 'http://127.0.0.1:8790'
export const DEV_ACCOUNTS = process.env.NEXT_PUBLIC_DEV_ACCOUNTS === '1'
export const POLL_MS = 2500

export interface DevAccount {
  label: string
  index: number
  key: `0x${string}`
}

export const ANVIL_ACCOUNTS: readonly DevAccount[] =
  process.env.NEXT_PUBLIC_DEV_ACCOUNTS === '1'
    ? [
        { label: 'Trader', index: 4, key: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a' },
        { label: 'LP 1 · Tight', index: 1, key: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' },
        { label: 'LP 2 · Balanced', index: 2, key: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' },
        { label: 'LP 3 · Wide', index: 3, key: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' },
        { label: 'Guardian', index: 0, key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' },
      ]
    : []
