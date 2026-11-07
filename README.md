# Stabrix

**Liquidity that never leaves.** One wallet balance makes stablecoin FX markets on 1inch Aqua and stands behind every stablecoin when one breaks, priced and guarded by Chainlink CRE.

**Live on [Base mainnet](#base-mainnet-8453) and [Base Sepolia](#base-sepolia-84532)**, one app with a Mainnet / Testnet switch.

| | Base mainnet | Base Sepolia |
|---|---|---|
| 1inch contracts | Official Aqua and AquaSwapVMRouter | Unmodified 1inch source, deployed by us |
| Coins | Real USDC and EURC | Mock USDC, USDT, DAI, USDS, USDe, EURC, BRZ, IDRX, free to mint in the app |
| Liquidity | $1.70 backing $3.74 of strategies, 2.20x shared | $5M per coin Tight range plus three ranges and two backstops |
| Prices and halts | Chainlink feeds onchain, guardian halts | Chainlink CRE reports from the CLI simulation, plus guardian halts |
| Router | [StabrixRouter](https://basescan.org/address/0xEbdbc7e05cfE6F8D2980d7EA4f40462e961808eB) | [StabrixRouter](https://sepolia.basescan.org/address/0x0dBF59AeCD34c52516DDF4143fc827341E066074) |
| Oracle | [StabrixOracle](https://basescan.org/address/0xD3BD0E168759C516af8CEFA5afC3Fdc6Af186Ed7) | [StabrixOracle](https://sepolia.basescan.org/address/0x9B60A21F729CC6138E89d84615c1c26b06f31354) |

Chainlink CRE workflow in Go · 2 new SwapVM instructions · 80 contract tests, 145 SDK tests, 21 workflow tests

![Landing](docs/screenshots/landing.png)

## The problem

Hundreds of billions of dollars of stablecoins sit in wallets, treasuries and DAOs earning nothing. To earn swap fees today you lock them in a pool, and a pool has two weaknesses:

- **Your coins leave your wallet.** Capital in one pool cannot do anything else, so a treasury that wants to make markets has to choose one job for every dollar.
- **A depeg lands on the LPs.** When one coin breaks, arbitrageurs dump it into the pool and take the healthy coins out. The LPs end up holding the broken coin at the worst price, and the market loses its liquidity exactly when it needs it most.

## The idea

Stabrix gives one wallet balance two jobs at once, without moving a single coin out of the wallet.

| | FX range | Peg backstop |
|---|---|---|
| SwapVM instruction | `StabrixTick`, opcode 34 | `StabrixBackstop`, opcode 35 |
| When it trades | Every day | Only after Chainlink CRE says a coin is broken |
| What it does | Prices up to 8 stablecoins on one curve: USDC, USDT, DAI, USDS, USDe at $1 and EURC, BRZ, IDRX at live euro, real and rupiah rates | Buys the broken coin at its market price minus a discount the LP picks, pays in healthy coins, never above face value |
| Earns | Swap fees, 1 to 10 bps on dollar pairs, 5 to 30 bps on FX pairs | The discount, 1% to 25% depending on the preset |

Both are 1inch Aqua strategies over the **same** balance. Aqua records allowances, not deposits, and pulls tokens from the maker's wallet only when a trade fills. So $1 in a wallet can quote an FX range and pledge a backstop at the same time; on Base mainnet $1.70 of real USDC and EURC backs $3.74 of live strategies, a shared liquidity ratio of 2.20x.

The result is a market nobody else can offer: **a buyer of last resort for every stablecoin, funded by idle wallet balances, that wakes up on a Chainlink signal.** On a normal day it is the cheapest place to swap one stablecoin for another, including across currencies. On a bad day it is the only place still buying.

## The curve

FX ranges use the sphere AMM from [Paradigm's research paper on AMMs for many stablecoins](https://www.paradigm.xyz/2025/06/orbital). Uniswap prices two tokens on a hyperbola. A sphere prices n tokens at once:

$$
x \cdot y = k \quad\longrightarrow\quad \sum_{k=1}^{n} (r - v_k)^2 = r^2
$$

| Piece | What it means here |
|---|---|
| **Virtual balance** | $v_k = x_k \rho_k + m$. $x_k$ is the maker's real Aqua balance of coin $k$, $\rho_k$ its USD price from the oracle, $m$ a virtual floor under every coin |
| **Peg point** | All $v_k$ equal at $r(1 - 1/\sqrt{n})$, where every coin trades at its oracle price. The curve only bends as the basket drifts |
| **Price** | $p_{ij} = \frac{r - v_i}{r - v_j} \cdot \frac{\rho_i}{\rho_j}$. With $\rho$ from Chainlink, EURC, BRZ and IDRX trade on the same curve as the dollar coins at live FX rates |
| **Concentration** | The floor $m$ is what makes a range tight. Tight sets $m = 300 \times$ the deposit, so each real dollar quotes like $301. Balanced is 61x, Wide 11x |
| **Range edge** | A swap that would push $\sum v_k$ past the range's edge reverts. The range stops trading its heaviest coin instead of buying more of a falling one |
| **Exposure cap** | No coin may grow past $2/n$ of the range by default, so one coin cannot take over an LP's balance |
| **LP check** | The radius $r$ is re-derived from live Aqua balances on every swap and the swap reverts unless $r' \ge r$. A trade can never make the LP poorer |

Swaps are closed form, a square root for the radius and one for the output, with no iterative solver and no tick crossing. Fees stay in the maker's wallet and compound into the radius.

Presets, each designed so the price of the worst coin hits the edge at a set depeg:

| Preset | Capital efficiency | Edge | Fee, dollar pairs | Fee, FX pairs |
|---|---|---|---|---|
| Tight | 301x | 0.5% | 1 bp | 5 bps |
| Balanced | 61x | 2% | 4 bps | 10 bps |
| Wide | 11x | 8% | 10 bps | 30 bps |

## The backstop

A backstop is dormant. Its pricing contract asks the oracle for the coin's depeg price, and the oracle reverts `NotDepegged` until Chainlink CRE (or the guardian) has halted that coin. After a halt:

$$
\text{out} = a \cdot \min(\text{market}, 1) \cdot (1 - d) \,/\, p_{\text{out}}, \qquad d = d_0 + (d_1 - d_0)\,\frac{A + a/2}{C}
$$

$a$ is the amount sold, $A$ what the backstop already absorbed, $C$ its cap per coin. The discount starts at $d_0$ and grows to $d_1$ as the cap fills, so the first seller gets the best price and a backstop can never be drained in one trade. It pays only in coins that are not halted, refuses exact-out quotes, and never pays above face value even if the market says otherwise.

| Preset | Discount |
|---|---|
| Light | 1% to 5% |
| Standard | 2% to 10% |
| Deep | 5% to 25% |

At the same moment every FX range on both routers refuses the halted coin as input, because the oracle reverts `Halted`. Healthy pairs keep trading. The broken coin can only be sold to backstops, at a price their makers chose in advance.

## What it gives you

**No deposits.** Coins never leave the LP's wallet. Shipping a strategy is an Aqua allowance; docking it ends it. The LP can still spend the coins, and the router routes around a wallet that no longer holds what it offered.

**Low cost.** Measured live on Base Sepolia from fresh wallets, fees included: $10,000 USDC to DAI costs 1.12 bps, $100,000 costs 2.21 bps. The received amount equals the SDK quote to the wei.

**FX in the same book.** USDC to EURC, BRZ or IDRX trades on the same curve as USDC to DAI, priced from Chainlink feeds. $10,000 USDC to EURC costs 5.12 bps, and 5 of those are the Tight preset's FX fee.

**Liquidity that shows up in a depeg.** On Base Sepolia, after USDe was halted at $0.93, a fresh wallet sold 5,000 USDe to two backstops for 4,549.25 USDC in one transaction across both routers. In a pool, that same seller would have drained the LPs.

**One balance, several jobs.** A wallet can run ranges on both routers and a backstop for seven coins from one balance. The Liquidity page shows the shared liquidity ratio for every maker.

**Chainlink decides what is broken.** Halts and FX rates come from a CRE workflow that checks Chainlink feeds against two independent price APIs with consensus across nodes. No single API can halt or un-halt a coin.

## What we built

| Component | What it is |
|---|---|
| `StabrixTick` (opcode 34) | The sphere AMM as a SwapVM v1.0.2 instruction. Config for 8 coins packs into 219 bytes to fit SwapVM's 255-byte argument limit |
| `StabrixBackstop` (opcode 35) | Depeg purchases priced from the oracle, config packed into 209 bytes |
| `StabrixRouter` | 1inch SwapVM v1.0.2 with the two instructions added |
| `StabrixExtruction`, `StabrixBackstop` | The same pricing on 1inch's **official, already deployed** AquaSwapVMRouter through its Extruction opcode (32). No 1inch contract is modified |
| `StabrixBatchTaker` | One trade split across many makers on both routers in one transaction, with a minimum output and a deadline |
| `StabrixOracle` | The CRE consumer. Holds FX rates, depeg prices, CRE halts and separate guardian halts |
| `StabrixLens` | Reads every strategy, balance and quote in one call for the app |
| `cre/depeg-sentinel` | The Chainlink CRE workflow, in Go |
| `@stabrix/sdk` | viem SDK: a bigint port of the math that matches Solidity byte for byte, market snapshots, the splitter, ship and dock |
| `app` | Next.js app: Swap, Liquidity, Pool, Activity, Docs and a Depeg lab, one site for mainnet and testnet |

## Architecture

```
 app (Next.js)  ->  @stabrix/sdk (viem): market snapshot, quotes, split, ship, dock
        |
        +-- StabrixBatchTaker: one trade, many makers, both routers, one transaction
              |                                   |
     StabrixRouter (SwapVM v1.0.2)       1inch AquaSwapVMRouter (official)
     opcode 34 StabrixTick                Extruction -> StabrixExtruction
     opcode 35 StabrixBackstop            Extruction -> StabrixBackstop
              |                                   |
              +---- StabrixPricing / StabrixBackstopPricing ----+
                     reads Aqua balances, checks the maker's wallet, asks the oracle
                                          |
              1inch Aqua (official) <- maker wallets       StabrixOracle <- Chainlink CRE workflow
                                                                 ^            (feeds + 2 APIs, Go)
                                                         Chainlink feeds
```

**1inch Aqua** is the ledger. It records, per maker and per strategy, how much of each token the strategy may use. It never holds the tokens; they stay in the maker's wallet.

**The routers** run SwapVM programs. A strategy is a program of instructions; ours is one instruction with a packed config. Both routers call the same pricing libraries, so a range quotes the same price on either.

**The oracle** is the only source of prices. Every swap asks it for the price of each coin in the range, and it refuses a halted coin as input.

### Custody: why wallet to wallet, not a pool

This is what makes the backstop possible, so it is worth being precise.

- **Shipping a strategy** calls `Aqua.ship` with the strategy's program and a token allowance per coin. Nothing transfers. The maker's coins stay in the maker's wallet and stay spendable.
- **A fill** pulls the input token into the maker's wallet and pushes the output token to the taker, through Aqua, in the same call. The pricing reads the maker's Aqua balance for each coin, so the curve always sees what the maker actually has.
- **Shared liquidity.** Two strategies can hold allowances over the same coins. A range and a backstop over the same $100k of USDC both quote; whichever fills first uses the coins, and the other sees the lower balance on its next quote.
- **Wallet shortfall.** If the maker spent the coins elsewhere, `checkWallet` reverts that leg and the SDK skips the maker. No trade can pull more than the wallet holds, and one wallet is never asked for more across several legs of one trade.
- **Docking** removes the allowance. There is no withdrawal, because nothing was deposited.

### One swap

```
user ─► StabrixBatchTaker.swap(legs, minOut, deadline)
          for each leg (a maker, a strategy, a router):
            router.swap(order, tokenIn, tokenOut, amount)
              └─ StabrixTick / Extruction
                   • read the maker's Aqua balances for every coin in the range
                   • oracle.prices(tokens, tokenIn)     reverts Halted / StaleRate
                   • v_k = x_k ρ_k + m,  r from v,  solve for the output
                   • check the range edge and the exposure cap
                   • check r' ≥ r                      the LP never loses value
                   • checkWallet(maker, tokenOut, out)
              └─ Aqua pulls tokenIn to the maker, pushes tokenOut to the taker
          revert unless total out ≥ minOut and now ≤ deadline
```

The SDK builds the legs: it splits the trade into 64 slices and gives each slice to the strategy with the best marginal price across every maker on both routers, halving slices near a range edge and skipping strategies the trader owns. Every quote is checked against the chain; the app's quoted amount equals the received amount to the wei.

### One depeg

```
every 30 s ─► CRE workflow
               • one Multicall3 read: oracle state + every Chainlink feed
               • CoinGecko and DefiLlama over HTTP, consensus across nodes
               • policy: USDe 7% off peg on both APIs ─► halt
               • signed report ─► forwarder ─► StabrixOracle.onReport
                                    accepts only the forwarder and the set workflow owner

seller ─► StabrixBatchTaker.swap(USDe ─► USDC)
            FX ranges:  oracle.prices reverts Halted(USDe)     every range refuses
            backstops:  oracle.depegPrice(USDe) = min(CRE price, market feed)
                        pay market × (1 − d) in USDC, d grows as the cap fills

USDe back within 0.25% on every source ─► resume report ─► backstops go dormant again
```

## Chainlink CRE

The workflow, `cre/depeg-sentinel`, is the orchestration layer: it sets the FX rate every swap uses and decides when a coin is broken.

| Step | Detail |
|---|---|
| Trigger | Cron every 30 seconds |
| Onchain read | One Multicall3 call: every Chainlink feed and the oracle's current status per coin |
| Offchain read | CoinGecko (full precision) and DefiLlama over HTTP, aggregated across nodes with median consensus and a check that every node saw the same set of prices |
| Decide | `policy.go`, below |
| Write | A signed report through the CRE forwarder to `StabrixOracle.onReport` |

| Rule | Threshold |
|---|---|
| Halt on the offchain APIs | 3% off peg, and every configured API must agree |
| Halt on the Chainlink feed | 3% off peg, the feed alone is enough |
| Halt on both | Both sources past 0.75% |
| Resume | Every source that answered is back inside 0.25%, so one lagging API cannot lift a halt |
| FX rate push | On a 2 bp move or every 10 minutes |

The oracle is defensive about what it accepts:

- Reports only from the configured forwarder **and** the configured workflow owner. Until a workflow owner is set, every report is refused.
- A CRE FX rate is used only if it is under 15 minutes old **and** within 0.5% of the Chainlink feed. Otherwise the feed is used.
- A Chainlink feed older than its limit pauses FX swaps for that coin rather than trading on a stale rate.
- The depeg price is the lower of the fresh CRE price and the market feed, so a backstop never overpays.
- Reports from the future are refused. Guardian halts are separate and survive a calm CRE report.

## How it compares

| | Uniswap v3 | Curve StableSwap | Pooled sphere AMM (v4 hook) | **Stabrix** |
|---|---|---|---|---|
| Coins per strategy | 2 | 2 to 8 | n | Up to 8 per strategy, unlimited by routing |
| Concentrated liquidity | Yes | No | Yes | Yes, three presets |
| Non-dollar stablecoins at live FX | No | No | No | Yes: EURC, BRZ, IDRX from Chainlink |
| Coins leave the LP's wallet | Yes | Yes | Yes | **No**, Aqua allowances |
| Same capital backs several strategies | No | No | No | **Yes**, 2.20x measured on mainnet |
| In a depeg | LPs buy the broken coin all the way down | LPs buy the broken coin all the way down | The LP's tick exits and stops quoting | **Ranges refuse it, backstops buy it at the LP's chosen discount** |
| Who decides a coin is broken | Nobody | Nobody | The price reaching the tick | Chainlink CRE: feeds plus two APIs with consensus |
| Venue | Standalone | Standalone | Uniswap v4 | 1inch Aqua, both our router and 1inch's official router |

A pooled sphere AMM protects its LPs from a depeg by leaving. Stabrix lets LPs choose to **stay** and be paid for it, from the same balance that earns FX fees every other day.

## Measured

### Live cost table, Base Sepolia

Cost is the dollar value lost against the oracle price, fees included, one leg each (`npm run costs`, log in [`docs/evidence/sepolia-costs.txt`](docs/evidence/sepolia-costs.txt)).

| Trade | $1k | $10k | $100k |
|---|---|---|---|
| USDC to DAI | 1.01 bps | 1.12 bps | 2.21 bps |
| USDC to EURC | 5.01 bps | 5.12 bps | 6.21 bps |

The USD to EUR floor is the Tight preset's 5 bp FX fee; dollar pairs pay 1 bp.

### Live trades

| What | Result |
|---|---|
| $10,000 USDC to DAI, Base Sepolia, fresh wallet | 9,998.88 DAI, equal to the quote: [0xe8c89fee...3003](https://sepolia.basescan.org/tx/0xe8c89fee79fec9cb8daaa142a622a409e00c1d579c22ed34b7968109bfd63003) |
| $10,000 USDC to EURC, Base Sepolia | 8,965.68 EURC, equal to the quote: [0x02cb7a18...895d](https://sepolia.basescan.org/tx/0x02cb7a187e5521a770386bb79b6ec95bcb15109785a4494c2e6c2e586dc5895d) |
| USDe halted at $0.93, Base Sepolia | Every range refuses USDe; a fresh wallet sells 5,000 USDe to two backstops, one per router, for 4,549.25 USDC: [0x01521a82...b7b8](https://sepolia.basescan.org/tx/0x01521a820a999ee5489f34f18d396965eb1f602f6b58e6c10caabc39e0ddb7b8). Log in [`docs/evidence/sepolia-depeg.txt`](docs/evidence/sepolia-depeg.txt) |
| Real CRE CLI run, Base Sepolia | Live CoinGecko and DefiLlama prices written to the oracle: [0x9b38b774...7e77](https://sepolia.basescan.org/tx/0x9b38b774b71255ec54cd13c0ba9a76d2d16f0699919890a8557e45ebf7697e77). Log in [`docs/evidence/cre-simulate-sepolia.txt`](docs/evidence/cre-simulate-sepolia.txt) |
| Base mainnet, real money | $1.70 of USDC and EURC backs $3.74 of strategies on both official 1inch contracts, a shared liquidity ratio of 2.20x. The full deploy cost 0.0000656 ETH (about $0.15) |

### Base mainnet fork, real tokens

| What | Result |
|---|---|
| Real CRE CLI run, USDe at $0.93 | The workflow halts USDe onchain (tx `0xa023...8cf7`) and a second run resumes it (tx `0xcd39...15a1ee`). Logs in [`docs/evidence/cre-simulate-halt.txt`](docs/evidence/cre-simulate-halt.txt) and [`cre-simulate-resume.txt`](docs/evidence/cre-simulate-resume.txt) |
| USDe falls to $0.93 | Ranges refuse USDe after the halt; the two backstop makers end +1.86% and +1.12% |
| EURC crashed 7% with the real CRE workflow | Halted ("offchain 700bps >= hard 300bps"), backstops bought 35,829 EURC up to their $20,000 caps, then a second run resumed it |
| Every pair on 1inch's official router | All 8 real coins (USDC, USDT, DAI, USDS, USDe, EURC, BRZ, IDRX) in one range, every pair filled (`BaseFork.t.sol`) |
| Deploy | 16 transactions, 10,965,053 gas |

## Walkthrough

| Swap | Liquidity |
|---|---|
| ![Swap](docs/screenshots/swap.png) | ![Liquidity](docs/screenshots/liquidity.png) |
| Any two of 8 stablecoins, split across every maker on both routers in one transaction. The quote shows the route, the cost against the Chainlink rate, and why a coin is refused if it is halted. | Open an FX range with a preset and the coins you want, or pledge a backstop with a cap per coin. Both use the balance already in your wallet. |
| **Pool** | **Depeg lab** |
| ![Pool](docs/screenshots/pool.png) | ![Depeg](docs/screenshots/lab.png) |
| The reserve mix across every maker, liquidity by depeg tolerance, and every live strategy with its router and status. | On the fork, crash a coin, run the real CRE workflow, and watch it halt the coin while backstops buy it. On Sepolia the same flow runs from `npm run depeg:testnet`. |

**Activity** lists swaps, strategies and every CRE report read straight from the chain, one row per report with Basescan links. **Docs** explains the math, the routing and the deployment in the app itself. Any EIP-6963 wallet connects (MetaMask, Phantom, Rabby and others), and the app switches it to the right Base network. On Sepolia a new wallet gets $10,000 of each test coin in one transaction from the account menu.

| Mobile | |
|---|---|
| ![Mobile landing](docs/screenshots/mobile-landing.png) | ![Mobile swap](docs/screenshots/mobile-swap.png) |

## Prize tracks

### 1inch, Build an Aqua App

| Requirement | Evidence |
|---|---|
| Custom Aqua app with a sophisticated DeFi position | FX ranges over up to 8 coins and peg backstops, shipped as Aqua strategies from one wallet (`contracts/src`, Liquidity page) |
| Uses SwapVM, own instructions allowed | `StabrixTick` (34) and `StabrixBackstop` (35) in `contracts/src/StabrixRouter.sol`; pricing in `StabrixPricing.sol`, `StabrixMath.sol`, `StabrixBackstopPricing.sol` |
| Official Aqua and SwapVM contracts | Official Aqua `0x1111113C...a90a` and AquaSwapVMRouter `0x111111338c...C0De` on Base mainnet, reached through Extruction with no 1inch contract modified. On Base Sepolia, where 1inch has not deployed, their unmodified source |
| Shared liquidity | One balance backs ranges on both routers and a backstop: 2.20x on mainnet, shown per maker on the Liquidity page |
| Positions shown through tests or a UI | 80 Foundry tests and the Liquidity, Pool and Activity pages |
| Onchain token transfers in the demo | Real USDC and EURC on Base mainnet; live swaps and a backstop depeg sale on Base Sepolia; every pair with real tokens on a Base fork |
| Proper git history | Small commits per change, 97 so far |

### Chainlink, Best workflow with CRE

| Requirement | Evidence |
|---|---|
| CRE workflow as the orchestration layer | `cre/depeg-sentinel/main.go` sets the FX rates and depeg halts every swap reads through `StabrixOracle` |
| Blockchain plus an external API | Base (Multicall3 reads of Chainlink feeds and oracle state, signed report writes) plus CoinGecko and DefiLlama with consensus |
| Successful CRE CLI simulation | Halt and resume on a Base fork (`cre-simulate-halt.txt`, `cre-simulate-resume.txt`) and a live write on Base Sepolia (`cre-simulate-sepolia.txt`), all with `--broadcast` |
| Meaningfully used | A halted coin is refused by every range on both routers and only backstops buy it. FX swaps price at the CRE rate. Without the workflow, the backstop never trades |

## Deployments

### Base mainnet (8453)

Deployed against 1inch's official Aqua and AquaSwapVMRouter, seeded with real USDC and EURC.

| Contract | Address |
|---|---|
| StabrixRouter | [0xEbdbc7e05cfE6F8D2980d7EA4f40462e961808eB](https://basescan.org/address/0xEbdbc7e05cfE6F8D2980d7EA4f40462e961808eB) |
| StabrixExtruction | [0xc8721a6c1b8fAeC6E9Ef03e7EbD9d3fC7E7C45E9](https://basescan.org/address/0xc8721a6c1b8fAeC6E9Ef03e7EbD9d3fC7E7C45E9) |
| StabrixBackstop | [0x2Af9211c1Ffe418345bC6979d563ca9eC05D7DEc](https://basescan.org/address/0x2Af9211c1Ffe418345bC6979d563ca9eC05D7DEc) |
| StabrixOracle | [0xD3BD0E168759C516af8CEFA5afC3Fdc6Af186Ed7](https://basescan.org/address/0xD3BD0E168759C516af8CEFA5afC3Fdc6Af186Ed7) |
| StabrixBatchTaker | [0xf934Dd022a6d2623E753710fd68A374fD0ab4b95](https://basescan.org/address/0xf934Dd022a6d2623E753710fd68A374fD0ab4b95) |
| StabrixLens | [0x86f41CF038bd17fC96FB0ff07ac0B3539E9829B6](https://basescan.org/address/0x86f41CF038bd17fC96FB0ff07ac0B3539E9829B6) |
| 1inch Aqua (official) | [0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a](https://basescan.org/address/0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a) |
| 1inch AquaSwapVMRouter (official) | [0x111111338c5091E8440b67B168bAe16a668AC0De](https://basescan.org/address/0x111111338c5091E8440b67B168bAe16a668AC0De) |

One wallet runs a Balanced range on the Stabrix router ([tx](https://basescan.org/tx/0x5b3828126942a9fab8c87b5b6bf740fb00ed3fedf3176c85b3496cb10a3ad8ae)), a Wide range on 1inch's router ([tx](https://basescan.org/tx/0x274b52dc74cd271031e018c0de805d614a7d8b9463ab412e2f6bdab0b8c6e3b8)) and a backstop covering the other seven coins ([tx](https://basescan.org/tx/0xe2d2c91438f1121df2dd5c17d30b8524446c1b89a50cf53b47afc0445008a37c)). It proves the contracts on Base with real tokens and both 1inch routers; it is not sized for real trades. The oracle accepts CRE reports only from Chainlink's production forwarder once a workflow owner is set, which needs CRE deploy access; until then FX rates come straight from the Chainlink feeds and only the guardian can halt.

### Base Sepolia (84532)

| Contract | Address |
|---|---|
| StabrixRouter | [0x0dBF59AeCD34c52516DDF4143fc827341E066074](https://sepolia.basescan.org/address/0x0dBF59AeCD34c52516DDF4143fc827341E066074) |
| StabrixExtruction | [0xCB8c96CAAE6131b2B71b0E597B099c0891f608f9](https://sepolia.basescan.org/address/0xCB8c96CAAE6131b2B71b0E597B099c0891f608f9) |
| StabrixBackstop | [0x2DE563f81ed933be470075e28d118c54e4271F24](https://sepolia.basescan.org/address/0x2DE563f81ed933be470075e28d118c54e4271F24) |
| StabrixOracle | [0x9B60A21F729CC6138E89d84615c1c26b06f31354](https://sepolia.basescan.org/address/0x9B60A21F729CC6138E89d84615c1c26b06f31354) |
| StabrixBatchTaker | [0xFD9a7555C958d471238Ac0DD11B077a0da1f5588](https://sepolia.basescan.org/address/0xFD9a7555C958d471238Ac0DD11B077a0da1f5588) |
| StabrixLens | [0x2691368CcfF8AE2048DC17171fC98853f9De1Ff5](https://sepolia.basescan.org/address/0x2691368CcfF8AE2048DC17171fC98853f9De1Ff5) |
| 1inch Aqua (unmodified source) | [0x9C1c395C0B1B15eF4DE0B618597b1e221b7E2128](https://sepolia.basescan.org/address/0x9C1c395C0B1B15eF4DE0B618597b1e221b7E2128) |
| 1inch AquaSwapVMRouter (unmodified source) | [0xd7451569651a98870d8519Ae6eCbEA94024B6416](https://sepolia.basescan.org/address/0xd7451569651a98870d8519Ae6eCbEA94024B6416) |

Seeded with test coins: four FX ranges, the deepest a Tight range of $5,000,000 per coin on the 1inch router, and two Standard backstops pledging $130,000 of USDC and $130,000 of USDT from the same wallet. Mock coins mint freely; testnet FX feeds hold the last rate synced from Base mainnet.

Addresses for every network are in `deployments/<chainId>.json`.

## Testing

| Suite | What it proves |
|---|---|
| `StabrixMath.t.sol` (15) | Radius and exact-in match a reference, exact-out inverts exact-in, near-peg slippage, the edge and exposure cap stop a dump, mixed decimals. Fuzzed at 2,000 runs: the LP never loses value, a round trip never profits, a split trade never beats the whole trade (with and without fees, mixed decimals) |
| `StabrixFx.t.sol` (19) | Every FX pair at the feed rate, FX fee only on FX pairs, small rate moves are not arbitrable, CRE rate used only within bound and when fresh, stale feeds pause FX ranges but not dollar ranges, a 2-decimal coin (IDRX), fuzzed across rate moves |
| `StabrixBackstop.t.sol` (16) | Dormant until a depeg, discount grows with size, cap stops buying, halted payouts refused, never pays above par, the same balance backs a range and a backstop, the official router matches the native one, fuzzed so it never pays above the discounted market |
| `StabrixRouter.t.sol` (21) | Funds stay in the wallet, quote equals swap, docked ranges stop, halts block inflow only, forwarder and workflow owner checks, guardian halts survive calm reports, batch across both routers in one transaction, min-out protection, fuzzed so the router never drains an LP |
| `fork/BaseFork.t.sol` (9) | On a Base mainnet fork: the official router uses the official Aqua, Chainlink feeds are live, an 8-coin range fits the official router, every pair fills with real tokens, the production forwarder rejects unsigned reports, a backstop buys real USDe after a CRE depeg report |
| SDK (145) | Byte-for-byte parity with Solidity on generated range, FX and backstop vectors, routing across strategies and routers, the client against a chain |
| Workflow (21) | Halt and resume policy, price parsing, consensus masks, report encoding |

```bash
cd contracts && forge test
BASE_RPC_URL=https://mainnet.base.org forge test --match-path test/fork/BaseFork.t.sol
npm test -w @stabrix/sdk
cd cre/depeg-sentinel && go test ./...
```

## Repo layout

```
stabrix/
├── contracts/                 Solidity 0.8.30, Foundry
│   ├── src/StabrixRouter.sol         SwapVM v1.0.2 plus opcodes 34 and 35
│   ├── src/StabrixMath.sol           the sphere AMM, closed form
│   ├── src/StabrixPricing.sol        reads Aqua balances, asks the oracle, checks the wallet
│   ├── src/StabrixBackstopPricing.sol
│   ├── src/StabrixConfig.sol         range config packed under 255 bytes
│   ├── src/StabrixExtruction.sol     the same pricing on 1inch's official router
│   ├── src/StabrixBatchTaker.sol     many makers, both routers, one transaction
│   ├── src/StabrixOracle.sol         Chainlink CRE consumer
│   └── test/                         unit, fuzz and Base fork suites
├── cre/depeg-sentinel/        Chainlink CRE workflow, Go
│   ├── main.go                       trigger, reads, consensus, report, write
│   └── policy.go                     halt, resume and rate push rules
├── sdk/                       @stabrix/sdk, viem
│   ├── src/math.ts                   bigint port of StabrixMath
│   ├── src/split.ts                  64-slice router across every strategy
│   └── src/client.ts                 market snapshot, quotes, ship, dock
├── ops/                       deploy, seed, cost table, live trades, depeg demos
├── app/                       Next.js app
├── deployments/               addresses per network
└── docs/evidence/             raw logs behind every number in this README
```

## Getting started

Requirements: Foundry, Node 22+, Go 1.25+, the [CRE CLI](https://docs.chain.link/cre).

### Local Base fork

```bash
npm install
(cd contracts && npm install)

FORK_PORT=8556 DEPLOYMENT_NAME=base-fork-fx ./ops/devnet.sh
npm run price-api -w @stabrix/ops
cd app && NEXT_PUBLIC_DEV_ACCOUNTS=1 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8556 DEPLOYMENT_NAME=base-fork-fx npx next dev -p 3000
```

`devnet.sh` forks Base, deploys with the CRE simulation forwarder, ships three FX ranges and two backstops, and writes the fork CRE config. Fork accounts use anvil's public keys and appear only with `NEXT_PUBLIC_DEV_ACCOUNTS=1`. A fork freezes Chainlink's feeds while blocks follow the clock, so the fork oracle accepts 30-day-old feeds; Sepolia and mainnet keep the real limits.

Run the CRE workflow against the fork (from `cre/`, after `cre login`, with `CRE_ETH_PRIVATE_KEY` in `cre/.env` set to a funded anvil key):

```bash
cre workflow simulate depeg-sentinel -T fork-settings --broadcast --non-interactive --trigger-index 0
```

### Demos on Base Sepolia

Each trade uses a fresh wallet funded by the deployer, so the quote skips no strategy.

```bash
cd ops
export RPC_URL=https://base-sepolia-rpc.publicnode.com PRIVATE_KEY=<deployer key>
npm run costs                                  # cost table at $1k, $10k, $100k
npm run trade:testnet -- USDC EURC 10000       # one live swap, prints cost and tx
npm run depeg:testnet -- halt USDe 0.93        # guardian halt plus a $0.93 market price
npm run depeg:testnet -- sell USDe 5000        # ranges refuse USDe, backstops buy it
npm run depeg:testnet -- resume USDe
```

Real coins on Sepolia never depeg, so the oracle owner plays the part with a guardian halt; with CRE deploy access the same halt comes from the workflow.

### Deploy your own

1inch has not deployed Aqua or the SwapVM router on Base Sepolia, so the deploy script deploys their unmodified source next to Stabrix, with mock stablecoins and testnet FX feeds.

```bash
cd contracts
PRIVATE_KEY=<key> CRE_FORWARDER=0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5 \
CRE_WORKFLOW_OWNER=0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa \
  forge script script/Deploy.s.sol --tc Deploy --rpc-url https://sepolia.base.org --broadcast
cd ../ops
export RPC_URL=https://base-sepolia-rpc.publicnode.com PRIVATE_KEY=<key>
npm run sync-feeds
npm run seed:testnet
npm run cre-config -- testnet
cd ../cre && cre workflow simulate depeg-sentinel -T testnet-settings --broadcast --non-interactive --trigger-index 0
```

`0xaAaA...aAaA` is the owner the CRE simulator reports as; a production deploy sets the real workflow owner. `sepolia.base.org` limits `eth_getLogs` to 200 blocks, so ops and the app read through `base-sepolia-rpc.publicnode.com`. With `--broadcast` the simulation sends a real transaction from `CRE_ETH_PRIVATE_KEY`, so on a public network that must be your own funded key, never a public anvil key.

### Hosting

The app runs on Vercel's free tier: import the repo, set Root Directory to `app`, and set `DEPLOYMENT_NAME=84532,8453`. One site serves both networks with a Mainnet / Testnet switch in the header; the first network listed is the default and `?network=8453` links straight to mainnet. Never set `NEXT_PUBLIC_DEV_ACCOUNTS` on a hosted build.

## Limitations

- Multi-token strategies rely on SwapVM v1.0.2, where the taker picks the token pair.
- One strategy holds at most 8 coins (9 on the Stabrix router) because SwapVM caps instruction arguments at 255 bytes; more coins mean more strategies, combined by the router.
- A range at its edge refuses its heaviest coin instead of trading along the boundary, and strategies are combined by routing rather than merged onchain.
- A production CRE deployment needs deploy access from Chainlink. Until then the mainnet oracle prices FX from Chainlink feeds and only the guardian halts.
- Free price APIs rate limit; an offchain halt needs both, so a halt can wait while one is down. A Chainlink feed still halts on its own.
- Testnet coins are mocks, and the mainnet deployment holds a few dollars.

## References

- [Paradigm's research paper on AMMs for many stablecoins](https://www.paradigm.xyz/2025/06/orbital), Dave White, Dan Robinson and Ciamac Moallemi
- [1inch Aqua](https://github.com/1inch/aqua) and [1inch SwapVM](https://github.com/1inch/swap-vm)
- [Chainlink Runtime Environment](https://docs.chain.link/cre)

Code was written with Claude Code as a pair programmer. Every number in this README comes from a test, a command in this repo or a transaction linked above.

## License

MIT for Stabrix code. 1inch SwapVM and Aqua are dependencies under their own licenses.
