import { ORACLE_LEN, type SolanaDeployment, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, decodeOracle, ix, pda } from '@stabrix/sdk/solana'
import { createInitializeMint2Instruction, getMintLen } from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import {
  CLUSTERS,
  COINS,
  MAX_DEVIATION_BPS,
  reportMaxAge,
  cluster,
  connect,
  lamportsLeft,
  loadKeypair,
  programKeypair,
  readDeployment,
  writeDeployment,
} from './common.js'

const c = cluster()
const conn = connect(c)
const admin = loadKeypair()
const program = programKeypair().publicKey
const reporter = process.env.REPORTER ? new PublicKey(process.env.REPORTER) : admin.publicKey
const mock = c !== 'mainnet'
const before = await lamportsLeft(conn, admin)

console.log(`cluster ${c}, program ${program.toBase58()}, admin ${admin.publicKey.toBase58()}, ${before} SOL`)
if (!(await conn.getAccountInfo(program))?.executable) throw new Error('program is not deployed on this cluster yet')

const existing = readDeployment(c)
const mints = new Map<string, PublicKey>()
for (const coin of COINS) {
  const known = existing?.tokens.find((t) => t.symbol === coin.symbol)
  if (!mock) {
    mints.set(coin.symbol, new PublicKey(coin.mainnetMint))
  } else if (known && (await conn.getAccountInfo(new PublicKey(known.address)))) {
    mints.set(coin.symbol, new PublicKey(known.address))
  } else {
    const mint = Keypair.generate()
    const tokenProgram = coin.token2022 ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM
    const space = getMintLen([])
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: await conn.getMinimumBalanceForRentExemption(space),
        space,
        programId: tokenProgram,
      }),
      createInitializeMint2Instruction(mint.publicKey, coin.decimals, pda.faucet(program), null, tokenProgram),
    )
    await sendAndConfirmTransaction(conn, tx, [admin, mint])
    console.log(`mock ${coin.symbol} ${mint.publicKey.toBase58()}`)
    mints.set(coin.symbol, mint.publicKey)
  }
}

const oracle = pda.oracle(program)
const maxAge = reportMaxAge(c)
const current = await conn.getAccountInfo(oracle)
if (!current) {
  const rent = await conn.getMinimumBalanceForRentExemption(ORACLE_LEN)
  await sendAndConfirmTransaction(conn, new Transaction().add(ix.initOracle(program, admin.publicKey, reporter, maxAge, MAX_DEVIATION_BPS, rent)), [admin])
  console.log(`oracle ${oracle.toBase58()}`)
} else {
  const s = decodeOracle(current.data)
  if (s.reportMaxAge !== maxAge || !s.reporter.equals(reporter)) {
    await sendAndConfirmTransaction(conn, new Transaction().add(ix.setConfig(program, admin.publicKey, admin.publicKey, reporter, maxAge, MAX_DEVIATION_BPS)), [admin])
    console.log(`oracle config updated: reporter ${reporter.toBase58()}, report max age ${maxAge}s`)
  }
}

const tx = new Transaction()
for (const coin of COINS) {
  tx.add(
    ix.setCoin(program, admin.publicKey, mints.get(coin.symbol)!, { fx: coin.fx }),
  )
}
await sendAndConfirmTransaction(conn, tx, [admin])

const state = decodeOracle((await conn.getAccountInfo(oracle))!.data)
const deployment: SolanaDeployment = {
  kind: 'solana',
  cluster: CLUSTERS[c].name,
  chainId: CLUSTERS[c].chainId,
  programId: program.toBase58(),
  oracle: oracle.toBase58(),
  faucet: mock,
  fromBlock: BigInt(existing?.fromBlock ?? (await conn.getSlot())),
  tokens: COINS.map((coin) => {
    const mint = mints.get(coin.symbol)!
    const e = state.entries.find((x) => x.mint.equals(mint))!
    return {
      address: mint.toBase58() as `0x${string}`,
      symbol: coin.symbol,
      name: coin.name,
      decimals: coin.decimals,
      tokenProgram: e.tokenProgram.toBase58(),
      fx: coin.fx,
      feed: (!mock && coin.refFeed ? coin.refFeed : '') as `0x${string}`,
      marketFeed: (!mock && coin.marketFeed ? coin.marketFeed : '') as `0x${string}`,
    }
  }),
}
writeDeployment(c, deployment)
const after = await lamportsLeft(conn, admin)
console.log(`wrote deployments/${CLUSTERS[c].file}.json, oracle has ${state.entries.length} coins, spent ${(before - after).toFixed(6)} SOL`)
