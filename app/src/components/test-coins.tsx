'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { encodeFunctionData, parseAbi } from 'viem'
import { Button } from '@/components/ui'
import { DEV_ACCOUNTS } from '@/lib/config'
import { useBalances, useMarket, useStabrix } from '@/lib/stabrix'

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
export const SEPOLIA_FAUCET = 'https://portal.cdp.coinbase.com/products/faucet'
const USD_EACH = 10_000n

const multicallAbi = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
])
const mintAbi = parseAbi(['function mint(address to, uint256 amount)'])

function reason(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string }
  return err.shortMessage ?? err.message ?? 'Transaction failed'
}

export function useTestCoins() {
  const { deployment, wallet, signer, publicClient } = useStabrix()
  const market = useMarket()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const available = !DEV_ACCOUNTS && deployment.chainId === 84532 && signer?.kind === 'injected'

  const mint = async () => {
    if (!wallet || !signer) return
    setBusy(true)
    setError(null)
    try {
      const calls = deployment.tokens.map((t) => {
        const price = market.data?.prices.get(t.address.toLowerCase())?.priceE18
        const unit = 10n ** BigInt(t.decimals)
        const amount = price ? (USD_EACH * 10n ** 18n * unit) / price : USD_EACH * unit
        return { target: t.address, allowFailure: false, callData: encodeFunctionData({ abi: mintAbi, functionName: 'mint', args: [signer.address, amount] }) }
      })
      const hash = await wallet.writeContract({ address: MULTICALL3, abi: multicallAbi, functionName: 'aggregate3', args: [calls] })
      await publicClient.waitForTransactionReceipt({ hash })
      await qc.invalidateQueries({ queryKey: ['balances'] })
    } catch (e) {
      setError(reason(e))
    } finally {
      setBusy(false)
    }
  }

  return { available, mint, busy, error }
}

export function TestCoinsNotice() {
  const { signer, publicClient } = useStabrix()
  const { available, mint, busy, error } = useTestCoins()
  const balances = useBalances(available ? signer?.address : undefined)
  const gas = useQuery({
    queryKey: ['gas', signer?.address],
    queryFn: () => publicClient.getBalance({ address: signer!.address }),
    enabled: available,
    refetchInterval: 15_000,
  })
  if (!available || !balances.data || balances.data.some((b) => b > 0n)) return null
  const noGas = gas.data === 0n
  return (
    <div className="ink-card flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="min-w-0">
        <p className="text-[14px] font-medium">This wallet has no test coins yet</p>
        <p className="mt-1 text-[13px] text-muted">
          {noGas
            ? 'Get some Base Sepolia ETH for gas first, then mint test coins.'
            : 'Mint $10,000 of each of the 8 test stablecoins in one transaction. They only exist on Base Sepolia.'}
        </p>
        {error && <p className="mt-1 text-[12.5px] text-down">{error}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {noGas && (
          <a
            href={SEPOLIA_FAUCET}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-4 text-[13px] font-medium transition-colors hover:bg-surface-hover"
          >
            Get Sepolia ETH
          </a>
        )}
        <Button size="sm" busy={busy} disabled={noGas} onClick={mint}>
          Get test coins
        </Button>
      </div>
    </div>
  )
}
