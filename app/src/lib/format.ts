import { formatUnits } from 'viem'

const groups = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export function formatAmount(value: bigint, decimals: number, maxFraction = 2): string {
  const raw = formatUnits(value, decimals)
  const [whole = '0', frac = ''] = raw.split('.')
  const trimmed = frac.slice(0, maxFraction).replace(/0+$/, '')
  return trimmed ? `${groups(whole)}.${trimmed}` : groups(whole)
}

export function formatUsd(value: number, fraction = 2): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: fraction, maximumFractionDigits: fraction })}`
}

export function formatPct(value: number, fraction = 2): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(fraction)}%`
}

export function formatRate(e18: bigint | null | undefined, digits = 4): string {
  if (e18 === null || e18 === undefined) return '-'
  const v = Number(e18) / 1e18
  return `$${v < 0.01 ? v.toFixed(7) : v.toFixed(digits)}`
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function toUnits(text: string, decimals: number): bigint | null {
  const clean = text.replace(/,/g, '').trim()
  if (!/^\d*\.?\d*$/.test(clean) || clean === '' || clean === '.') return null
  const [whole = '0', frac = ''] = clean.split('.')
  if (frac.length > decimals) return null
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((frac || '').padEnd(decimals, '0') || '0')
}
