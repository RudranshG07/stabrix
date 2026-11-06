import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  erc20Abi,
  getAbiItem,
  getAddress,
  maxUint256,
  parseEventLogs,
} from 'viem'
import { aquaAbi, stabrixBatchTakerAbi, stabrixLensAbi, stabrixOracleAbi } from './abi.js'
import { type BackstopConfig, backstopOut } from './backstop.js'
import { type RangeConfig, ZERO_ADDRESS, toRange } from './config.js'
import { type Range, StabrixMathError, WAD, exactIn, rateWithPrice, spotPrice } from './math.js'
import {
  type Order,
  type Venue,
  buildBackstopOrder,
  buildOrder,
  decodeStrategy,
  encodeStrategy,
  parseBackstopProgram,
  parseProgram,
  strategyHash,
} from './order.js'
import { type PresetId, defaultMaxShareBps, designRange, presetById, scaleRange } from './presets.js'
import { type RangeState, type SplitResult, splitExactIn } from './split.js'

export interface TokenInfo {
  address: Address
  symbol: string
  name: string
  decimals: number
  feed: Address
  marketFeed: Address
}

export interface Deployment {
  chainId: number
  fromBlock: bigint
  aqua: Address
  router: Address
  officialRouter: Address
  extruction: Address
  backstop: Address
  batchTaker: Address
  oracle: Address
  lens: Address
  tokens: TokenInfo[]
}

interface Strategy {
  id: string
  hash: Hex
  maker: Address
  app: Address
  venue: Venue
  order: Order
  salt: bigint
  blockNumber: bigint
  balances: bigint[]
  spendable: bigint[]
}

export interface LiveRange extends Strategy {
  kind: 'range'
  config: RangeConfig
  range: Range
  rates: bigint[]
  fx: boolean[]
  tradable: boolean
}

export interface LiveBackstop extends Strategy {
  kind: 'backstop'
  config: BackstopConfig
}

export interface PriceInfo {
  priceE18: bigint | null
  fx: boolean
  halted: boolean
  depegE18: bigint | null
}

export interface Market {
  block: bigint
  ranges: LiveRange[]
  backstops: LiveBackstop[]
  prices: Map<string, PriceInfo>
}

export interface Quote extends SplitResult {
  tokenIn: Address
  tokenOut: Address
  strategies: (LiveRange | LiveBackstop)[]
}

export interface OracleStatus {
  token: Address
  halted: boolean
  creHalted: boolean
  guardianHalted: boolean
  observedAt: bigint
  reportedE18: bigint
}

export interface ClientOptions {
  logChunk?: bigint
}

type Wallet = WalletClient<Transport, Chain, Account>
type ShipEvent = { eventName: 'Shipped'; args: { maker: Address; app: Address; strategyHash: Hex; strategy: Hex }; blockNumber: bigint }
type DockEvent = { eventName: 'Docked'; args: { maker: Address; app: Address; strategyHash: Hex }; blockNumber: bigint }

const key = (...parts: string[]) => parts.map((p) => p.toLowerCase()).join(':')
const SHIPPED = getAbiItem({ abi: aquaAbi, name: 'Shipped' })
const DOCKED = getAbiItem({ abi: aquaAbi, name: 'Docked' })

export class StabrixClient {
  private events: (ShipEvent | DockEvent)[] = []
  private seen = new Set<string>()
  private scanning: Promise<bigint> | null = null
  private scannedTo: bigint
  private readonly logChunk: bigint

  constructor(
    readonly publicClient: PublicClient,
    readonly deployment: Deployment,
    options: ClientOptions = {},
  ) {
    this.scannedTo = deployment.fromBlock - 1n
    this.logChunk = options.logChunk ?? 5_000n
  }

  get tokens() {
    return this.deployment.tokens
  }

  token(address: Address) {
    const t = this.deployment.tokens.find((x) => x.address.toLowerCase() === address.toLowerCase())
    if (!t) throw new Error(`unknown token ${address}`)
    return t
  }

  appFor(venue: Venue): Address {
    return venue.kind === 'native' ? this.deployment.router : this.deployment.officialRouter
  }

  private scan(): Promise<bigint> {
    this.scanning ??= this.scanOnce().finally(() => {
      this.scanning = null
    })
    return this.scanning
  }

