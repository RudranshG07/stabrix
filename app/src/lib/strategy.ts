import { type LiveBackstop, type LiveRange, PRESETS, type PresetId, type PriceInfo, backstopRoom } from '@stabrix/sdk'

export type LiveStrategy = LiveRange | LiveBackstop

export const BACKSTOP_PRESETS = [
  { id: 'light', label: 'Light', startBps: 100, endBps: 500 },
  { id: 'standard', label: 'Standard', startBps: 200, endBps: 1000 },
  { id: 'deep', label: 'Deep', startBps: 500, endBps: 2500 },
] as const

export type BackstopPresetId = (typeof BACKSTOP_PRESETS)[number]['id']

export function presetOf(r: LiveRange): PresetId | null {
  return PRESETS.find((p) => p.feeBps === r.config.feeBps && p.fxFeeBps === r.config.fxFeeBps)?.id ?? null
}

export function markPrice(info: PriceInfo | undefined): bigint | null {
  if (!info) return null
  return info.halted ? (info.depegE18 ?? info.priceE18) : info.priceE18
}

export function valueUsd(amount: bigint, decimals: number, info: PriceInfo | undefined): number {
  const p = markPrice(info)
  if (p == null || amount === 0n) return 0
  return Number((amount * p) / 10n ** BigInt(decimals)) / 1e18
}

export function strategyUsd(s: LiveStrategy, prices: Map<string, PriceInfo>): number {
  return s.config.tokens.reduce((sum, t, k) => sum + valueUsd(s.balances[k] ?? 0n, s.config.decimals[k]!, prices.get(t.toLowerCase())), 0)
}

export function shortCoins(s: LiveStrategy, prices: Map<string, PriceInfo>): number[] {
  return s.config.tokens.flatMap((t, k) => {
    if (s.kind === 'backstop' && prices.get(t.toLowerCase())?.halted) return []
    return (s.balances[k] ?? 0n) > (s.spendable[k] ?? 0n) ? [k] : []
  })
}

export function backstopFill(b: LiveBackstop, prices: Map<string, PriceInfo>) {
  return b.config.tokens.flatMap((t, k) => {
    const info = prices.get(t.toLowerCase())
    if (!info?.halted || info.priceE18 == null) return []
    const room = backstopRoom({ absorbedIn: b.balances[k] ?? 0n, faceIn: info.priceE18, decimalsIn: b.config.decimals[k]!, cap: b.config.capPerToken })
    const cap = Number(b.config.capPerToken) / 1e18
    const left = Number(room) / 1e18
    return [{ index: k, token: t, used: cap > 0 ? 1 - left / cap : 1, roomUsd: left }]
  })
}

export const isMine = (s: LiveStrategy, owner: string | undefined) => !!owner && s.maker.toLowerCase() === owner.toLowerCase()
