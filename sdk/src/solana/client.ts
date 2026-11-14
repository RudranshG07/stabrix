import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createApproveInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createRevokeInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import {
  type AccountInfo,
  ComputeBudgetProgram,
  type Connection,
  PublicKey,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import type { Address, Hex } from 'viem'
import type { BackstopConfig } from '../backstop.js'
import type { LiveBackstop, LiveRange, Market, OracleStatus, PriceInfo, Quote, TokenInfo } from '../client.js'
import type { RangeConfig } from '../config.js'
import { StabrixMathError, WAD, exactIn, rateWithPrice, spotPrice } from '../math.js'
import type { Order } from '../order.js'
import { type PresetId, defaultMaxShareBps, designRange, presetById, scaleRange } from '../presets.js'
import { type RangeState, splitExactIn } from '../split.js'
import {
  type OracleEntry,
  type OracleState,
  type ProgramEvent,
  STRATEGY_LEN,
  type StrategyAccount,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  ZERO_KEY,
  decodeOracle,
  decodeStrategy,
  ix,
  parseEvents,
  pda,
  programErrorName,
  readPyth,
} from './layout.js'
import { E9, solBackstopOut, solRate } from './math.js'

export interface SolanaTokenInfo extends TokenInfo {
  tokenProgram: string
  fx: boolean
}

export interface SolanaDeployment {
  kind: 'solana'
  cluster: 'mainnet-beta' | 'devnet' | 'localnet'
  chainId: number
  programId: string
  oracle: string
  faucet: boolean
  fromBlock: bigint
  tokens: SolanaTokenInfo[]
}

export interface SolanaSigner {
  publicKey: PublicKey
  signTransactions(txs: VersionedTransaction[]): Promise<VersionedTransaction[]>
}

interface SolExtra {
  sol: { rates: bigint[]; floor: bigint; address: PublicKey; maker: PublicKey }
}

export type SolanaRange = LiveRange & SolExtra
export type SolanaBackstop = LiveBackstop & SolExtra

export interface SolanaActivity {
  signature: string
  slot: number
  time: number | null
  index: number
  event: ProgramEvent
}

const SCALE = 10n ** 9n
const U64_MAX = (1n << 64n) - 1n
const CU_PER_LEG = 160_000
const lower = (k: PublicKey | string) => (typeof k === 'string' ? k : k.toBase58()).toLowerCase()
const asAddress = (k: PublicKey) => k.toBase58() as unknown as Address
const now = () => Math.floor(Date.now() / 1000)

export class SolanaError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message)
    this.name = 'SolanaError'
  }
}

export function explainSolanaError(e: unknown): string {
  const text = e instanceof Error ? `${e.message} ${(e as { logs?: string[] }).logs?.join(' ') ?? ''}` : String(e)
  const hex = /custom program error: 0x([0-9a-f]+)/i.exec(text)
  if (hex) {
    const name = programErrorName(Number.parseInt(hex[1]!, 16))
    if (name) return name
  }
  const custom = /"Custom":(\d+)/.exec(text)
  if (custom) {
    const name = programErrorName(Number(custom[1]))
    if (name) return name
  }
  return e instanceof Error ? e.message : String(e)
}

export class SolanaStabrixClient {
  readonly program: PublicKey
  readonly oracleAddress: PublicKey
  private oracleCache: { at: number; state: OracleState } | null = null

  constructor(
    readonly connection: Connection,
    readonly deployment: SolanaDeployment,
  ) {
    this.program = new PublicKey(deployment.programId)
    this.oracleAddress = new PublicKey(deployment.oracle)
  }

  get tokens() {
    return this.deployment.tokens
  }

  token(address: string) {
    const t = this.deployment.tokens.find((x) => lower(x.address) === lower(address))
    if (!t) throw new Error(`unknown token ${address}`)
    return t
  }

  sortedTokens(only?: readonly string[]) {
    const keep = only ? new Set(only.map(lower)) : null
    return this.deployment.tokens
      .filter((t) => !keep || keep.has(lower(t.address)))
      .sort((a, b) => Buffer.compare(new PublicKey(a.address).toBuffer(), new PublicKey(b.address).toBuffer()))
  }

  private tokenProgram(mint: PublicKey | string) {
    const t = this.token(typeof mint === 'string' ? mint : mint.toBase58())
    return new PublicKey(t.tokenProgram)
  }

