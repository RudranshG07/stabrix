'use client'

import { DEV_ACCOUNTS } from '@/lib/config'
import { useMaybeStabrix } from '@/lib/stabrix'

const EXPLORERS: Record<number, string> = { 8453: 'https://basescan.org/address/', 84532: 'https://sepolia.basescan.org/address/' }
const NAMES: Record<number, string> = { 8453: 'Base', 84532: 'Base Sepolia' }

export function DocsDeployment() {
  const ctx = useMaybeStabrix()
  if (!ctx) return <p className="text-[14px] text-muted">No deployment is loaded in this app yet.</p>
  const d = ctx.deployment
  const explorer = DEV_ACCOUNTS ? undefined : EXPLORERS[d.chainId]
  const where = DEV_ACCOUNTS ? `a local fork of ${NAMES[d.chainId] ?? `chain ${d.chainId}`}` : (NAMES[d.chainId] ?? `chain ${d.chainId}`)
  const rows: [string, string][] = [
    ['StabrixRouter', d.router],
    ['StabrixExtruction', d.extruction],
    ['StabrixBackstop', d.backstop],
    ['StabrixOracle', d.oracle],
    ['StabrixBatchTaker', d.batchTaker],
    ['StabrixLens', d.lens],
    ['Aqua', d.aqua],
    ['AquaSwapVMRouter', d.officialRouter],
  ]
  return (
    <>
      <p className="text-[14px] text-muted">This app is connected to {where}.</p>
      <div className="ink-card mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left">
          <tbody>
            {rows.map(([name, addr]) => (
              <tr key={name} className="border-b border-line last:border-0">
                <th scope="row" className="px-5 py-3 text-[12px] font-medium tracking-[0.06em]">
                  {name}
                </th>
                <td className="px-5 py-3 font-mono text-[12px]">
                  {explorer ? (
                    <a href={`${explorer}${addr}`} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:decoration-ink">
                      {addr}
                    </a>
                  ) : (
                    addr
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
