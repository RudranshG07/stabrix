'use client'

import { useEffect, useState } from 'react'
import { createPublicClient, fallback, http, parseAbi } from 'viem'
import { base } from 'viem/chains'

const FEEDS = [
  { label: 'USDC/USD', address: '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B', digits: 4 },
  { label: 'EURC/USD', address: '0x9867186e52d2F1C2c565CDA6E747101Fa56501e0', digits: 4 },
  { label: 'BRL/USD', address: '0x0b0E64c05083FdF9ED7C5D3d8262c4216eFc9394', digits: 4 },
  { label: 'IDR/USD', address: '0x05A6cF213EcC5501A11a08EBefA4A8a60313ef97', digits: 7 },
] as const

const abi = parseAbi(['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)'])
const client = createPublicClient({
  chain: base,
  transport: fallback([
    http(process.env.NEXT_PUBLIC_BASE_RPC_URL ?? 'https://mainnet.base.org'),
    http('https://base-rpc.publicnode.com'),
  ]),
})

export function LiveRates() {
  const [values, setValues] = useState<string[] | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await client.multicall({
          contracts: FEEDS.map((f) => ({ address: f.address, abi, functionName: 'latestRoundData' }) as const),
          allowFailure: false,
        })
        if (!alive) return
        setValues(res.map((r, k) => `$${(Number(r[1]) / 1e8).toFixed(FEEDS[k]!.digits)}`))
      } catch {
        if (alive) setValues(null)
      }
    }
    load()
    const id = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  if (!values) return null
  return (
    <div className="rates" aria-label="Live Chainlink prices on Base">
      <span className="live">
        <i aria-hidden />
        Chainlink on Base
      </span>
      {FEEDS.map((f, k) => (
        <span key={f.label}>
          {f.label} <b>{values[k]}</b>
        </span>
      ))}
    </div>
  )
}