  private async scanOnce(): Promise<bigint> {
    const latest = await this.publicClient.getBlockNumber()
    while (this.scannedTo < latest) {
      const from = this.scannedTo + 1n
      const to = from + this.logChunk - 1n < latest ? from + this.logChunk - 1n : latest
      const logs = await this.publicClient.getLogs({
        address: this.deployment.aqua,
        events: [SHIPPED, DOCKED],
        fromBlock: from,
        toBlock: to,
      })
      const parsed = parseEventLogs({ abi: aquaAbi, logs, eventName: ['Shipped', 'Docked'] })
      for (const ev of parsed) {
        const id = `${ev.transactionHash}:${ev.logIndex}`
        if (this.seen.has(id)) continue
        this.seen.add(id)
        this.events.push(ev as unknown as ShipEvent | DockEvent)
      }
      this.scannedTo = to
    }
    return latest
  }

  async market(includeDocked = false): Promise<Market> {
    const block = await this.scan()
    const { router, officialRouter, extruction, backstop } = this.deployment
    const apps = new Set([router.toLowerCase(), officialRouter.toLowerCase()])
    const docked = new Set<string>()
    for (const ev of this.events) {
      if (ev.eventName === 'Docked') docked.add(key(ev.args.maker, ev.args.app, ev.args.strategyHash))
    }

    const ranges: LiveRange[] = []
    const backstops: LiveBackstop[] = []
    for (const ev of this.events) {
      if (ev.eventName !== 'Shipped' || !apps.has(ev.args.app.toLowerCase())) continue
      if (!includeDocked && docked.has(key(ev.args.maker, ev.args.app, ev.args.strategyHash))) continue
      const order = decodeStrategy(ev.args.strategy)
      const base = {
        id: `${getAddress(ev.args.app)}:${ev.args.strategyHash}`,
        hash: ev.args.strategyHash,
        maker: getAddress(ev.args.maker),
        app: getAddress(ev.args.app),
        order,
        blockNumber: ev.blockNumber,
        balances: [] as bigint[],
        spendable: [] as bigint[],
      }
      const range = parseProgram(order.data)
      if (range && (range.venue.kind === 'native' || range.venue.extruction.toLowerCase() === extruction.toLowerCase())) {
        ranges.push({
          ...base,
          kind: 'range',
          venue: range.venue,
          salt: range.salt,
          config: range.config,
          range: toRange(range.config),
          rates: [],
          fx: [],
          tradable: false,
        })
        continue
      }
      const bs = parseBackstopProgram(order.data)
      if (bs && (bs.venue.kind === 'native' || bs.venue.extruction.toLowerCase() === backstop.toLowerCase())) {
        backstops.push({ ...base, kind: 'backstop', venue: bs.venue, salt: bs.salt, config: bs.config })
      }
    }

    const [prices] = await Promise.all([this.prices(), this.refreshBalances([...ranges, ...backstops])])
    for (const r of ranges) {
      const infos = r.config.tokens.map((t) => prices.get(t.toLowerCase()))
      r.fx = infos.map((p) => p?.fx ?? false)
      r.tradable = r.balances.length > 0 && infos.every((p) => p?.priceE18 != null)
      r.rates = r.config.decimals.map((d, k) => rateWithPrice(d, infos[k]?.priceE18 ?? WAD))
    }
    const live = <T extends Strategy>(xs: T[]) => (includeDocked ? xs : xs.filter((x) => x.balances.length > 0))
    return { block, ranges: live(ranges), backstops: live(backstops), prices }
  }

  async listRanges(includeDocked = false): Promise<LiveRange[]> {
    return (await this.market(includeDocked)).ranges
  }

  async prices(): Promise<Map<string, PriceInfo>> {
    const tokens = this.deployment.tokens.map((t) => t.address)
    const oracle = this.deployment.oracle
    const results = await this.publicClient.multicall({
      contracts: tokens.flatMap((t) => [
        { address: oracle, abi: stabrixOracleAbi, functionName: 'priceOf', args: [t] } as const,
        { address: oracle, abi: stabrixOracleAbi, functionName: 'isHalted', args: [t] } as const,
        { address: oracle, abi: stabrixOracleAbi, functionName: 'feeds', args: [t] } as const,
      ]),
      allowFailure: true,
    })
    const depegCalls: Address[] = []
    const out = new Map<string, PriceInfo>()
    tokens.forEach((t, k) => {
      const price = results[3 * k]!
      const status = results[3 * k + 1]!
      const feed = results[3 * k + 2]!
      const halted = status.status === 'success' ? (status.result as boolean) : false
      const fx = feed.status === 'success' && BigInt((feed.result as readonly [Address, number, number])[0]) !== 0n
      const priceE18 = price.status === 'success' ? (price.result as readonly [bigint, boolean, boolean])[0] : null
      out.set(t.toLowerCase(), { priceE18, fx, halted, depegE18: null })
      if (halted) depegCalls.push(t)
    })
    if (depegCalls.length > 0) {
      const depeg = await this.publicClient.multicall({
        contracts: depegCalls.map((t) => ({ address: oracle, abi: stabrixOracleAbi, functionName: 'depegPrice', args: [t] }) as const),
        allowFailure: true,
      })
      depegCalls.forEach((t, k) => {
        const r = depeg[k]!
        if (r.status === 'success') out.get(t.toLowerCase())!.depegE18 = r.result as bigint
      })
    }
    return out
  }

