import { type SolanaRange, SolanaStabrixClient, ix } from '@stabrix/sdk/solana'
import { Keypair, LAMPORTS_PER_SOL, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { connect, loadKeypair, readDeployment, signerOf } from './common.js'

const conn = connect('localnet')
const d = readDeployment('localnet')
if (!d) throw new Error('run solana:setup -- --cluster=localnet first')
const client = new SolanaStabrixClient(conn, d)
const admin = loadKeypair()
const program = client.program
const sym = (s: string) => client.tokens.find((t) => t.symbol === s)!
const usd = (n: number) => BigInt(n) * 10n ** 18n
let failures = 0

function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

async function funded() {
  const kp = Keypair.generate()
  const sig = await conn.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL)
  await conn.confirmTransaction(sig, 'confirmed')
  return kp
}

async function cu(sig: string) {
  const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  return tx?.meta?.computeUnitsConsumed ?? 0
}

async function expectFail(label: string, f: () => Promise<unknown>, code: string) {
  try {
    await f()
    check(label, false, 'did not fail')
  } catch (e) {
    const msg = String((e as Error).message)
    check(label, msg.includes(code), msg.slice(0, 140))
  }
}

const now = Math.floor(Date.now() / 1000)
const rows = client.tokens.map((t, index) => ({
  index,
  priceE9: t.symbol === 'EURC' ? 1_160_000_000n : t.symbol === 'BRZ' ? 188_000_000n : 1_000_000_000n,
  halted: false,
}))
await sendAndConfirmTransaction(conn, new Transaction().add(ix.report(program, admin.publicKey, now, rows)), [admin])
const prices = await client.prices()
check('oracle prices EURC from the report', prices.get(sym('EURC').address.toLowerCase())?.priceE18 === 1_160_000_000n * 10n ** 9n)

const lp1 = await funded()
const lp2 = await funded()
const bs = await funded()
const trader = await funded()
for (const kp of [lp1, lp2, bs, trader]) await client.faucet(signerOf(kp), 50_000)
check('faucet minted test coins', (await client.balancesOf(trader.publicKey)).every((b) => b > 0n))

const before = await client.balancesOf(lp1.publicKey)
const r1 = await client.ship(signerOf(lp1), client.buildRange('balanced', usd(20_000)), usd(20_000), undefined, 1n)
const r2 = await client.ship(signerOf(lp2), client.buildRange('tight', usd(10_000), { tokens: [sym('USDC').address, sym('USDT').address, sym('PYUSD').address, sym('EURC').address] }), usd(10_000), undefined, 2n)
const after = await client.balancesOf(lp1.publicKey)
check('opening a range moves no coins out of the wallet', before.every((b, k) => b === after[k]))
const backstopConfig = client.buildBackstop(200, 1000, usd(30_000))
const pledges = backstopConfig.tokens.map((t) => {
  const s = client.token(t).symbol
  return s === 'USDC' || s === 'USDT' ? 30_000n * 10n ** 6n : 0n
})
await client.shipBackstop(signerOf(bs), backstopConfig, pledges, undefined, 3n)

let market = await client.market()
check('market lists two ranges and one backstop', market.ranges.length === 2 && market.backstops.length === 1)
check('spendable reads the delegate approval', market.ranges.every((r) => r.spendable.every((s) => s > 0n)))
console.log(`  strategy ${r1.strategy}, ${r2.strategy}`)

