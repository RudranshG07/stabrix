# Stabrix

**Liquidity that never leaves.** One wallet balance makes stablecoin FX markets on 1inch Aqua and backs every stablecoin when one breaks, priced and guarded by Chainlink CRE.

![Landing](docs/screenshots/landing.png)

| Swap | Liquidity | Depeg |
|---|---|---|
| ![Swap](docs/screenshots/swap.png) | ![Liquidity](docs/screenshots/liquidity.png) | ![Depeg](docs/screenshots/lab.png) |

## What it does

Stablecoins in wallets and treasuries earn nothing, because earning swap fees means locking them in a pool. When one coin depegs, LPs in that pool end up holding it.

Stabrix gives a wallet two jobs at once, without moving its coins:

1. **FX range** (SwapVM opcode 34, `StabrixTick`). One Aqua strategy prices up to 8 stablecoins on one curve: USDC, USDT, DAI, USDS and USDe at $1, plus EURC, BRZ and IDRX at live euro, real and rupiah rates. The math comes from Paradigm's research paper on AMMs for many stablecoins, built as a closed-form SwapVM instruction with one square root per swap. Every swap re-derives the pool from live Aqua balances and reverts if the LP's position would lose value.
2. **Peg backstop** (SwapVM opcode 35, `StabrixBackstop`). Dormant while every coin is healthy. When Chainlink CRE halts a coin, the backstop buys it at its market price minus a discount the LP chooses, pays in healthy coins, and never pays above face value.

The same balance backs both strategies, because Aqua only records allowances and pulls tokens when a trade fills. LPs can still spend their coins; the router routes around a wallet that no longer holds what it offered.

**Chainlink CRE** runs the pricing and the safety. Every 30 seconds a Go workflow reads Chainlink feeds and two price APIs in one batched call, agrees on prices across nodes, and writes signed FX rates and depeg halts to `StabrixOracle`.

## How it fits together

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

## Track: 1inch, Build an Aqua App

| What | Where |
|---|---|
| Aqua strategies, no deposits | Ranges and backstops are shipped to the official Aqua `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`; fills pull from the maker wallet (`sdk/src/client.ts`, `contracts/src/StabrixLens.sol`) |
| New SwapVM instructions | `StabrixTick` (34) and `StabrixBackstop` (35) in `contracts/src/StabrixRouter.sol`; pricing in `StabrixPricing.sol`, `StabrixMath.sol`, `StabrixBackstopPricing.sol` |
| Official router | The same pricing runs on 1inch's AquaSwapVMRouter `0x111111338c5091E8440b67B168bAe16a668AC0De` through Extruction (`StabrixExtruction.sol`, `StabrixBackstop.sol`) |
| Shared liquidity | One wallet backs an FX range and a backstop at once; the Liquidity page shows the shared liquidity ratio |
| Multi-token strategies | One strategy covers 8 coins and 56 swap directions; configs are packed to fit SwapVM's 255-byte instruction argument (`StabrixConfig.sol`, `StabrixBackstopConfig.sol`) |
| Real contracts, real tokens | `contracts/test/fork/BaseFork.t.sol` fills every pair on the official router with real EURC, BRZ and IDRX on a Base mainnet fork |

## Track: Chainlink, Best workflow with CRE

| What | Where |
|---|---|
| Workflow | `cre/depeg-sentinel/main.go` (cron, one Multicall3 read, two HTTP fetches with consensus, report, EVM write) |
| Policy | `cre/depeg-sentinel/policy.go`: 3% off peg halts, both sources past 0.75% halt, a halted coin resumes inside 0.25%. An offchain halt needs every configured API to agree; a Chainlink feed can halt alone. FX rates push on a 2 bp move or every 10 minutes |
| Consumer | `contracts/src/StabrixOracle.sol`: accepts reports only from the forwarder and the set workflow owner, uses a CRE rate only if fresh and within 0.5% of the Chainlink feed, refuses swaps on a stale feed, keeps guardian halts separate |
| Simulation | Run against the fork and a Base Sepolia fork with `--broadcast`; the reports change prices and halts onchain |

## Measured

All on a Base mainnet fork with real tokens and both 1inch routers, unless noted.

| | Result |
|---|---|
| 10,000 USDC to DAI | 9,986.96 DAI (0.13%), SDK quote equal to the chain to the wei |
| 5,000 USDC to EURC | 4,468.37 EURC, 0.23% against Chainlink EUR/USD, FX fee included |
| USDe falls to $0.93 | Ranges refuse USDe after the halt; backstop makers end +1.86% and +1.12% |
| EURC crashed 7% with the real CRE workflow | Halted ("offchain 700bps >= hard 300bps"), backstops bought 35,829 EURC up to their $20,000 caps, then a second run resumed it |
| Swaps through the app | Quoted amounts equal to the amounts received |
| Deploy | 16 transactions, 10,965,053 gas |

## Run it locally