  ata(owner: PublicKey, mint: PublicKey) {
    return getAssociatedTokenAddressSync(mint, owner, true, this.tokenProgram(mint), ASSOCIATED_TOKEN_PROGRAM_ID)
  }

  async oracle(): Promise<OracleState> {
    const info = await this.connection.getAccountInfo(this.oracleAddress)
    if (!info) throw new Error('Stabrix oracle not found on this cluster')
    const state = decodeOracle(info.data)
    this.oracleCache = { at: Date.now(), state }
    return state
  }

  private async feedData(state: OracleState): Promise<Map<string, Uint8Array | null>> {
    const keys = new Map<string, PublicKey>()
    for (const e of state.entries) {
      for (const f of [e.refFeed, e.marketFeed]) if (!f.equals(ZERO_KEY)) keys.set(f.toBase58(), f)
    }
    const list = [...keys.values()]
    const infos = list.length ? await this.connection.getMultipleAccountsInfo(list) : []
    return new Map(list.map((k, x) => [k.toBase58(), infos[x]?.data ?? null]))
  }

  private reported(state: OracleState, e: OracleEntry, t: number): bigint | null {
    return e.priceE9 !== 0n && t <= e.observedAt + state.reportMaxAge ? e.priceE9 : null
  }

  private fxPrice(state: OracleState, e: OracleEntry, feeds: Map<string, Uint8Array | null>, t: number): bigint | null {
    if (!e.fx) return E9
    if (e.refFeed.equals(ZERO_KEY)) return this.reported(state, e, t)
    const ref = readPyth(feeds.get(e.refFeed.toBase58()), e.refMaxAge, t)
    if (ref == null) return null
    const p = this.reported(state, e, t)
    if (p == null) return ref
    const diff = p > ref ? p - ref : ref - p
    return diff * 10_000n > ref * BigInt(state.maxDeviationBps) ? ref : p
  }

  private depegPrice(state: OracleState, e: OracleEntry, feeds: Map<string, Uint8Array | null>, t: number): bigint | null {
    let best = this.reported(state, e, t)
    if (!e.marketFeed.equals(ZERO_KEY)) {
      const m = readPyth(feeds.get(e.marketFeed.toBase58()), e.marketMaxAge, t)
      if (m != null && (best == null || m < best)) best = m
    }
    return best
  }

  async pricesE9(): Promise<{ state: OracleState; byMint: Map<string, { entry: OracleEntry; price: bigint | null; depeg: bigint | null; halted: boolean }> }> {
    const state = await this.oracle()
    const feeds = await this.feedData(state)
    const t = now()
    const byMint = new Map<string, { entry: OracleEntry; price: bigint | null; depeg: bigint | null; halted: boolean }>()
    for (const e of state.entries) {
      const halted = e.reportHalted || e.guardianHalted
      byMint.set(lower(e.mint), {
        entry: e,
        price: this.fxPrice(state, e, feeds, t),
        depeg: halted ? this.depegPrice(state, e, feeds, t) : null,
        halted,
      })
    }
    return { state, byMint }
  }

  async prices(): Promise<Map<string, PriceInfo>> {
    const { byMint } = await this.pricesE9()
    return this.toPriceInfo(byMint)
  }

  private toPriceInfo(byMint: Awaited<ReturnType<SolanaStabrixClient['pricesE9']>>['byMint']) {
    const out = new Map<string, PriceInfo>()
    for (const t of this.deployment.tokens) {
      const p = byMint.get(lower(t.address))
      out.set(lower(t.address), {
        priceE18: p?.price != null ? p.price * SCALE : null,
        fx: p?.entry.fx ?? false,
        halted: p?.halted ?? false,
        depegE18: p?.depeg != null ? p.depeg * SCALE : null,
      })
    }
    return out
  }

  async strategies(maker?: PublicKey): Promise<StrategyAccount[]> {
    const filters: ({ dataSize: number } | { memcmp: { offset: number; bytes: string } })[] = [{ dataSize: STRATEGY_LEN }]
    if (maker) filters.push({ memcmp: { offset: 32, bytes: maker.toBase58() } })
    const accounts = await this.connection.getProgramAccounts(this.program, { filters })
    return accounts
      .map((a) => decodeStrategy(a.pubkey, a.account.data))
      .filter((s): s is StrategyAccount => s !== null)
      .sort((a, b) => a.openedAt - b.openedAt)
  }