for (const [a, b, amt] of [
  ['USDC', 'USDT', 1_000],
  ['USDC', 'EURC', 5_000],
  ['PYUSD', 'USDe', 2_500],
  ['BRZ', 'USDG', 40_000],
  ['USDT', 'PYUSD', 30_000],
] as const) {
  market = await client.market()
  const tin = sym(a)
  const tout = sym(b)
  const amount = BigInt(amt) * 10n ** BigInt(tin.decimals)
  const quote = client.quoteExactIn(market, tin.address, tout.address, amount)
  const outBefore = (await client.balancesOf(trader.publicKey))[client.tokens.indexOf(tout)]!
  const done = await client.swap(signerOf(trader), quote, 0)
  const outAfter = (await client.balancesOf(trader.publicKey))[client.tokens.indexOf(tout)]!
  check(
    `swap ${amt} ${a} -> ${b} over ${quote.legs.length} leg(s) pays exactly the quote`,
    done.amountOut === quote.amountOut && outAfter - outBefore === quote.amountOut,
    `quote ${quote.amountOut} got ${done.amountOut}, ${await cu(done.hash)} CU`,
  )
}

const lp1After = await client.balancesOf(lp1.publicKey)
check('maker wallet balances changed by swaps, coins never left before fills', lp1After.some((b, k) => b !== before[k]))

const usde = sym('USDe')
const usdeIndex = client.tokens.indexOf(usde)
await sendAndConfirmTransaction(
  conn,
  new Transaction().add(ix.report(program, admin.publicKey, now + 1, [{ index: usdeIndex, priceE9: 930_000_000n, halted: true }])),
  [admin],
)
market = await client.market()
check('USDe halted by the reporter', market.prices.get(usde.address.toLowerCase())?.halted === true)
const dump = 1_000n * 10n ** 9n
const bq = client.quoteExactIn(market, usde.address, sym('USDC').address, dump)
check('halted coin routes to the backstop', bq.legs.length === 1 && bq.strategies[0]!.kind === 'backstop')
const bdone = await client.swap(signerOf(trader), bq, 0)
check('backstop buys USDe below market and pays the quote', bdone.amountOut === bq.amountOut && bq.amountOut < 930n * 10n ** 6n, `${bq.amountOut} for 1000 USDe, ${await cu(bdone.hash)} CU`)

const rangeOnly = { ...market, prices: new Map([...market.prices].map(([k, v]) => [k, k === usde.address.toLowerCase() ? { ...v, halted: false } : v])) }
const forced = client.quoteExactIn(rangeOnly, usde.address, sym('USDC').address, 10n ** 9n)
await expectFail('ranges refuse a halted coin onchain', () => client.swap(signerOf(trader), forced, 0), 'Halted')

await sendAndConfirmTransaction(conn, new Transaction().add(ix.guardian(program, admin.publicKey, usdeIndex, false)), [admin])
market = await client.market()
check('guardian resume lifts the halt', market.prices.get(usde.address.toLowerCase())?.halted === false)

const q = client.quoteExactIn(market, sym('USDC').address, sym('USDT').address, 100n * 10n ** 6n)
const tooGreedy = { ...q, legs: q.legs.map((l) => ({ ...l, amountOut: l.amountOut + 1000n })) }
await expectFail('slippage guard refuses a worse fill', () => client.swap(signerOf(trader), tooGreedy, 0), 'Slippage')

const mine = market.ranges.find((r) => r.maker === (lp1.publicKey.toBase58() as never)) as SolanaRange
const lamportsBefore = await conn.getBalance(lp1.publicKey)
await client.dock(signerOf(lp1), mine)
const lamportsAfter = await conn.getBalance(lp1.publicKey)
check('closing a range refunds its rent', lamportsAfter > lamportsBefore, `${(lamportsAfter - lamportsBefore) / 1e9} SOL back`)
market = await client.market()
check('closed range is gone', !market.ranges.some((r) => r.id === mine.id))

const stranger = await funded()
await expectFail(
  'only the maker can close a strategy',
  () => client.send(signerOf(stranger), [[ix.close(program, stranger.publicKey, (market.ranges[0] as SolanaRange).sol.address)]]),
  'Unauthorized',
)

const events = await client.activity(100)
check('activity log has swaps, opens, closes and reports', ['swap', 'open', 'close', 'report', 'guardian'].every((k) => events.some((e) => e.event.kind === k)))

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
