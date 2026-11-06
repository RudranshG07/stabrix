# Demo script (under 3 minutes)

## Before recording

Start the fork no more than an hour before recording; its Chainlink feeds are frozen and FX swaps stop about 75 minutes after it starts.

```bash
FORK_PORT=8556 DEPLOYMENT_NAME=base-fork-fx ./ops/devnet.sh
npm run price-api -w @stabrix/ops
cd app && NEXT_PUBLIC_DEV_ACCOUNTS=1 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8556 DEPLOYMENT_NAME=base-fork-fx npx next dev -p 3000
```

Open http://localhost:3000. Keep a terminal open in `cre/`.

## Shots

| Time | Screen | Say |
|---|---|---|
| 0:00 | Landing hero, scroll to the storm | "Stablecoins in wallets earn nothing, because earning fees means locking them in a pool. And when one coin breaks, the pool fills up with it." |
| 0:15 | Liquidity, FX range form, pick coins | "On Stabrix your wallet is the pool. This is a 1inch Aqua strategy: one curve over eight stablecoins, dollars, euros, reais and rupiah, priced by a new SwapVM instruction. The coins never leave the wallet." |
| 0:35 | Liquidity, Backstop tab, then the wallet panel | "The same balance can also pledge a backstop. It does nothing until a coin breaks. Here one wallet backs both, that's the shared liquidity ratio." |
| 0:50 | Swap 1,000 USDC to EURC, point at the route | "A trade splits across makers on our router and 1inch's official router, in one transaction, at the Chainlink euro rate." |
| 1:10 | Depeg, pick EURC, Crash | "Now EURC breaks its peg. The price API sees it first." |
| 1:20 | Terminal: the CRE simulate command | "Our Chainlink CRE workflow reads the Chainlink feeds and two price APIs, agrees across nodes, and writes a signed report." |
| 1:40 | Depeg page, EURC tile turns Halted, event log | "EURC is halted on every range and both routers. Every other pair keeps trading." |
| 1:50 | Dump EURC | "Sellers can still exit, but only into backstops, below market and never above face value." |
| 2:05 | Strategy value chart, Who holds the risk | "Ranges stopped taking EURC. The backstops bought it at a discount, up to their caps." |
| 2:20 | Restore, run the CRE command again | "When the price returns, the same workflow lifts the halt." |
| 2:35 | README Measured table | "80 contract tests, 9 against 1inch's official contracts on Base, quotes equal to the chain to the wei. Liquidity that never leaves. Stabrix." |