  private async tokenAccounts(keys: PublicKey[]): Promise<Map<string, AccountInfo<Buffer> | null>> {
    const out = new Map<string, AccountInfo<Buffer> | null>()
    for (let k = 0; k < keys.length; k += 100) {
      const slice = keys.slice(k, k + 100)
      const infos = await this.connection.getMultipleAccountsInfo(slice)
      slice.forEach((key, x) => out.set(key.toBase58(), infos[x] ?? null))
    }
    return out
  }

  private spendableOf(info: AccountInfo<Buffer> | null | undefined, delegate: PublicKey): bigint {
    if (!info || info.data.length < 165) return 0n
    const d = info.data
    if (d[108] !== 1) return 0n
    const amount = d.readBigUInt64LE(64)
    if (d.readUInt32LE(72) !== 1 || !new PublicKey(d.subarray(76, 108)).equals(delegate)) return 0n
    const delegated = d.readBigUInt64LE(121)
    return amount < delegated ? amount : delegated
  }

  private toLive(s: StrategyAccount, spendable: bigint[], prices: Map<string, PriceInfo>): SolanaRange | SolanaBackstop {
    const tokens = s.mints.map(asAddress)
    const id = s.address.toBase58()
    const base = {
      id,
      hash: id as unknown as Hex,
      maker: asAddress(s.maker),
      app: asAddress(this.program),
      venue: { kind: 'native' } as const,
      order: { maker: asAddress(s.maker), traits: 0n, data: '0x' } as Order,
      salt: s.salt,
      blockNumber: BigInt(s.openedAt),
      balances: s.balances,
      spendable,
    }
    const infos = s.mints.map((m) => prices.get(lower(m)))
    const priceE9 = infos.map((p) => (p?.priceE18 != null ? p.priceE18 / SCALE : E9))
    const sol = {
      rates: s.decimals.map((d, k) => solRate(d, priceE9[k]!)),
      floor: s.a,
      address: s.address,
      maker: s.maker,
    }
    if (s.kind === 'backstop') {
      const config: BackstopConfig = {
        tokens,
        decimals: s.decimals,
        startDiscountBps: s.p1,
        endDiscountBps: s.p2,
        capPerToken: s.a * SCALE,
        oracle: asAddress(this.oracleAddress),
      }
      return { ...base, kind: 'backstop', config, sol }
    }
    const config: RangeConfig = {
      tokens,
      decimals: s.decimals,
      floor: s.a * SCALE,
      sumCapRatio: s.b,
      feeBps: s.p1,
      fxFeeBps: s.p2,
      maxShareBps: s.p3,
      oracle: asAddress(this.oracleAddress),
    }
    return {
      ...base,
      kind: 'range',
      config,
      range: { floor: config.floor, sumCapRatio: s.b, feeBps: s.p1, maxShareBps: s.p3 },
      rates: s.decimals.map((d, k) => rateWithPrice(d, infos[k]?.priceE18 ?? WAD)),
      fx: infos.map((p) => p?.fx ?? false),
      tradable: infos.every((p) => p?.priceE18 != null),
      sol,
    }
  }

  async market(): Promise<Market> {
    const [{ byMint }, list, slot] = await Promise.all([this.pricesE9(), this.strategies(), this.connection.getSlot()])
    const prices = this.toPriceInfo(byMint)
    const keys = new Map<string, PublicKey>()
    for (const s of list) for (const m of s.mints) keys.set(this.ata(s.maker, m).toBase58(), this.ata(s.maker, m))
    const accounts = await this.tokenAccounts([...keys.values()])
    const ranges: SolanaRange[] = []
    const backstops: SolanaBackstop[] = []
    for (const s of list) {
      const delegate = pda.delegate(this.program, s.maker)
      const spendable = s.mints.map((m) => this.spendableOf(accounts.get(this.ata(s.maker, m).toBase58()), delegate))
      const live = this.toLive(s, spendable, prices)
      if (live.kind === 'range') ranges.push(live as SolanaRange)
      else backstops.push(live as SolanaBackstop)
    }
    return { block: BigInt(slot), ranges, backstops, prices }
  }

  async listRanges(): Promise<LiveRange[]> {
    return (await this.market()).ranges
  }

