export const dynamic = 'force-dynamic'

const UPSTREAM: Record<string, string> = {
  '101': process.env.SOLANA_RPC_URL_101 ?? 'https://api.mainnet-beta.solana.com',
  '103': process.env.SOLANA_RPC_URL_103 ?? 'https://api.devnet.solana.com',
}

const ALLOWED = new Set([
  'getAccountInfo',
  'getBalance',
  'getBlockHeight',
  'getFeeForMessage',
  'getGenesisHash',
  'getHealth',
  'getLatestBlockhash',
  'getMinimumBalanceForRentExemption',
  'getMultipleAccounts',
  'getProgramAccounts',
  'getSignatureStatuses',
  'getSignaturesForAddress',
  'getSlot',
  'getTokenAccountBalance',
  'getTransaction',
  'getVersion',
  'isBlockhashValid',
  'sendTransaction',
  'simulateTransaction',
])

const MAX_BODY = 64 * 1024
const MAX_BATCH = 20

interface RpcCall {
  method?: unknown
}

export async function POST(req: Request) {
  const upstream = UPSTREAM[new URL(req.url).searchParams.get('chain') ?? '']
  if (!upstream) return Response.json({ error: 'unknown chain' }, { status: 400 })
  const text = await req.text()
  if (text.length > MAX_BODY) return Response.json({ error: 'request too large' }, { status: 413 })
  let body: RpcCall | RpcCall[]
  try {
    body = JSON.parse(text)
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  const calls = Array.isArray(body) ? body : [body]
  if (calls.length === 0 || calls.length > MAX_BATCH) return Response.json({ error: 'bad batch size' }, { status: 400 })
  if (!calls.every((c) => typeof c.method === 'string' && ALLOWED.has(c.method))) {
    return Response.json({ error: 'method not allowed' }, { status: 403 })
  }
  const res = await fetch(upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text, cache: 'no-store' })
  return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}
