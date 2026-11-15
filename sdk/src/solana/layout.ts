import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'

export const ORACLE_LEN = 1360
export const STRATEGY_LEN = 408
export const MAX_ENTRIES = 10
export const MAX_COINS = 8
export const RANGE_TAG = 2
export const BACKSTOP_TAG = 3

export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
export const PYTH_RECEIVER = new PublicKey('rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ')
export const LOADER_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')
export const ZERO_KEY = PublicKey.default

const FX = 1
const HALTED = 2
const GUARDIAN = 4

export const ERRORS = [
  'SameToken',
  'ZeroAmount',
  'OffSurface',
  'OutOfRange',
  'InsufficientReserve',
  'RangeEdge',
  'ExposureCap',
  'ValueDecreased',
  'Overflow',
  'BackstopFull',
  'Halted',
  'NotDepegged',
  'PayoutHalted',
  'StaleRate',
  'MissingFeed',
  'InsufficientLiquidity',
  'Slippage',
  'Unauthorized',
  'BadAccount',
  'BadConfig',
  'UnknownCoin',
  'FutureReport',
  'OracleFull',
  'BadTokenProgram',
] as const

export type ProgramErrorName = (typeof ERRORS)[number]

export function programErrorName(code: number): ProgramErrorName | null {
  return ERRORS[code - 6000] ?? null
}

export interface OracleEntry {
  index: number
  mint: PublicKey
  refFeed: PublicKey
  marketFeed: PublicKey
  priceE9: bigint
  observedAt: number
  refMaxAge: number
  marketMaxAge: number
  decimals: number
  fx: boolean
  reportHalted: boolean
  guardianHalted: boolean
  tokenProgram: PublicKey
}

export interface OracleState {
  admin: PublicKey
  reporter: PublicKey
  reportMaxAge: number
  maxDeviationBps: number
  entries: OracleEntry[]
}

export function decodeOracle(d: Uint8Array): OracleState {
  const b = Buffer.from(d)
  if (b.length !== ORACLE_LEN || b[0] !== 1) throw new Error('not a Stabrix oracle account')
  const count = b[2]!
  const entries: OracleEntry[] = []
  for (let k = 0; k < count; k++) {
    const o = 80 + k * 128
    const flags = b[o + 121]!
    entries.push({
      index: k,
      mint: new PublicKey(b.subarray(o, o + 32)),
      refFeed: new PublicKey(b.subarray(o + 32, o + 64)),
      marketFeed: new PublicKey(b.subarray(o + 64, o + 96)),
      priceE9: b.readBigUInt64LE(o + 96),
      observedAt: Number(b.readBigInt64LE(o + 104)),
      refMaxAge: b.readUInt32LE(o + 112),
      marketMaxAge: b.readUInt32LE(o + 116),
      decimals: b[o + 120]!,
      fx: (flags & FX) !== 0,
      reportHalted: (flags & HALTED) !== 0,
      guardianHalted: (flags & GUARDIAN) !== 0,
      tokenProgram: b[o + 122] === 1 ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM,
    })
  }
  return {
    admin: new PublicKey(b.subarray(16, 48)),
    reporter: new PublicKey(b.subarray(48, 80)),
    reportMaxAge: b.readUInt32LE(4),
    maxDeviationBps: b.readUInt16LE(8),
    entries,
  }
}

export interface StrategyAccount {
  address: PublicKey
  kind: 'range' | 'backstop'
  maker: PublicKey
  salt: bigint
  openedAt: number
  mints: PublicKey[]
  decimals: number[]
  balances: bigint[]
  p1: number
  p2: number
  p3: number
  a: bigint
  b: bigint
}

export function decodeStrategy(address: PublicKey, d: Uint8Array): StrategyAccount | null {
  const b = Buffer.from(d)
  if (b.length !== STRATEGY_LEN || (b[0] !== RANGE_TAG && b[0] !== BACKSTOP_TAG)) return null
  const n = b[3]!
  const mints: PublicKey[] = []
  const decimals: number[] = []
  const balances: bigint[] = []
  for (let k = 0; k < n; k++) {
    mints.push(new PublicKey(b.subarray(80 + 32 * k, 112 + 32 * k)))
    balances.push(b.readBigUInt64LE(336 + 8 * k))
    decimals.push(b[400 + k]!)
  }
  return {
    address,
    kind: b[0] === RANGE_TAG ? 'range' : 'backstop',
    maker: new PublicKey(b.subarray(32, 64)),
    salt: b.readBigUInt64LE(16),
    openedAt: Number(b.readBigInt64LE(24)),
    mints,
    decimals,
    balances,
    p1: b.readUInt16LE(4),
    p2: b.readUInt16LE(6),
    p3: b.readUInt16LE(8),
    a: b.readBigUInt64LE(64),
    b: b.readBigUInt64LE(72),
  }
}