  stateOf(r: LiveRange): RangeState {
    const s = r as SolanaRange
    const index = new Map(r.config.tokens.map((t, k) => [lower(t), k]))
    const range = { ...r.range, floor: s.sol.floor }
    return {
      id: r.id,
      real: r.balances,
      rates: r.rates,
      range: r.range,
      indexOf: (token) => index.get(lower(token)) ?? -1,
      quote: (i, j, amountIn) => {
        const feeBps = r.fx[i] || r.fx[j] ? r.config.fxFeeBps : r.config.feeBps
        const out = exactIn(r.balances, s.sol.rates, { ...range, feeBps }, i, j, amountIn)
        if (out > r.spendable[j]!) throw new StabrixMathError('InsufficientReserve')
        return out
      },
      wallet: { owner: r.maker, spendable: (j) => r.spendable[j]! },
    }
  }

  backstopStateOf(b: LiveBackstop, prices: Map<string, PriceInfo>): RangeState {
    const index = new Map(b.config.tokens.map((t, k) => [lower(t), k]))
    return {
      id: b.id,
      real: b.balances,
      rates: [],
      range: { floor: 0n, sumCapRatio: 0n, feeBps: 0, maxShareBps: 10_000 },
      indexOf: (token) => index.get(lower(token)) ?? -1,
      quote: (i, j, amountIn) => {
        const pin = prices.get(lower(b.config.tokens[i]!))
        const pout = prices.get(lower(b.config.tokens[j]!))
        if (!pin?.halted || pin.depegE18 == null || pin.priceE18 == null) throw new StabrixMathError('OutOfRange')
        if (!pout || pout.halted || pout.priceE18 == null) throw new StabrixMathError('OutOfRange')
        const out = solBackstopOut({
          amountIn,
          absorbedIn: b.balances[i]!,
          faceIn: pin.priceE18 / SCALE,
          marketIn: pin.depegE18 / SCALE,
          priceOut: pout.priceE18 / SCALE,
          decimalsIn: b.config.decimals[i]!,
          decimalsOut: b.config.decimals[j]!,
          startBps: b.config.startDiscountBps,
          endBps: b.config.endDiscountBps,
          cap: b.config.capPerToken / SCALE,
        })
        if (out > b.balances[j]! || out > b.spendable[j]!) throw new StabrixMathError('InsufficientReserve')
        return out
      },
      wallet: { owner: b.maker, spendable: (j) => b.spendable[j]! },
    }
  }

  quoteExactIn(market: Market, tokenIn: string, tokenOut: string, amountIn: bigint): Quote {
    const info = market.prices.get(lower(tokenIn))
    const strategies: (LiveRange | LiveBackstop)[] = info?.halted
      ? market.backstops.filter((b) => b.balances.length > 0)
      : market.ranges.filter((r) => r.tradable)
    const states = strategies.map((s) => (s.kind === 'range' ? this.stateOf(s) : this.backstopStateOf(s, market.prices)))
    const split = splitExactIn(states, tokenIn, tokenOut, amountIn)
    return { ...split, tokenIn: tokenIn as Address, tokenOut: tokenOut as Address, strategies }
  }

  midPrice(market: Market, tokenIn: string, tokenOut: string): bigint | null {
    let weighted = 0n
    let weight = 0n
    for (const r of market.ranges) {
      if (!r.tradable) continue
      const s = this.stateOf(r)
      const i = s.indexOf(tokenIn)
      const j = s.indexOf(tokenOut)
      if (i < 0 || j < 0) continue
      const w = r.balances.reduce((a, b, k) => a + (b * r.rates[k]!) / WAD, 0n)
      weighted += spotPrice(r.balances, r.rates, r.range, i, j) * w
      weight += w
    }
    return weight === 0n ? null : weighted / weight
  }

  private feedsFor(state: OracleState, mints: PublicKey[], depegMint?: PublicKey): PublicKey[] {
    const out = new Map<string, PublicKey>()
    for (const m of mints) {
      const e = state.entries.find((x) => x.mint.equals(m))
      if (e?.fx && !e.refFeed.equals(ZERO_KEY)) out.set(e.refFeed.toBase58(), e.refFeed)
    }
    if (depegMint) {
      const e = state.entries.find((x) => x.mint.equals(depegMint))
      if (e && !e.marketFeed.equals(ZERO_KEY)) out.set(e.marketFeed.toBase58(), e.marketFeed)
    }
    return [...out.values()]
  }

