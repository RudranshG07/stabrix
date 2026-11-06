import type { Market, PriceInfo, TokenInfo } from '@stabrix/sdk'

export function priceOf(market: Market | undefined, token: TokenInfo): PriceInfo | undefined {
  return market?.prices.get(token.address.toLowerCase())
}

export function usd(amount: bigint, decimals: number, priceE18: bigint | null | undefined): number | null {
  if (priceE18 == null) return null
  return Number((amount * priceE18) / 10n ** BigInt(decimals)) / 1e18
}

export function units(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals
}

export function formatRatio(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '-'
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (v >= 0.01) return v.toFixed(5)
  return v.toPrecision(4)
}

export function withoutMaker(market: Market, maker: string | undefined): Market {
  if (!maker) return market
  const me = maker.toLowerCase()
  return {
    ...market,
    ranges: market.ranges.filter((r) => r.maker.toLowerCase() !== me),
    backstops: market.backstops.filter((b) => b.maker.toLowerCase() !== me),
  }
}
