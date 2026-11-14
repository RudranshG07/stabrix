import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Keypair, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'
import { LOADER_UPGRADEABLE } from '@stabrix/sdk/solana'
import { ROOT } from '../env.js'
import { cluster, connect, lamportsLeft, loadKeypair } from './common.js'

const CHUNK = 950
const HEADER = 37
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]

const c = cluster()
const conn = connect(c)
const payer = loadKeypair()
const so = readFileSync(arg('so') ?? join(ROOT, 'solana', 'target', c === 'mainnet' ? 'stabrix-mainnet.so' : 'stabrix-devnet.so'))
const bufferPath = arg('buffer') ?? join(ROOT, 'solana', `buffer-${c}.json`)
const perSecond = Number(arg('rate') ?? '3')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function retry<T>(f: () => Promise<T>, tries = 8): Promise<T> {
  for (let k = 0; ; k++) {
    try {
      return await f()
    } catch (e) {
      if (k >= tries) throw e
      await sleep(1000 * 2 ** Math.min(k, 4))
    }
  }
}

if (!existsSync(bufferPath)) writeFileSync(bufferPath, JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600 })
const buffer = loadKeypair(bufferPath)
const before = await lamportsLeft(conn, payer)
console.log(`${c}: ${so.length} bytes into buffer ${buffer.publicKey.toBase58()}, payer has ${before} SOL`)

const existing = await retry(() => conn.getAccountInfo(buffer.publicKey))
if (!existing) {
  const space = HEADER + so.length
  const lamports = await retry(() => conn.getMinimumBalanceForRentExemption(space))
  const init = new TransactionInstruction({
    programId: LOADER_UPGRADEABLE,
    keys: [
      { pubkey: buffer.publicKey, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([0, 0, 0, 0]),
  })
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: buffer.publicKey, lamports, space, programId: LOADER_UPGRADEABLE }),
    init,
  )
  await retry(async () => {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.feePayer = payer.publicKey
    tx.sign(payer, buffer)
    const sig = await conn.sendRawTransaction(tx.serialize())
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  })
  console.log(`buffer created, rent ${(lamports / 1e9).toFixed(6)} SOL`)
} else if (existing.data.length !== HEADER + so.length) {
  throw new Error(`buffer ${buffer.publicKey.toBase58()} has the wrong size; close it with solana program close and retry`)
}

function writeIx(offset: number, bytes: Buffer) {
  const data = Buffer.alloc(16 + bytes.length)
  data.writeUInt32LE(1, 0)
  data.writeUInt32LE(offset, 4)
  data.writeBigUInt64LE(BigInt(bytes.length), 8)
  bytes.copy(data, 16)
  return new TransactionInstruction({
    programId: LOADER_UPGRADEABLE,
    keys: [
      { pubkey: buffer.publicKey, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    ],
    data,
  })
}

for (let round = 1; round <= 12; round++) {
  const info = await retry(() => conn.getAccountInfo(buffer.publicKey, 'confirmed'))
  const onchain = info!.data.subarray(HEADER)
  const missing: number[] = []
  for (let o = 0; o < so.length; o += CHUNK) {
    const want = so.subarray(o, o + CHUNK)
    if (!onchain.subarray(o, o + want.length).equals(want)) missing.push(o)
  }
  console.log(`round ${round}: ${missing.length} of ${Math.ceil(so.length / CHUNK)} chunks left`)
  if (missing.length === 0) break
  let { blockhash } = await retry(() => conn.getLatestBlockhash('confirmed'))
  for (const [k, o] of missing.entries()) {
    if (k > 0 && k % 40 === 0) blockhash = (await retry(() => conn.getLatestBlockhash('confirmed'))).blockhash
    const tx = new Transaction().add(writeIx(o, so.subarray(o, o + CHUNK)))
    tx.recentBlockhash = blockhash
    tx.feePayer = payer.publicKey
    tx.sign(payer)
    await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 }).catch(() => {})
    await sleep(1000 / perSecond)
  }
  await sleep(8000)
}

const after = await lamportsLeft(conn, payer)
console.log(`buffer ${buffer.publicKey.toBase58()} ready, spent ${(before - after).toFixed(6)} SOL`)
console.log(`next: solana program deploy -u ${c === 'mainnet' ? 'm' : 'd'} --buffer ${buffer.publicKey.toBase58()} --program-id solana/program-keypair.json --max-len ${so.length}`)
