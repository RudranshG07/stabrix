import { type Address, type Hex, encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, numberToHex } from 'viem'
import type { connect } from './env.js'

type Clients = Awaited<ReturnType<typeof connect>>
type KeyOf = (holder: Address) => Hex

const OZ_ERC20_NAMESPACE = 0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00n
const CANDIDATE_SLOTS = [...Array.from({ length: 128 }, (_, k) => BigInt(k)), OZ_ERC20_NAMESPACE]

const layouts = (slot: bigint): KeyOf[] => [
  (h) => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [h, slot])),
  (h) => keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }], [slot, h])),
]

const cache = new Map<string, KeyOf>()

async function touchedKeys(c: Clients, token: Address, holder: Address): Promise<Set<string>> {
  const trace = (await c.publicClient.request({
    method: 'debug_traceCall' as never,
    params: [
      { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [holder] }) },
      'latest',
      { tracer: 'prestateTracer' },
    ] as never,
  })) as Record<string, { storage?: Record<string, string> }>
  const entry = trace[token.toLowerCase()] ?? {}
  return new Set(Object.keys(entry.storage ?? {}).map((k) => k.toLowerCase()))
}

async function locate(c: Clients, token: Address, holder: Address): Promise<KeyOf> {
  const hit = cache.get(token.toLowerCase())
  if (hit) return hit
  const keys = await touchedKeys(c, token, holder)
  for (const slot of CANDIDATE_SLOTS) {
    for (const keyOf of layouts(slot)) {
      if (keys.has(keyOf(holder).toLowerCase())) {
        cache.set(token.toLowerCase(), keyOf)
        return keyOf
      }
    }
  }
  throw new Error(`balance slot not found for ${token}`)
}

export async function dealERC20(c: Clients, token: Address, holder: Address, amount: bigint) {
  const keyOf = await locate(c, token, holder)
  await c.testClient.setStorageAt({ address: token, index: keyOf(holder), value: numberToHex(amount, { size: 32 }) })
  const after = await c.publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [holder],
  })
  if (after !== amount) throw new Error(`deal failed for ${token}: got ${after}`)
}
