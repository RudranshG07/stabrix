import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  erc20Abi,
  getAddress,
  maxUint256,
  parseEventLogs,
} from 'viem'
import { aquaAbi, stabrixBatchTakerAbi, stabrixOracleAbi, stabrixRouterAbi } from './abi.js'
import { type RangeConfig, ZERO_ADDRESS, ratesOf, toRange } from './config.js'
import { type Range, rateFromDecimals, spotPrice } from './math.js'
import { type Order, type Venue, buildOrder, decodeStrategy, encodeStrategy, parseProgram, strategyHash } from './order.js'
import { type PresetId, designRange, presetById, scaleRange } from './presets.js'
import { type RangeState, type SplitResult, splitExactIn } from './split.js'

export interface TokenInfo {
  address: Address
  symbol: string
  name: string
  decimals: number
  feed: Address
}

export interface Deployment {
  chainId: number
  fromBlock: bigint
  aqua: Address
  router: Address
  officialRouter: Address
  extruction: Address
  batchTaker: Address
  oracle: Address
  lens: Address
  tokens: TokenInfo[]
}

export interface LiveRange {
  hash: Hex
  maker: Address
  app: Address
  venue: Venue
  order: Order
  config: RangeConfig
  range: Range
  rates: bigint[]
  balances: bigint[]
  salt: bigint
  blockNumber: bigint
}

export interface Quote extends SplitResult {
  tokenIn: Address
  tokenOut: Address
  ranges: LiveRange[]
}

export interface OracleStatus {
  token: Address
  halted: boolean
  observedAt: bigint
  reportedE18: bigint
}

type Wallet = WalletClient<Transport, Chain, Account>

export class StabrixClient {
  constructor(
    readonly publicClient: PublicClient,
    readonly deployment: Deployment,
  ) {}

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

  async listRanges(includeDocked = false): Promise<LiveRange[]> {
    const { aqua, router, officialRouter, fromBlock } = this.deployment
    const apps = new Set([router.toLowerCase(), officialRouter.toLowerCase()])
    const logs = await this.publicClient.getLogs({ address: aqua, fromBlock, toBlock: 'latest' })
    const events = parseEventLogs({ abi: aquaAbi, logs, eventName: ['Shipped', 'Docked'] })

    const docked = new Set<string>()
    const shipped: LiveRange[] = []
    for (const ev of events) {
      if (!apps.has(ev.args.app.toLowerCase())) continue
      if (ev.eventName === 'Docked') {
        docked.add(`${ev.args.maker.toLowerCase()}:${ev.args.app.toLowerCase()}:${ev.args.strategyHash}`)
        continue
      }
      const order = decodeStrategy(ev.args.strategy)
      const parsed = parseProgram(order.data)
      if (!parsed) continue
      if (parsed.venue.kind === 'official' && parsed.venue.extruction.toLowerCase() !== this.deployment.extruction.toLowerCase()) {
        continue
      }
      shipped.push({
        hash: ev.args.strategyHash,
        maker: getAddress(ev.args.maker),
        app: getAddress(ev.args.app),
        venue: parsed.venue,
        order,
        config: parsed.config,
        range: toRange(parsed.config),
        rates: ratesOf(parsed.config),
        balances: [],
        salt: parsed.salt,
        blockNumber: ev.blockNumber,
      })
    }

    const live = includeDocked
      ? shipped
      : shipped.filter((r) => !docked.has(`${r.maker.toLowerCase()}:${r.app.toLowerCase()}:${r.hash}`))
    await this.refreshBalances(live)
    return live.filter((r) => includeDocked || r.balances.length === r.config.tokens.length)
  }