  async refreshBalances(strategies: (LiveRange | LiveBackstop)[]): Promise<void> {
    if (strategies.length === 0) return
    const calls = strategies.flatMap((r) =>
      r.config.tokens.map(
        (t) =>
          ({
            address: this.deployment.aqua,
            abi: aquaAbi,
            functionName: 'rawBalances',
            args: [r.maker, r.app, r.hash, t],
          }) as const,
      ),
    )
    const makers = [...new Set(strategies.map((r) => r.maker))]
    const allTokens = this.deployment.tokens.map((t) => t.address)
    const [balances, spendable] = await Promise.all([
      this.publicClient.multicall({ contracts: calls, allowFailure: false }),
      this.publicClient.multicall({
        contracts: makers.map((m) => ({
          address: this.deployment.lens,
          abi: stabrixLensAbi,
          functionName: 'spendable',
          args: [m, allTokens],
        })) as never,
        allowFailure: false,
      }),
    ])
    const wallet = new Map<string, bigint>()
    makers.forEach((m, k) => {
      const amounts = spendable[k] as unknown as readonly bigint[]
      allTokens.forEach((t, x) => wallet.set(key(m, t), amounts[x]!))
    })
    let k = 0
    for (const r of strategies) {
      const n = r.config.tokens.length
      const slice = balances.slice(k, k + n) as readonly (readonly [bigint, number])[]
      k += n
      r.balances = slice.every(([, count]) => count === n) ? slice.map(([b]) => b) : []
      r.spendable = r.config.tokens.map((t) => wallet.get(key(r.maker, t)) ?? 0n)
    }
  }

  stateOf(r: LiveRange): RangeState {
    const index = new Map(r.config.tokens.map((t, k) => [t.toLowerCase(), k]))
    return {
      id: r.id,
      real: r.balances,
      rates: r.rates,
      range: r.range,
      indexOf: (token) => index.get(token.toLowerCase()) ?? -1,
      quote: (i, j, amountIn) => {
        const feeBps = r.fx[i] || r.fx[j] ? r.config.fxFeeBps : r.config.feeBps
        const out = exactIn(r.balances, r.rates, { ...r.range, feeBps }, i, j, amountIn)
        if (out > r.spendable[j]!) throw new StabrixMathError('InsufficientReserve')
        return out
      },
    }
  }

  backstopStateOf(b: LiveBackstop, prices: Map<string, PriceInfo>): RangeState {
    const index = new Map(b.config.tokens.map((t, k) => [t.toLowerCase(), k]))
    return {
      id: b.id,
      real: b.balances,
      rates: [],
      range: { floor: 0n, sumCapRatio: 0n, feeBps: 0, maxShareBps: 10_000 },
      indexOf: (token) => index.get(token.toLowerCase()) ?? -1,
      quote: (i, j, amountIn) => {
        const pin = prices.get(b.config.tokens[i]!.toLowerCase())
        const pout = prices.get(b.config.tokens[j]!.toLowerCase())
        if (!pin?.halted || pin.depegE18 == null || pin.priceE18 == null) throw new StabrixMathError('OutOfRange')
        if (!pout || pout.halted || pout.priceE18 == null) throw new StabrixMathError('OutOfRange')
        const out = backstopOut({
          amountIn,
          absorbedIn: b.balances[i]!,
          faceIn: pin.priceE18,
          marketIn: pin.depegE18,
          priceOut: pout.priceE18,
          decimalsIn: b.config.decimals[i]!,
          decimalsOut: b.config.decimals[j]!,
          startBps: b.config.startDiscountBps,
          endBps: b.config.endDiscountBps,
          cap: b.config.capPerToken,
        })
        if (out > b.balances[j]! || out > b.spendable[j]!) throw new StabrixMathError('InsufficientReserve')
        return out
      },
    }
  }