  async send(signer: SolanaSigner, groups: TransactionInstruction[][], computeUnits?: number[]): Promise<string[]> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed')
    const txs = groups.map((ixs, k) => {
      const budget = computeUnits?.[k] ? [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits[k]! })] : []
      const msg = new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: blockhash, instructions: [...budget, ...ixs] }).compileToV0Message()
      return new VersionedTransaction(msg)
    })
    const signed = await signer.signTransactions(txs)
    const sigs: string[] = []
    for (const tx of signed) {
      let sig: string
      try {
        sig = await this.connection.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' })
      } catch (e) {
        throw new SolanaError(explainSolanaError(e), null)
      }
      const res = await this.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
      if (res.value.err) throw new SolanaError(`transaction ${sig} failed: ${explainSolanaError(JSON.stringify(res.value.err))}`, null)
      sigs.push(sig)
    }
    return sigs
  }

  async swap(signer: SolanaSigner, quote: Quote, slippageBps: number) {
    const taker = signer.publicKey
    const mintIn = new PublicKey(quote.tokenIn)
    const mintOut = new PublicKey(quote.tokenOut)
    const state = this.oracleCache && Date.now() - this.oracleCache.at < 30_000 ? this.oracleCache.state : await this.oracle()
    const takerIn = this.ata(taker, mintIn)
    const takerOut = this.ata(taker, mintOut)
    const ixs: TransactionInstruction[] = [
      createAssociatedTokenAccountIdempotentInstruction(taker, takerOut, taker, mintOut, this.tokenProgram(mintOut)),
    ]
    for (const leg of quote.legs) {
      const s = quote.strategies.find((x) => x.id === leg.id) as SolanaRange | SolanaBackstop | undefined
      if (!s) throw new Error(`leg ${leg.id} has no strategy`)
      const mints = s.config.tokens.map((t) => new PublicKey(t))
      const i = mints.findIndex((m) => m.equals(mintIn))
      const j = mints.findIndex((m) => m.equals(mintOut))
      const feeds = s.kind === 'range' ? this.feedsFor(state, mints) : this.feedsFor(state, [mintIn, mintOut], mintIn)
      ixs.push(
        ix.swap(this.program, {
          taker,
          strategy: s.sol.address,
          maker: s.sol.maker,
          mintIn,
          mintOut,
          makerIn: this.ata(s.sol.maker, mintIn),
          makerOut: this.ata(s.sol.maker, mintOut),
          takerIn,
          takerOut,
          programIn: this.tokenProgram(mintIn),
          programOut: this.tokenProgram(mintOut),
          feeds,
          i,
          j,
          amountIn: leg.amountIn,
          minOut: (leg.amountOut * BigInt(10_000 - slippageBps)) / 10_000n,
        }),
      )
    }
    const units = Math.min(1_400_000, 40_000 + CU_PER_LEG * quote.legs.length)
    const [hash] = await this.send(signer, [ixs], [units])
    const tx = await this.connection.getTransaction(hash!, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
    const amountOut = parseEvents(this.program, tx?.meta?.logMessages ?? []).reduce(
      (a, e) => (e.kind === 'swap' ? a + e.amountOut : a),
      0n,
    )
    return { hash: hash!, amountOut }
  }

  buildRange(preset: PresetId, depositPerCoinUsd: bigint, opts: { maxShareBps?: number; tokens?: readonly string[] } = {}): RangeConfig {
    const tokens = this.sortedTokens(opts.tokens)
    if (tokens.length < 2) throw new Error('a range needs at least two coins')
    if (tokens.length > 8) throw new Error('a range holds at most 8 coins')
    const maxShareBps = opts.maxShareBps ?? defaultMaxShareBps(tokens.length)
    const p = presetById(preset)
    const scaled = scaleRange(designRange(tokens.length, p, maxShareBps), depositPerCoinUsd)
    return {
      tokens: tokens.map((t) => t.address),
      decimals: tokens.map((t) => t.decimals),
      floor: (scaled.floor / SCALE) * SCALE,
      sumCapRatio: scaled.sumCapRatio,
      feeBps: scaled.feeBps,
      fxFeeBps: p.fxFeeBps,
      maxShareBps: scaled.maxShareBps,
      oracle: asAddress(this.oracleAddress),
    }
  }

  buildBackstop(startDiscountBps: number, endDiscountBps: number, capPerTokenUsd: bigint, only?: readonly string[]): BackstopConfig {
    const tokens = this.sortedTokens(only)
    if (tokens.length < 2) throw new Error('a backstop needs at least two coins')
    if (tokens.length > 8) throw new Error('a backstop holds at most 8 coins')
    return {
      tokens: tokens.map((t) => t.address),
      decimals: tokens.map((t) => t.decimals),
      startDiscountBps,
      endDiscountBps,
      capPerToken: (capPerTokenUsd / SCALE) * SCALE,
      oracle: asAddress(this.oracleAddress),
    }
  }

  async depositAmounts(config: RangeConfig, depositPerCoinUsd: bigint): Promise<bigint[]> {
    const prices = await this.prices()
    return config.tokens.map((t, k) => {
      const p = prices.get(lower(t))?.priceE18
      if (p == null) throw new Error(`no fresh price for ${this.token(t).symbol}`)
      return (depositPerCoinUsd * 10n ** BigInt(config.decimals[k]!)) / p
    })
  }

  private async approvals(owner: PublicKey, mints: PublicKey[]): Promise<TransactionInstruction[]> {
    const delegate = pda.delegate(this.program, owner)
    const atas = mints.map((m) => this.ata(owner, m))
    const infos = await this.tokenAccounts(atas)
    const out: TransactionInstruction[] = []
    mints.forEach((m, k) => {
      const info = infos.get(atas[k]!.toBase58())
      const program = this.tokenProgram(m)
      if (!info) out.push(createAssociatedTokenAccountIdempotentInstruction(owner, atas[k]!, owner, m, program))
      const d = info?.data
      const ok = d && d.readUInt32LE(72) === 1 && new PublicKey(d.subarray(76, 108)).equals(delegate) && d.readBigUInt64LE(121) >= U64_MAX / 2n
      if (!ok) out.push(createApproveInstruction(atas[k]!, delegate, owner, U64_MAX, [], program))
    })
    return out
  }

  private chunk(ixs: TransactionInstruction[], size: number) {
    const groups: TransactionInstruction[][] = []
    for (let k = 0; k < ixs.length; k += size) groups.push(ixs.slice(k, k + size))
    return groups
  }

  private async openStrategy(signer: SolanaSigner, open: Parameters<typeof ix.open>[2]) {
    const prep = await this.approvals(signer.publicKey, open.mints)
    const groups = [...this.chunk(prep, 6), [ix.open(this.program, signer.publicKey, open)]]
    const sigs = await this.send(signer, groups)
    return { hash: sigs[sigs.length - 1]!, strategy: pda.strategy(this.program, signer.publicKey, open.salt).toBase58(), amounts: open.amounts }
  }

  async ship(signer: SolanaSigner, config: RangeConfig, depositPerCoinUsd: bigint, _venue?: unknown, salt?: bigint) {
    const amounts = await this.depositAmounts(config, depositPerCoinUsd)
    return this.openStrategy(signer, {
      kind: 'range',
      salt: salt ?? BigInt(Date.now()),
      mints: config.tokens.map((t) => new PublicKey(t)),
      amounts,
      p1: config.feeBps,
      p2: config.fxFeeBps,
      p3: config.maxShareBps,
      a: config.floor / SCALE,
      b: config.sumCapRatio,
    })
  }

  async shipBackstop(signer: SolanaSigner, config: BackstopConfig, pledges: bigint[], _venue?: unknown, salt?: bigint) {
    if (pledges.length !== config.tokens.length) throw new Error('one pledge per token')
    return this.openStrategy(signer, {
      kind: 'backstop',
      salt: salt ?? BigInt(Date.now()),
      mints: config.tokens.map((t) => new PublicKey(t)),
      amounts: pledges,
      p1: config.startDiscountBps,
      p2: config.endDiscountBps,
      p3: 0,
      a: config.capPerToken / SCALE,
      b: 0n,
    })
  }

  async dock(signer: SolanaSigner, s: LiveRange | LiveBackstop) {
    const owner = signer.publicKey
    const address = new PublicKey(s.id)
    const others = (await this.strategies(owner)).filter((x) => !x.address.equals(address))
    const stillUsed = new Set(others.flatMap((x) => x.mints.map((m) => m.toBase58())))
    const ixs: TransactionInstruction[] = [ix.close(this.program, owner, address)]
    const delegate = pda.delegate(this.program, owner)
    const mints = s.config.tokens.map((t) => new PublicKey(t)).filter((m) => !stillUsed.has(m.toBase58()))
    const infos = await this.tokenAccounts(mints.map((m) => this.ata(owner, m)))
    for (const m of mints) {
      const d = infos.get(this.ata(owner, m).toBase58())?.data
      if (d && d.readUInt32LE(72) === 1 && new PublicKey(d.subarray(76, 108)).equals(delegate)) {
        ixs.push(createRevokeInstruction(this.ata(owner, m), owner, [], this.tokenProgram(m)))
      }
    }
    const [hash] = await this.send(signer, [ixs])
    return { hash: hash! }
  }

  async oracleStatus(): Promise<OracleStatus[]> {
    const state = await this.oracle()
    return this.deployment.tokens.map((t) => {
      const e = state.entries.find((x) => lower(x.mint) === lower(t.address))
      return {
        token: t.address,
        halted: !!e && (e.reportHalted || e.guardianHalted),
        creHalted: e?.reportHalted ?? false,
        guardianHalted: e?.guardianHalted ?? false,
        observedAt: BigInt(e?.observedAt ?? 0),
        reportedE18: (e?.priceE9 ?? 0n) * SCALE,
      }
    })
  }

  async balancesOf(owner: string | PublicKey): Promise<bigint[]> {
    const key = typeof owner === 'string' ? new PublicKey(owner) : owner
    const atas = this.deployment.tokens.map((t) => this.ata(key, new PublicKey(t.address)))
    const infos = await this.tokenAccounts(atas)
    return atas.map((a) => {
      const d = infos.get(a.toBase58())?.data
      return d && d.length >= 72 ? d.readBigUInt64LE(64) : 0n
    })
  }

  async solBalance(owner: string | PublicKey): Promise<number> {
    const key = typeof owner === 'string' ? new PublicKey(owner) : owner
    return this.connection.getBalance(key)
  }

  async faucet(signer: SolanaSigner, usdPerCoin = 10_000) {
    if (!this.deployment.faucet) throw new Error('test coins only exist on devnet and localnet')
    const owner = signer.publicKey
    const prices = await this.prices()
    const ixs = this.deployment.tokens.flatMap((t) => {
      const mint = new PublicKey(t.address)
      const program = this.tokenProgram(mint)
      const ata = this.ata(owner, mint)
      const p = prices.get(lower(t.address))?.priceE18 ?? WAD
      const amount = (BigInt(usdPerCoin) * WAD * 10n ** BigInt(t.decimals)) / p
      return [createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, mint, program), ix.faucet(this.program, owner, mint, ata, program, amount)]
    })
    const sigs = await this.send(signer, this.chunk(ixs, 8))
    return { hash: sigs[sigs.length - 1]! }
  }

  private logCache = new Map<string, readonly string[]>()

  async activity(limit = 60): Promise<SolanaActivity[]> {
    const sigs = await this.connection.getSignaturesForAddress(this.program, { limit }, 'confirmed')
    const ok = sigs.filter((s) => !s.err)
    const missing = ok.map((s) => s.signature).filter((sig) => !this.logCache.has(sig))
    for (let k = 0; k < missing.length; k += 4) {
      const slice = missing.slice(k, k + 4)
      const txs = await Promise.all(
        slice.map((sig) =>
          this.connection.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null),
        ),
      )
      txs.forEach((tx, x) => {
        if (tx?.meta) this.logCache.set(slice[x]!, tx.meta.logMessages ?? [])
      })
    }
    const out: SolanaActivity[] = []
    for (const s of ok) {
      const logs = this.logCache.get(s.signature)
      if (!logs) continue
      parseEvents(this.program, logs).forEach((event, index) => {
        out.push({ signature: s.signature, slot: s.slot, time: s.blockTime ?? null, index, event })
      })
    }
    return out
  }
}

export const isSolanaToken2022 = (t: SolanaTokenInfo) => t.tokenProgram === TOKEN_2022_PROGRAM.toBase58()
export { TOKEN_PROGRAM }