  async refreshBalances(ranges: LiveRange[]): Promise<void> {
    const calls = ranges.flatMap((r) =>
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
    const results = await this.publicClient.multicall({ contracts: calls, allowFailure: false })
    let k = 0
    for (const r of ranges) {
      const n = r.config.tokens.length
      const slice = results.slice(k, k + n) as readonly (readonly [bigint, number])[]
      k += n
      r.balances = slice.every(([, count]) => count === n) ? slice.map(([b]) => b) : []
    }
  }

  stateOf(r: LiveRange): RangeState {
    const index = new Map(r.config.tokens.map((t, k) => [t.toLowerCase(), k]))
    return {
      id: `${r.app}:${r.hash}`,
      real: r.balances,
      rates: r.rates,
      range: r.range,
      indexOf: (token) => index.get(token.toLowerCase()) ?? -1,
    }
  }

  quoteExactIn(ranges: LiveRange[], tokenIn: Address, tokenOut: Address, amountIn: bigint, halted: Set<string> = new Set()): Quote {
    const eligible = halted.has(tokenIn.toLowerCase()) ? [] : ranges.filter((r) => r.balances.length > 0)
    const split = splitExactIn(eligible.map((r) => this.stateOf(r)), tokenIn, tokenOut, amountIn)
    return { ...split, tokenIn, tokenOut, ranges: eligible }
  }

  midPrice(ranges: LiveRange[], tokenIn: Address, tokenOut: Address): bigint | null {
    let weighted = 0n
    let weight = 0n
    for (const r of ranges) {
      const s = this.stateOf(r)
      const i = s.indexOf(tokenIn)
      const j = s.indexOf(tokenOut)
      if (i < 0 || j < 0 || r.balances.length === 0) continue
      const w = r.balances.reduce((a, b, k) => a + (b * r.rates[k]!) / 10n ** 18n, 0n)
      weighted += spotPrice(r.balances, r.rates, r.range, i, j) * w
      weight += w
    }
    return weight === 0n ? null : weighted / weight
  }

  async simulateQuote(quote: Quote, account: Address): Promise<bigint> {
    const legs = this.toLegs(quote)
    const { result } = await this.publicClient.simulateContract({
      account,
      address: this.deployment.batchTaker,
      abi: stabrixBatchTakerAbi,
      functionName: 'swapExactIn',
      args: [quote.tokenIn, quote.tokenOut, legs, 0n, account, Number(BigInt(Math.floor(Date.now() / 1000)) + 600n)],
    })
    return result
  }

  toLegs(quote: Quote) {
    return quote.legs.map((leg) => {
      const r = quote.ranges.find((x) => `${x.app}:${x.hash}` === leg.id)
      if (!r) throw new Error(`leg ${leg.id} has no range`)
      return { router: r.app, order: r.order, amountIn: leg.amountIn }
    })
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
    await this.ensureAllowance(wallet, quote.tokenIn, this.deployment.batchTaker, quote.amountIn)
    const minOut = (quote.amountOut * BigInt(10_000 - slippageBps)) / 10_000n
    const block = await this.publicClient.getBlock()
    const hash = await wallet.writeContract({
      address: this.deployment.batchTaker,
      abi: stabrixBatchTakerAbi,
      functionName: 'swapExactIn',
      args: [quote.tokenIn, quote.tokenOut, this.toLegs(quote), minOut, wallet.account.address, Number(block.timestamp) + deadlineSeconds],
    })
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash })
    const [ev] = parseEventLogs({ abi: stabrixBatchTakerAbi, logs: receipt.logs, eventName: 'BatchSwapped' })
    return { hash, receipt, amountOut: ev?.args.amountOut ?? 0n }
  }

  buildRange(preset: PresetId, depositPerCoin: bigint, maxShareBps = 10_000, oracle = this.deployment.oracle): RangeConfig {
    const tokens = [...this.deployment.tokens].sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1))
    const p = presetById(preset)
    const designed = designRange(tokens.length, p, maxShareBps)
    const scaled = scaleRange(designed, depositPerCoin)
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

  async isShipped(maker: Address, config: RangeConfig, venue: Venue, salt: bigint): Promise<boolean> {
    const order = buildOrder(maker, config, venue, salt)
    const [, count] = await this.publicClient.readContract({
      address: this.deployment.aqua,
      abi: aquaAbi,
      functionName: 'rawBalances',
      args: [maker, this.appFor(venue), strategyHash(order), config.tokens[0]!],
    })
    return count > 0
  }

  async ship(wallet: Wallet, config: RangeConfig, depositPerCoin: bigint, venue: Venue, salt?: bigint) {
    const maker = wallet.account.address
    const order = buildOrder(maker, config, venue, salt ?? BigInt(Date.now()))
    const amounts = config.decimals.map((d) => (depositPerCoin * 10n ** 18n) / rateFromDecimals(d))
    for (let k = 0; k < config.tokens.length; k++) {
      await this.ensureAllowance(wallet, config.tokens[k]!, this.deployment.aqua, amounts[k]!)
    }
    const hash = await wallet.writeContract({
      address: this.deployment.aqua,
      abi: aquaAbi,
      functionName: 'ship',
      args: [this.appFor(venue), encodeStrategy(order), config.tokens, amounts],
    })
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash })
    return { hash, receipt, order, strategyHash: strategyHash(order), amounts }
  }

  async dock(wallet: Wallet, range: LiveRange) {
    const hash = await wallet.writeContract({
      address: this.deployment.aqua,
      abi: aquaAbi,
      functionName: 'dock',
      args: [range.app, range.hash, range.config.tokens],
    })
    return this.publicClient.waitForTransactionReceipt({ hash })
  }

  async oracleStatus(): Promise<OracleStatus[]> {
    const tokens = this.deployment.tokens.map((t) => t.address)
    const results = await this.publicClient.multicall({
      contracts: tokens.map((t) => ({
        address: this.deployment.oracle,
        abi: stabrixOracleAbi,
        functionName: 'status',
        args: [t],
      })) as never,
      allowFailure: false,
    })
    return tokens.map((token, k) => {
      const [halted, observedAt, reportedE18] = results[k] as unknown as readonly [boolean, bigint, bigint]
      return { token, halted, observedAt: BigInt(observedAt), reportedE18: BigInt(reportedE18) }
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

  static routerAbi = stabrixRouterAbi
}