Requirements: Foundry, Node 22+, Go 1.25+, the [CRE CLI](https://docs.chain.link/cre).

```bash
npm install
(cd contracts && npm install)

FORK_PORT=8556 DEPLOYMENT_NAME=base-fork-fx ./ops/devnet.sh
npm run price-api -w @stabrix/ops
cd app && NEXT_PUBLIC_DEV_ACCOUNTS=1 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8556 DEPLOYMENT_NAME=base-fork-fx npx next dev -p 3000
```

`devnet.sh` forks Base, deploys with the CRE simulation forwarder, ships three FX ranges and two backstops, and writes the fork CRE config. Fork accounts are anvil's public keys and only appear with `NEXT_PUBLIC_DEV_ACCOUNTS=1`. The fork freezes Chainlink's feeds while new blocks use the real clock, so FX swaps stop with a stale rate about 75 minutes after it starts; restart it before a demo.

Chainlink CRE on the fork (from `cre/`, after `cre login`, with `CRE_ETH_PRIVATE_KEY` in `cre/.env` set to a funded anvil key):

```bash
cre workflow simulate depeg-sentinel -T fork-settings --broadcast --non-interactive --trigger-index 0
```

The app has five pages: Swap, Liquidity (open FX ranges and pledge backstops), Pool (reserve mix, liquidity by depeg tolerance, every strategy), Activity (swaps, strategies and CRE reports read from the chain) and Depeg. The Depeg page crashes a coin through the local price API, shows this command, and charts every strategy while the workflow halts the coin and backstops buy it.

## Base Sepolia

1inch has not deployed Aqua or the SwapVM router on Base Sepolia, so the deploy script deploys their unmodified source next to Stabrix, with mock stablecoins and testnet FX feeds. Chainlink's CRE simulation forwarder is already there. This flow was rehearsed end to end on a local fork of Base Sepolia.

```bash
cd contracts
PRIVATE_KEY=<key> CRE_FORWARDER=0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5 \
CRE_WORKFLOW_OWNER=0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa \
  forge script script/Deploy.s.sol --tc Deploy --rpc-url https://sepolia.base.org --broadcast
cd ../ops
export RPC_URL=https://sepolia.base.org PRIVATE_KEY=<key>
npm run sync-feeds
npm run seed:testnet
npm run cre-config -- testnet
cd ../cre && cre workflow simulate depeg-sentinel -T testnet-settings --broadcast --non-interactive --trigger-index 0
```

This writes `deployments/84532.json`. `0xaAaA...aAaA` is the owner the CRE simulator reports as; a production deploy sets the real workflow owner instead. `sync-feeds` copies today's Base mainnet Chainlink EUR, BRL and IDR rates into the testnet feeds. With `--broadcast` the simulation sends a real transaction from `CRE_ETH_PRIVATE_KEY` in `cre/.env`, so on Base Sepolia that must be your own key with test ETH, never a public anvil key.

## Hosting

The app runs on Vercel's free tier with the project root set to `app`. The selected deployment file is bundled with the `/api/deployment` route.

| Variable | Testnet | Mainnet |
|---|---|---|
| `DEPLOYMENT_NAME` | `84532` | `8453` |
| `NEXT_PUBLIC_RPC_URL` | `https://sepolia.base.org` | `https://mainnet.base.org` |

## Tests

```bash
cd contracts && forge test
BASE_RPC_URL=https://mainnet.base.org forge test --match-path test/fork/BaseFork.t.sol
npm test -w @stabrix/sdk
cd cre/depeg-sentinel && go test ./...
```

Contracts: 71 local tests and 9 Base mainnet fork tests, with fuzzing for LP value, round trips, rate moves and wallet shortfalls. SDK: 144 tests, including byte-for-byte parity with Solidity on generated range and backstop cases. Workflow: 21 tests for the halt policy, price parsing, consensus masks and report encoding.

## Limitations

- Multi-token strategies rely on SwapVM v1.0.2, where the taker picks the token pair.
- One strategy holds at most 8 coins (9 on the Stabrix router) because SwapVM caps instruction arguments at 255 bytes; more coins mean more strategies, combined by the router.
- A range at its edge refuses its heaviest coin instead of trading along the boundary, and strategies are combined by routing rather than merged onchain.
- A production CRE deployment needs deploy access from Chainlink. Until then a mainnet oracle prices FX from Chainlink feeds, and halts come only from the guardian.
- Free price APIs rate limit; an offchain halt needs both, so a halt can be delayed while one is down. Chainlink feeds still halt on their own.
- Testnet coins are mocks, and testnet FX feeds hold the last synced mainnet rate.

## Credits and AI use

Pricing follows [Paradigm's research paper on AMMs for many stablecoins](https://www.paradigm.xyz/2025/06/orbital) by Dave White, Dan Robinson and Ciamac Moallemi. Code was written with Claude Code as a pair programmer; every number above comes from a test or a command in this repo.

## License

MIT for Stabrix code. 1inch SwapVM and Aqua are dependencies under their own licenses.