export function readPyth(d: Uint8Array | null | undefined, maxAge: number, now: number): bigint | null {
  if (!d || d.length < 101) return null
  const b = Buffer.from(d)
  if (b[40] !== 1) return null
  const price = b.readBigInt64LE(73)
  const expo = b.readInt32LE(89)
  const published = Number(b.readBigInt64LE(93))
  if (price <= 0n || now > published + maxAge) return null
  const shift = 9 + expo
  const p = shift >= 0 ? price * 10n ** BigInt(shift) : price / 10n ** BigInt(-shift)
  return p > 0n ? p : null
}

export const pda = {
  oracle: (program: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('oracle')], program)[0],
  faucet: (program: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('faucet')], program)[0],
  delegate: (program: PublicKey, maker: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from('delegate'), maker.toBuffer()], program)[0],
  strategy: (program: PublicKey, maker: PublicKey, salt: bigint) => {
    const s = Buffer.alloc(8)
    s.writeBigUInt64LE(salt)
    return PublicKey.findProgramAddressSync([Buffer.from('strategy'), maker.toBuffer(), s], program)[0]
  },
  programData: (program: PublicKey) => PublicKey.findProgramAddressSync([program.toBuffer()], LOADER_UPGRADEABLE)[0],
}

const u16 = (v: number) => {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(v)
  return b
}
const u32 = (v: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(v)
  return b
}
const u64 = (v: bigint) => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(v)
  return b
}
const i64 = (v: number) => {
  const b = Buffer.alloc(8)
  b.writeBigInt64LE(BigInt(v))
  return b
}

const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner })

export const ix = {
  initOracle(program: PublicKey, admin: PublicKey, reporter: PublicKey, reportMaxAge: number, maxDeviationBps: number, rentLamports: number) {
    return new TransactionInstruction({
      programId: program,
      keys: [meta(admin, true, true), meta(pda.oracle(program), true), meta(pda.programData(program)), meta(SystemProgram.programId)],
      data: Buffer.concat([Buffer.from([0]), reporter.toBuffer(), u32(reportMaxAge), u16(maxDeviationBps), u64(BigInt(rentLamports))]),
    })
  },

  setCoin(program: PublicKey, admin: PublicKey, mint: PublicKey, c: { fx: boolean }) {
    return new TransactionInstruction({
      programId: program,
      keys: [meta(admin, false, true), meta(pda.oracle(program), true), meta(mint)],
      data: Buffer.from([1, c.fx ? 1 : 0]),
    })
  },

  setConfig(program: PublicKey, admin: PublicKey, newAdmin: PublicKey, reporter: PublicKey, reportMaxAge: number, maxDeviationBps: number) {
    return new TransactionInstruction({
      programId: program,
      keys: [meta(admin, false, true), meta(pda.oracle(program), true)],
      data: Buffer.concat([Buffer.from([2]), newAdmin.toBuffer(), reporter.toBuffer(), u32(reportMaxAge), u16(maxDeviationBps)]),
    })
  },

  report(program: PublicKey, reporter: PublicKey, observedAt: number, rows: { index: number; priceE9: bigint; halted: boolean }[]) {
    return new TransactionInstruction({
      programId: program,
      keys: [meta(reporter, false, true), meta(pda.oracle(program), true)],
      data: Buffer.concat([
        Buffer.from([3]),
        i64(observedAt),
        Buffer.from([rows.length]),
        ...rows.map((r) => Buffer.concat([Buffer.from([r.index]), u64(r.priceE9), Buffer.from([r.halted ? 1 : 0])])),
      ]),
    })
  },

  guardian(program: PublicKey, admin: PublicKey, index: number, halted: boolean) {
    return new TransactionInstruction({
      programId: program,
      keys: [meta(admin, false, true), meta(pda.oracle(program), true)],
      data: Buffer.from([4, index, halted ? 1 : 0]),
    })
  },

  open(
    program: PublicKey,
    maker: PublicKey,
    s: { kind: 'range' | 'backstop'; salt: bigint; mints: PublicKey[]; amounts: bigint[]; p1: number; p2: number; p3: number; a: bigint; b: bigint; rentLamports: number },
  ) {
    const n = s.mints.length
    return new TransactionInstruction({
      programId: program,
      keys: [meta(maker, true, true), meta(pda.strategy(program, maker, s.salt), true), meta(pda.oracle(program)), meta(SystemProgram.programId)],
      data: Buffer.concat([
        Buffer.from([5, s.kind === 'range' ? RANGE_TAG : BACKSTOP_TAG]),
        u64(s.salt),
        Buffer.from([n]),
        u16(s.p1),
        u16(s.p2),
        u16(s.p3),
        u64(s.a),
        u64(s.b),
        ...s.mints.map((m) => m.toBuffer()),
        ...s.amounts.map(u64),
        u64(BigInt(s.rentLamports)),
      ]),
    })
  },

  close(program: PublicKey, maker: PublicKey, strategy: PublicKey) {
    return new TransactionInstruction({
      programId: program,
      keys: [meta(maker, true, true), meta(strategy, true)],
      data: Buffer.from([6]),
    })
  },

  swap(
    program: PublicKey,
    a: {
      taker: PublicKey
      strategy: PublicKey
      maker: PublicKey
      mintIn: PublicKey
      mintOut: PublicKey
      makerIn: PublicKey
      makerOut: PublicKey
      takerIn: PublicKey
      takerOut: PublicKey
      programIn: PublicKey
      programOut: PublicKey
      i: number
      j: number
      amountIn: bigint
      minOut: bigint
    },
  ) {
    return new TransactionInstruction({
      programId: program,
      keys: [
        meta(a.taker, false, true),
        meta(a.strategy, true),
        meta(pda.oracle(program)),
        meta(pda.delegate(program, a.maker)),
        meta(a.mintIn),
        meta(a.mintOut),
        meta(a.makerIn, true),
        meta(a.makerOut, true),
        meta(a.takerIn, true),
        meta(a.takerOut, true),
        meta(a.programIn),
        meta(a.programOut),
      ],
      data: Buffer.concat([Buffer.from([7, a.i, a.j]), u64(a.amountIn), u64(a.minOut)]),
    })
  },

  faucet(program: PublicKey, user: PublicKey, mint: PublicKey, ata: PublicKey, tokenProgram: PublicKey, amount: bigint) {
    return new TransactionInstruction({
      programId: program,
      keys: [meta(user, false, true), meta(mint, true), meta(ata, true), meta(pda.faucet(program)), meta(tokenProgram)],
      data: Buffer.concat([Buffer.from([8]), u64(amount)]),
    })
  },
}

