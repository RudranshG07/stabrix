# ETHGlobal submission

## Project name

Stabrix

## Short description (100 characters)

One wallet balance makes stablecoin FX markets on 1inch Aqua and backs every coin when one breaks.

## Description

Stablecoins in wallets and treasuries earn nothing, because earning swap fees means locking them in a pool. When one coin depegs, LPs in that pool are left holding it.

Stabrix gives a wallet two jobs without moving its coins. An FX range is one 1inch Aqua strategy that prices up to 8 stablecoins on one curve: USDC, USDT, DAI, USDS and USDe at $1, and EURC, BRZ and IDRX at live euro, real and rupiah rates. A peg backstop is a second strategy over the same balance that stays dormant until a coin depegs, then buys it below market and pays in healthy coins, never above face value.

Chainlink CRE runs the pricing and the safety. Every 30 seconds a workflow reads Chainlink feeds and two price APIs, agrees across nodes, and writes signed FX rates and depeg halts onchain. A halted coin is refused by every range on both routers, and only backstops buy it.

Trades split across every maker and both our SwapVM router and 1inch's official router, in one transaction.

## How it's made

- Solidity 0.8.30 with Foundry. Two new SwapVM v1.0.2 instructions: `StabrixTick` (opcode 34) prices a sphere AMM from Paradigm's research on many-stablecoin AMMs in closed form, with one square root per swap, a range edge, an exposure cap and a check that the LP never loses value. `StabrixBackstop` (opcode 35) prices depeg purchases from the oracle with a discount that grows as the cap fills.
- Both instructions also run on 1inch's deployed AquaSwapVMRouter through Extruction. `StabrixBatchTaker` fills legs on both routers in one transaction.
- SwapVM caps instruction arguments at 255 bytes, so configs are packed: 8 coins fit in 219 bytes for a range and 209 for a backstop.
- `StabrixOracle` is the CRE consumer. It accepts reports only from the forwarder and the workflow owner, uses a CRE rate only when it is fresh and within 0.5% of the Chainlink feed, and refuses swaps on a stale feed.
- Chainlink CRE workflow in Go (cre-sdk-go): one Multicall3 read of every feed and oracle status, two HTTP price APIs with median consensus and an identical-mask check, a halt policy where an offchain halt needs every API to agree, report generation and EVM write.
- TypeScript SDK with viem: a bigint port of the math verified byte for byte against Solidity, a market snapshot, a splitter across ranges and backstops, ship and dock helpers.
- Next.js app: swap, liquidity with FX ranges and backstops, and a depeg page driven by the real CRE workflow.
- Tested on a Base mainnet fork with real USDC, USDT, DAI, USDS, USDe, EURC, BRZ and IDRX against 1inch's official Aqua and router, and rehearsed on a Base Sepolia fork with the CRE workflow writing through Chainlink's forwarder.

## Partner prizes

- **1inch, Build an Aqua App.** Two new SwapVM instructions, multi-token Aqua strategies, shared liquidity across two strategy types from one wallet, official Aqua and router on Base. See README "Track: 1inch".
- **Chainlink, Best workflow with CRE.** The workflow sets the FX rates every swap uses and decides when a coin is broken, from Chainlink feeds and two APIs. See README "Track: Chainlink".

## Links

- Repo: https://github.com/RudranshG07/stabrix
- Demo video: TODO
- Live app: TODO
