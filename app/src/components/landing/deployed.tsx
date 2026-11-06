'use client'

import { useEffect, useState } from 'react'
import { DEV_ACCOUNTS } from '@/lib/config'

interface Raw {
  chainId: number
  officialAqua?: boolean
  aqua: string
  router: string
  officialRouter: string
  extruction: string
  backstop: string
  batchTaker: string
  oracle: string
  lens: string
  tokens: { symbol: string; address: string }[]
}

const NETWORKS: Record<number, { name: string; explorer: string }> = {
  8453: { name: 'Base', explorer: 'https://basescan.org/address/' },
  84532: { name: 'Base Sepolia', explorer: 'https://sepolia.basescan.org/address/' },
}

export function Deployed() {
  const [d, setD] = useState<Raw | null>(null)

  useEffect(() => {
    if (DEV_ACCOUNTS) return
    fetch('/api/deployment', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Raw | null) => setD(j && NETWORKS[j.chainId] ? j : null))
      .catch(() => setD(null))
  }, [])

  if (!d) return null
  const net = NETWORKS[d.chainId]!
  const official = d.officialAqua !== false
  const rows: [string, string, string][] = [
    ['StabrixRouter', 'SwapVM router with opcodes 34 and 35', d.router],
    ['StabrixExtruction', 'FX range pricing for the 1inch router', d.extruction],
    ['StabrixBackstop', 'Backstop pricing for the 1inch router', d.backstop],
    ['StabrixOracle', 'Chainlink CRE consumer', d.oracle],
    ['StabrixBatchTaker', 'One trade across both routers', d.batchTaker],
    ['StabrixLens', 'Order builder and balances', d.lens],
    ['Aqua', official ? '1inch, official deployment' : '1inch source, deployed by us', d.aqua],
    ['AquaSwapVMRouter', official ? '1inch, official deployment' : '1inch source, deployed by us', d.officialRouter],
  ]

  return (
    <section className="sec" id="deployed">
      <header className="sec-head">
        <p className="eb">Deployed</p>
        <h2>Live on {net.name}</h2>
        <p className="intro">Chain {d.chainId}. Every address links to the explorer.</p>
      </header>
      <ul className="addr">
        {rows.map(([name, what, addr]) => (
          <li key={name}>
            <a href={`${net.explorer}${addr}`} target="_blank" rel="noreferrer">
              <b>{name}</b>
              <span>{what}</span>
              <code>
                {addr.slice(0, 8)}…{addr.slice(-6)}
              </code>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