  quoteExactIn(market: Market, tokenIn: Address, tokenOut: Address, amountIn: bigint): Quote {
    const info = market.prices.get(tokenIn.toLowerCase())
    const strategies: (LiveRange | LiveBackstop)[] = info?.halted
      ? market.backstops.filter((b) => b.balances.length > 0)
      : market.ranges.filter((r) => r.tradable)
    const states = strategies.map((s) => (s.kind === 'range' ? this.stateOf(s) : this.backstopStateOf(s, market.prices)))
    const split = splitExactIn(states, tokenIn, tokenOut, amountIn)
    return { ...split, tokenIn, tokenOut, strategies }
  }

  midPrice(market: Market, tokenIn: Address, tokenOut: Address): bigint | null {
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

  toLegs(quote: Quote) {
    return quote.legs.map((leg) => {
      const s = quote.strategies.find((x) => x.id === leg.id)
      if (!s) throw new Error(`leg ${leg.id} has no strategy`)
      return { router: s.app, order: s.order, amountIn: leg.amountIn }
    })
  }

  async simulateQuote(quote: Quote, account: Address): Promise<bigint> {
    const { result } = await this.publicClient.simulateContract({
      account,
      address: this.deployment.batchTaker,
      abi: stabrixBatchTakerAbi,
      functionName: 'swapExactIn',
      args: [quote.tokenIn, quote.tokenOut, this.toLegs(quote), 0n, account, Math.floor(Date.now() / 1000) + 600],
    })
    return result
  }

  async ensureAllowance(wallet: Wallet, token: Address, spender: Address, amount: bigint): Promise<Hex | null> {
    const owner = wallet.account.address
    const current = await this.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [owner, spender],
    })
    if (current >= amount) return null
    const hash = await wallet.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, maxUint256],
    })
    await this.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  async swap(wallet: Wallet, quote: Quote, slippageBps: number, deadlineSeconds = 600) {
    await this.ensureAllowance(wallet, quote.tokenIn, this.deployment.batchTaker, quote.filled)
    const minOut = (quote.amountOut * BigInt(10_000 - slippageBps)) / 10_000n
    const block = await this.publicClient.getBlock()
    const now = Math.max(Number(block.timestamp), Math.floor(Date.now() / 1000))
    const hash = await wallet.writeContract({
      address: this.deployment.batchTaker,
      abi: stabrixBatchTakerAbi,
      functionName: 'swapExactIn',
      args: [quote.tokenIn, quote.tokenOut, this.toLegs(quote), minOut, wallet.account.address, now + deadlineSeconds],
    })
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`swap reverted in ${hash}`)
    const [ev] = parseEventLogs({ abi: stabrixBatchTakerAbi, logs: receipt.logs, eventName: 'BatchSwapped' })
    return { hash, receipt, amountOut: ev?.args.amountOut ?? 0n }
  }

  sortedTokens(only?: readonly Address[]) {
    const keep = only ? new Set(only.map((a) => a.toLowerCase())) : null
    return this.deployment.tokens
      .filter((t) => !keep || keep.has(t.address.toLowerCase()))
      .sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1))
  }

  buildRange(
    preset: PresetId,
    depositPerCoinUsd: bigint,
    opts: { maxShareBps?: number; oracle?: Address; tokens?: readonly Address[] } = {},
  ): RangeConfig {
    const tokens = this.sortedTokens(opts.tokens)
    if (tokens.length < 2) throw new Error('a range needs at least two coins')
    const maxShareBps = opts.maxShareBps ?? defaultMaxShareBps(tokens.length)
    const oracle = opts.oracle ?? this.deployment.oracle
    const p = presetById(preset)
    const scaled = scaleRange(designRange(tokens.length, p, maxShareBps), depositPerCoinUsd)
    return {
      tokens: tokens.map((t) => t.address),
      decimals: tokens.map((t) => t.decimals),
      floor: scaled.floor,
      sumCapRatio: scaled.sumCapRatio,
      feeBps: scaled.feeBps,
      fxFeeBps: p.fxFeeBps,
      maxShareBps: scaled.maxShareBps,
      oracle: oracle ?? ZERO_ADDRESS,
    }
  }

  buildBackstop(startDiscountBps: number, endDiscountBps: number, capPerTokenUsd: bigint, only?: readonly Address[]): BackstopConfig {
    const tokens = this.sortedTokens(only)
    if (tokens.length < 2) throw new Error('a backstop needs at least two coins')
    return {
      tokens: tokens.map((t) => t.address),
      decimals: tokens.map((t) => t.decimals),
      startDiscountBps,
      endDiscountBps,
      capPerToken: capPerTokenUsd,
      oracle: this.deployment.oracle,
    }
  }

  async depositAmounts(config: RangeConfig, depositPerCoinUsd: bigint): Promise<bigint[]> {
    const prices = await this.prices()
    return config.tokens.map((t, k) => {
      const p = prices.get(t.toLowerCase())?.priceE18
      if (p == null) throw new Error(`no fresh price for ${this.token(t).symbol}`)
      return (depositPerCoinUsd * 10n ** BigInt(config.decimals[k]!)) / p
    })
  }

  async isShipped(maker: Address, order: Order, app: Address, token: Address): Promise<boolean> {
    const [, count] = await this.publicClient.readContract({
      address: this.deployment.aqua,
      abi: aquaAbi,
      functionName: 'rawBalances',
      args: [maker, app, strategyHash(order), token],
    })
    return count > 0
  }

  private async shipOrder(wallet: Wallet, order: Order, app: Address, tokens: Address[], amounts: bigint[]) {
    for (let k = 0; k < tokens.length; k++) {
      if (amounts[k]! > 0n) await this.ensureAllowance(wallet, tokens[k]!, this.deployment.aqua, amounts[k]!)
    }
    const hash = await wallet.writeContract({
      address: this.deployment.aqua,
      abi: aquaAbi,
      functionName: 'ship',
      args: [app, encodeStrategy(order), tokens, amounts],
    })
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`ship reverted in ${hash}`)
    return { hash, receipt, order, strategyHash: strategyHash(order), amounts }
  }

  async ship(wallet: Wallet, config: RangeConfig, depositPerCoinUsd: bigint, venue: Venue, salt?: bigint) {
    const order = buildOrder(wallet.account.address, config, venue, salt ?? BigInt(Date.now()))
    const amounts = await this.depositAmounts(config, depositPerCoinUsd)
    return this.shipOrder(wallet, order, this.appFor(venue), config.tokens, amounts)
  }

  async shipBackstop(wallet: Wallet, config: BackstopConfig, pledges: bigint[], venue: Venue, salt?: bigint) {
    if (pledges.length !== config.tokens.length) throw new Error('one pledge per token')
    const order = buildBackstopOrder(wallet.account.address, config, venue, salt ?? BigInt(Date.now()))
    return this.shipOrder(wallet, order, this.appFor(venue), config.tokens, pledges)
  }

  async dock(wallet: Wallet, s: LiveRange | LiveBackstop) {
    const hash = await wallet.writeContract({
      address: this.deployment.aqua,
      abi: aquaAbi,
      functionName: 'dock',
      args: [s.app, s.hash, s.config.tokens],
    })
    return this.publicClient.waitForTransactionReceipt({ hash })
  }

  async oracleStatus(): Promise<OracleStatus[]> {
    const tokens = this.deployment.tokens.map((t) => t.address)
    const oracle = this.deployment.oracle
    const results = await this.publicClient.multicall({
      contracts: tokens.flatMap((t) => [
        { address: oracle, abi: stabrixOracleAbi, functionName: 'status', args: [t] } as const,
        { address: oracle, abi: stabrixOracleAbi, functionName: 'guardianHalted', args: [t] } as const,
      ]),
      allowFailure: false,
    })
    return tokens.map((token, k) => {
      const [creHalted, observedAt, reportedE18] = results[2 * k] as unknown as readonly [boolean, bigint, bigint]
      const guardianHalted = results[2 * k + 1] as unknown as boolean
      return {
        token,
        halted: creHalted || guardianHalted,
        creHalted,
        guardianHalted,
        observedAt: BigInt(observedAt),
        reportedE18: BigInt(reportedE18),
      }
    })
  }

  async balancesOf(owner: Address): Promise<bigint[]> {
    return this.publicClient.multicall({
      contracts: this.deployment.tokens.map((t) => ({
        address: t.address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [owner],
      })),
      allowFailure: false,
    }) as Promise<bigint[]>
  }
}