export type ProgramEvent =
  | { kind: 'swap'; strategy: PublicKey; maker: PublicKey; taker: PublicKey; mintIn: PublicKey; mintOut: PublicKey; amountIn: bigint; amountOut: bigint }
  | { kind: 'open'; strategy: PublicKey; maker: PublicKey; strategyKind: 'range' | 'backstop' }
  | { kind: 'close'; strategy: PublicKey; maker: PublicKey }
  | { kind: 'report'; mint: PublicKey; priceE9: bigint; halted: boolean; observedAt: number }
  | { kind: 'guardian'; mint: PublicKey; halted: boolean }

export function parseEvents(program: PublicKey, logs: readonly string[]): ProgramEvent[] {
  const id = program.toBase58()
  const stack: string[] = []
  const out: ProgramEvent[] = []
  for (const line of logs) {
    const invoke = /^Program (\S+) invoke \[\d+\]$/.exec(line)
    if (invoke) {
      stack.push(invoke[1]!)
      continue
    }
    if (/^Program (\S+) (success|failed)/.test(line)) {
      stack.pop()
      continue
    }
    if (stack[stack.length - 1] !== id || !line.startsWith('Program data: ')) continue
    const parts = line.slice('Program data: '.length).split(' ').map((p) => Buffer.from(p, 'base64'))
    const tag = parts[0]?.toString()
    const key = (k: number) => new PublicKey(parts[k]!)
    try {
      if (tag === 'swap' && parts.length === 8) {
        out.push({
          kind: 'swap',
          strategy: key(1),
          maker: key(2),
          taker: key(3),
          mintIn: key(4),
          mintOut: key(5),
          amountIn: parts[6]!.readBigUInt64LE(0),
          amountOut: parts[7]!.readBigUInt64LE(0),
        })
      } else if (tag === 'open' && parts.length === 4) {
        out.push({ kind: 'open', strategy: key(1), maker: key(2), strategyKind: parts[3]![0] === RANGE_TAG ? 'range' : 'backstop' })
      } else if (tag === 'close' && parts.length === 3) {
        out.push({ kind: 'close', strategy: key(1), maker: key(2) })
      } else if (tag === 'report' && parts.length === 5) {
        out.push({
          kind: 'report',
          mint: key(1),
          priceE9: parts[2]!.readBigUInt64LE(0),
          halted: parts[3]![0] === 1,
          observedAt: Number(parts[4]!.readBigInt64LE(0)),
        })
      } else if (tag === 'guardian' && parts.length === 3) {
        out.push({ kind: 'guardian', mint: key(1), halted: parts[2]![0] === 1 })
      }
    } catch {}
  }
  return out
}
