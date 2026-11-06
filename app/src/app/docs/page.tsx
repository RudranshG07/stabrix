import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { ReactNode } from 'react'
import { DocsDeployment } from '@/components/docs-deployment'

const CHAPTERS: [string, string][] = [
  ['overview', 'Overview'],
  ['quickstart', 'Quick start'],
  ['concepts', 'Concepts'],
  ['ranges', 'FX ranges'],
  ['backstops', 'Backstops'],
  ['routing', 'Routing'],
  ['fees', 'Fees'],
  ['math', 'Pricing math'],
  ['cre', 'Chainlink CRE'],
  ['app', 'Using the app'],
  ['contracts', 'Contracts'],
  ['networks', 'Networks'],
  ['sdk', 'SDK'],
  ['local', 'Run it locally'],
  ['errors', 'Errors'],
  ['security', 'Security model'],
  ['limits', 'Risks and limits'],
  ['faq', 'FAQ'],
]

function Tex({ children }: { children: string }) {
  return (
    <div
      className="my-4 overflow-x-auto rounded-xl border border-line px-4 py-3 text-center text-[15px]"
      dangerouslySetInnerHTML={{ __html: katex.renderToString(children, { displayMode: true, throwOnError: false, output: 'html' }) }}
    />
  )
}

function Section({ id, children }: { id: string; children: ReactNode }) {
  const k = CHAPTERS.findIndex(([c]) => c === id)
  return (
    <section id={id} className="scroll-mt-28 border-t border-line pt-10">
      <p className="num text-[13.5px] tracking-[0.08em] text-muted uppercase">{String(k + 1).padStart(2, '0')}</p>
      <h2 className="title mt-2 text-[20px] leading-none sm:text-[24px]">{CHAPTERS[k]![1]}</h2>
      <div className="mt-6 space-y-4">{children}</div>
    </section>
  )
}

function P({ children }: { children: ReactNode }) {
  return <p className="max-w-[46em] text-[14px] leading-relaxed">{children}</p>
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="pt-3 text-[12px] font-medium tracking-[0.08em] uppercase">{children}</h3>
}

function C({ children }: { children: ReactNode }) {
  return <code className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[0.82em] break-all">{children}</code>
}

function List({ items, ordered = false }: { items: ReactNode[]; ordered?: boolean }) {
  return (
    <ol className="max-w-[46em] space-y-2 text-[14px] leading-relaxed">
      {items.map((it, k) => (
        <li key={k} className="relative pl-7">
          {ordered ? (
            <span className="num absolute top-0 left-0 text-[14px] text-muted">{k + 1}.</span>
          ) : (
            <span className="absolute top-[0.6em] left-1 size-1.5 rounded-full bg-current" aria-hidden />
          )}
          {it}
        </li>
      ))}
    </ol>
  )
}

function Table({ head, rows, mono = false }: { head: string[]; rows: ReactNode[][]; mono?: boolean }) {
  return (
    <div className="ink-card overflow-x-auto">
      <table className="w-full min-w-[560px] text-left">
        <thead>
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} scope="col" className="px-5 py-3 text-[10.5px] font-medium tracking-[0.08em] text-muted uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k} className="border-b border-line last:border-0">
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={`px-5 py-3 align-top ${j === 0 ? 'text-[13.5px] font-medium' : mono ? 'font-mono text-[12px] break-all' : 'text-[14px]'}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-line bg-ink p-5 font-mono text-[12px] leading-relaxed text-on-accent">
      {children}
    </pre>
  )
}

function QA({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div className="ink-card p-5">
      <p className="text-[13.5px] font-medium">{q}</p>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">{children}</p>
    </div>
  )
}

const SDK = `import { StabrixClient, WAD } from '@stabrix/sdk'

const client = new StabrixClient(publicClient, deployment)

const market = await client.market()
const quote = client.quoteExactIn(market, USDC, EURC, 1_000_000_000n)
const { hash, amountOut } = await client.swap(wallet, quote, 30)

const range = client.buildRange('balanced', 1_000n * WAD, { tokens: [USDC, USDT, EURC] })
await client.ship(wallet, range, 1_000n * WAD, { kind: 'native' })

const backstop = client.buildBackstop(200, 1000, 20_000n * WAD)
await client.shipBackstop(wallet, backstop, pledges, { kind: 'native' })

const status = await client.oracleStatus()
await client.dock(wallet, strategy)`

const LOCAL = `npm install
(cd contracts && npm install)

FORK_PORT=8556 DEPLOYMENT_NAME=base-fork-fx ./ops/devnet.sh
npm run price-api -w @stabrix/ops
cd app && NEXT_PUBLIC_DEV_ACCOUNTS=1 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8556 \\
  DEPLOYMENT_NAME=base-fork-fx npx next dev -p 3000

cd cre && cre workflow simulate depeg-sentinel -T fork-settings --broadcast \\
  --non-interactive --trigger-index 0

cd contracts && forge test
npm test -w @stabrix/sdk
cd cre/depeg-sentinel && go test ./...`

const FEEDS: [string, string, string][] = [
  ['EUR / USD', '0xc91D87E81faB8f93699ECf7Ee9B44D11e1D53F0F', 'EURC rate'],
  ['BRL / USD', '0x0b0E64c05083FdF9ED7C5D3d8262c4216eFc9394', 'BRZ rate'],
  ['IDR / USD', '0x05A6cF213EcC5501A11a08EBefA4A8a60313ef97', 'IDRX rate'],
  ['EURC / USD', '0x9867186e52d2F1C2c565CDA6E747101Fa56501e0', 'EURC depeg check'],
  ['USDC / USD', '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B', 'USDC depeg check'],
  ['USDT / USD', '0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9', 'USDT depeg check'],
  ['DAI / USD', '0x591e79239a7d679378eC8c847e5038150364C78F', 'DAI depeg check'],
  ['USDS / USD', '0x2330aaE3bca5F05169d5f4597964D44522F62930', 'USDS depeg check'],
  ['USDe / USD', '0x790181e93e9F4Eedb5b864860C12e4d2CffFe73B', 'USDe depeg check'],
]

const TOKENS: [string, string, string][] = [
  ['USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', '6'],
  ['USDT', '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', '6'],
  ['DAI', '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', '18'],
  ['USDS', '0x820C137fa70C8691f0e44Dc420a5e53c168921Dc', '18'],
  ['USDe', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34', '18'],
  ['EURC', '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', '6'],
  ['BRZ', '0xE9185Ee218cae427aF7B9764A011bb89FeA761B4', '18'],
  ['IDRX', '0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22', '2'],
]

export default function DocsPage() {
  return (
    <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-28 lg:max-h-[calc(100dvh-8rem)] lg:self-start lg:overflow-y-auto">
        <p className="num text-[14px] tracking-[0.08em] uppercase">Stabrix · Docs</p>
        <nav aria-label="Docs chapters" className="ink-card mt-4 p-3 lg:mt-6">
          <ol className="grid grid-cols-2 gap-x-3 lg:grid-cols-1">
            {CHAPTERS.map(([id, label], k) => (
              <li key={id}>
                <a href={`#${id}`} className="flex items-baseline gap-2.5 rounded-xl px-2.5 py-1.5 text-[13px] transition-colors hover:bg-surface-hover">
                  <span className="text-[10px] font-medium tracking-[0.08em] text-muted">{String(k + 1).padStart(2, '0')}</span>
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </aside>

      <article className="min-w-0 space-y-14">
        <header>
          <h1 className="title text-[24px] leading-[0.95] sm:text-[28px]">Documentation</h1>
          <p className="mt-4 max-w-[40em] text-[15px] leading-snug text-muted">
            How Stabrix prices stablecoin FX on 1inch Aqua, protects liquidity providers when a coin breaks, and uses Chainlink CRE for rates and halts.
          </p>
        </header>

        <Section id="overview">
          <P>
            Stabrix turns any wallet holding stablecoins into a market maker without a deposit. A liquidity provider (a maker) ships strategies to 1inch Aqua. Aqua only
            records what each strategy may use; tokens leave the wallet only when a trade fills, straight to the trader.
          </P>
          <P>One wallet balance can do two jobs at once:</P>
          <List
            items={[
              <>
                <b>FX range</b> (SwapVM opcode 34). One strategy prices up to 8 stablecoins on one curve: USDC, USDT, DAI, USDS and USDe at $1, and EURC, BRZ and IDRX at
                live euro, real and rupiah rates. It earns a fee on every trade it fills.
              </>,
              <>
                <b>Backstop</b> (SwapVM opcode 35). Dormant while every coin is healthy. When Chainlink CRE halts a coin, it buys that coin below market and pays in healthy
                coins, never above face value.
              </>,
            ]}
          />
          <P>
            A Chainlink CRE workflow sets the FX rates every swap uses and decides when a coin is broken. Trades are split across every maker and settle on both the
            Stabrix router and 1inch&apos;s official router in one transaction.
          </P>
          <H3>A worked example</H3>
          <P>
            On our Base mainnet fork, one maker wallet holds $320,019 in eight stablecoins. It runs a Tight FX range worth $320,019 and, from the same balance, a backstop
            pledging $60,000 of USDC and USDT. That is $380,019 of strategies on a $320,019 wallet: a shared liquidity ratio of 1.19x, with every coin still in the wallet.
          </P>
        </Section>

        <Section id="quickstart">
          <List
            ordered
            items={[
              'Connect a wallet on Base. If your wallet does not know the network, the app offers to add it.',
              'Swap: pick two coins and an amount. Check the route, the rate and "Value vs Chainlink", choose a slippage limit, then Swap. The first trade in a coin asks for one approval.',
              'Provide: on Liquidity, choose FX range, pick the coins you hold (two or more), a width and a venue, and a dollar amount per coin. Open FX range approves Aqua for each coin, then ships the strategy. Nothing leaves your wallet.',
              'Insure: on Liquidity, choose Backstop, pick the coins you pay out in, a discount preset, the pledge per coin and a cap per halted coin, then Pledge backstop.',
              'Watch: Pool shows totals, depth and fees; Activity shows every fill, strategy change and Chainlink CRE report. Close any strategy from Liquidity at any time.',
            ]}
          />
        </Section>

        <Section id="concepts">
          <Table
            head={['Term', 'Meaning']}
            rows={[
              ['Maker', 'A wallet that ships strategies. It keeps its coins and can spend them at any time.'],
              ['Taker', 'Anyone who trades against strategies, through the app, the batch taker or a router directly.'],
              [<C key="s">ship</C>, 'Registers a strategy on Aqua with the amounts it may use. Nothing is transferred.'],
              [<C key="d">dock</C>, 'Closes a strategy. Aqua forgets its amounts; there is nothing to withdraw.'],
              [<C key="p">pull / push</C>, 'During a fill Aqua pulls the output coin from the maker wallet to the taker and pushes the input coin into the maker wallet.'],
              ['Strategy balance', "Aqua's record of what a strategy may still use. It moves with every fill, so it is the range's live reserves."],
              ['Venue', 'Where a strategy is priced: the Stabrix router (native opcodes) or 1inch AquaSwapVMRouter (through Extruction).'],
              ['Shared liquidity ratio', 'Value of all strategies a wallet backs, divided by the value of the wallet. Above 1 means one balance is doing more than one job.'],
              ['Spendable', "The lower of a maker's wallet balance and its Aqua allowance. A fill never asks for more; the router skips a maker that is short."],
              ['Halt', 'A flag on a coin set by Chainlink CRE or the guardian. Ranges refuse a halted coin as input; only backstops buy it.'],
            ]}
          />
          <H3>Strategy lifecycle</H3>
          <List
            ordered
            items={[
              'Approve Aqua for each coin the strategy may pay out.',
              <>
                <C>ship</C> the strategy with its program (the opcode and packed config) and the amount for each coin.
              </>,
              'Takers fill it. Each fill moves the strategy balance and the actual coins in the same transaction.',
              <>
                <C>dock</C> it whenever you want. Docking only clears the record; your coins never left.
              </>,
            ]}
          />
        </Section>

        <Section id="ranges">
          <P>
            A range is a concentrated position on a sphere over the coins you pick (2 to 8). Each coin counts at its USD value: $1 for the dollar coins, the live rate for
            EURC, BRZ and IDRX. Every coin trades against every other, so n coins give n × (n − 1) swap directions from one position.
          </P>
          <Table
            head={['Width', 'Capital efficiency', 'Edge at', 'Fee, USD pairs', 'Fee, FX pairs']}
            rows={[
              ['Tight', '301x', '0.5% depeg', '0.01%', '0.05%'],
              ['Balanced', '61x', '2.0% depeg', '0.04%', '0.10%'],
              ['Wide', '11x', '8.0% depeg', '0.10%', '0.30%'],
            ]}
          />
          <P>
            Capital efficiency comes from a floor added to every balance: the range behaves like a pool many times its size near the peg, and runs out of depth sooner when a
            coin drifts. On a pool with $1M per coin, a $10k trade moves the price 0.41 bps in a Tight range, 2.0 in Balanced, 11 in Wide, and 122 with no concentration.
          </P>
          <H3>The edge and the exposure cap</H3>
          <P>
            When a coin floods into a range, the range reaches its edge and refuses that coin, while every other pair keeps trading. An exposure cap limits how much of any
            one coin a range can end up holding: 2 / n of its value by default (25% with 8 coins, 40% with 5). In a crash to $0.80, a Tight range loses 7.85% with the edge
            against 19.3% without it, while simply holding the five coins loses 4%.
          </P>
          <H3>Spending while providing</H3>
          <P>
            You can spend from your wallet at any time. A fill checks your live balance and allowance first; if you no longer hold enough of the output coin, the router
            routes around you instead of failing the trade. Your range keeps quoting the coins you still hold.
          </P>
          <H3>Currency risk</H3>
          <P>
            A range that includes EURC, BRZ or IDRX ends up holding some of them as trades flow through. If the euro, real or rupiah falls against the dollar, so does the
            dollar value of the range. A range over dollar coins only has no currency risk, only depeg risk.
          </P>
        </Section>

        <Section id="backstops">
          <P>
            A backstop pledges payout coins (for example USDC and USDT) and covers every coin in the pool, payout coins included: if USDC halts, it pays in USDT, and the USDC it already holds counts toward the cap. It does nothing until Chainlink CRE or the guardian halts a
            coin. Then it buys that coin, exact input only, and pays in a healthy coin.
          </P>
          <Table
            head={['Preset', 'Discount when empty', 'Discount when full', 'Pays at a $0.93 depeg']}
            rows={[
              ['Light', '1%', '5%', '$0.921 to $0.884'],
              ['Standard', '2%', '10%', '$0.911 to $0.837'],
              ['Deep', '5%', '25%', '$0.884 to $0.698'],
            ]}
          />
          <List
            items={[
              'The price is the depeg market price (the lower of the fresh CRE price and the Chainlink market feed) minus the discount, and never above face value.',
              'The cap is per halted coin, in USD at face value. The discount grows linearly as the cap fills, so the first sellers get the best price.',
              'Discounts can be set up to 50%. A halted coin is never paid out.',
              'The coins it buys land in your wallet. If the coin recovers, they are worth face value again and the backstop has earned its discount; if it keeps falling, the backstop loses.',
              'On our fork, a USDe crash to $0.93 left the two backstops up 1.86% and 1.12%.',
            ]}
          />
        </Section>

        <Section id="routing">
          <List
            items={[
              "The SDK finds every live strategy from Aqua's Shipped and Docked events, reads their balances, each maker's spendable amounts and the oracle prices.",
              'For a healthy input coin only FX ranges quote. For a halted input coin only backstops quote.',
              'The trade is cut into 64 slices. Each slice goes to the strategy that pays the most for it; slices halve near the limits so nothing is left unfilled that could be filled.',
              "A strategy drops out when the next slice would hit its edge, its exposure cap, or the maker's spendable balance. Your own strategies are skipped when you trade.",
              'StabrixBatchTaker pulls the total input once, fills every leg on its router, then checks your minimum output and a 10 minute deadline. Either every leg fills or the whole trade reverts.',
              'Because the SDK runs the same bigint math as the contracts, quotes equal on-chain results to the wei.',
            ]}
          />
        </Section>

        <Section id="fees">
          <List
            items={[
              'Each range charges its width fee on the input of every fill: 0.01%, 0.04% or 0.10% when both coins are dollar coins, and 0.05%, 0.10% or 0.30% when either is EURC, BRZ or IDRX.',
              'The whole input lands in the maker wallet while the price is computed on the input after the fee, so the fee grows the range and compounds to the LP.',
              'Stabrix takes no protocol fee and has no token.',
              'Backstops do not charge a fee; they earn their discount.',
              "The Pool page sums fees paid to LPs over the last 24 hours, fill by fill, from the routers' Swapped events.",
            ]}
          />
        </Section>

        <Section id="math">
          <P>
            The pricing follows Paradigm&apos;s research on AMMs for many stablecoins, extended to live FX rates. For a range over n coins, with Aqua balance x, USD rate
            rho and floor m:
          </P>
          <Tex>{'\\sum_{k=1}^{n} (r - v_k)^2 = r^2 \\qquad v_k = x_k\\,\\rho_k + m'}</Tex>
          <P>The radius is recomputed from live balances on every swap, so fees grow it and compound to the LP. S and Q are the sum and the sum of squares of v:</P>
          <Tex>{'r = \\frac{S + \\sqrt{S^2 - (n-1)\\,Q}}{n-1}'}</Tex>
          <P>Only the two traded balances move, so the output is one square root in closed form, rounded in favor of the LP:</P>
          <Tex>{"v_j' = r - \\sqrt{r^2 - \\textstyle\\sum_{k \\ne j} (r - v_k')^2}"}</Tex>
          <P>At the centre every coin trades at its USD rate; the price of coin i in coin j is</P>
          <Tex>{'p_{ij} = \\frac{r - v_i}{r - v_j} \\cdot \\frac{\\rho_i}{\\rho_j}'}</Tex>
          <P>Edge, LP safety and the backstop price:</P>
          <Tex>{"\\textstyle\\sum_k v_k > K\\,r \\;\\Rightarrow\\; \\text{refuse} \\qquad r' \\ge r"}</Tex>
          <Tex>{'p_{\\text{pay}} = \\min(p, p_{\\text{face}})\\,(1 - \\bar d) \\qquad \\bar d = d_0 + (d_1 - d_0)\\,\\frac{A + a/2}{C}'}</Tex>
          <P>
            A is what the backstop already absorbed, a the incoming sale and C its cap. Rates are scaled to 18 decimals per token, so IDRX (2 decimals), USDC (6) and DAI
            (18) price on the same curve.
          </P>
        </Section>

        <Section id="cre">
          <P>
            The workflow (<C>cre/depeg-sentinel</C>, Go) runs every 30 seconds. It reads every oracle status and Chainlink feed in one Multicall3 call, fetches CoinGecko and
            DefiLlama with a median across nodes, decides, and writes one signed report to <C>StabrixOracle</C>.
          </P>
          <Table
            head={['Rule', 'Value']}
            rows={[
              ['Halt', 'Every configured API at least 3% off peg, or the Chainlink feed alone at least 3% off'],
              ['Soft halt', 'Both the APIs and the Chainlink feed at least 0.75% off'],
              ['Resume', 'The closest API quote and the Chainlink feed back within 0.25% of peg'],
              ['Rate push', 'On a 2 bp move, or every 10 minutes'],
              ['Peg reference', '$1 for dollar coins; the Chainlink EUR, BRL or IDR rate for FX coins'],
              ['Reported price', 'Healthy: the API quote closest to the reference. Halted: the lowest market price, the safe side for backstops'],
            ]}
          />
          <H3>Price used for each coin</H3>
          <Table
            head={['Coin', 'Swaps', 'When halted']}
            rows={[
              ['USDC, USDT, DAI, USDS, USDe', '$1', 'Refused as input; backstops buy at the lower of the CRE price and the Chainlink market feed'],
              ['EURC, BRZ, IDRX', 'CRE rate if under 15 minutes old and within 0.5% of the Chainlink feed, else the feed; a feed older than 75 minutes pauses swaps', 'Same as above'],
            ]}
          />
          <H3>What the oracle accepts</H3>
          <List
            items={[
              'Reports only from the Chainlink forwarder and only from the set workflow owner. Before an owner is set, every report is refused.',
              'Reports stamped more than 5 minutes in the future are refused. Older reports never overwrite newer ones.',
              'A guardian can halt or resume a coin by hand. A calm CRE report does not lift a guardian halt.',
            ]}
          />
          <H3>A halt, step by step</H3>
          <List
            ordered
            items={[
              'A coin trades 3% or more off peg on every API, or on Chainlink.',
              'The next run writes a report marking it halted, at its lowest market price.',
              'Every range on both routers refuses the coin as input; healthy pairs keep trading.',
              'Backstops start buying it below market, until their caps fill.',
              'When the price is back within 0.25%, a later run lifts the halt and ranges accept the coin again.',
            ]}
          />
        </Section>

        <Section id="app">
          <Table
            head={['Page', 'What it does']}
            rows={[
              ['Swap', 'Quotes any pair, splits the trade across makers on both routers, and shows the route, the rate and the value against Chainlink. A halted coin can only be sold to backstops.'],
              ['Liquidity', 'Open an FX range over coins you hold, or pledge a backstop. Shows your wallet, the shared liquidity ratio and your strategies, each with Close.'],
              ['Pool', 'Totals, 24 hour volume and fees, depth of any coin by price drop, reserve mix, liquidity by depeg tolerance, the orbit map and every strategy.'],
              ['Activity', 'Swaps, strategies opened or closed, and Chainlink CRE and guardian events, read from the chain, with explorer links.'],
              ['Depeg', 'Local fork only. Crashes a coin through a local price API, runs the real CRE workflow and dumps the coin, to show ranges refuse it and backstops buy it.'],
            ]}
          />
        </Section>

        <Section id="contracts">
          <Table
            head={['Contract', 'Role']}
            rows={[
              ['StabrixRouter', 'SwapVM v1.0.2 Aqua router with two new instructions: StabrixTick (opcode 34) and StabrixBackstop (opcode 35).'],
              ['StabrixExtruction', 'Range pricing for the official 1inch router, reached through Extruction (opcode 32).'],
              ['StabrixBackstop', 'Backstop pricing for both routers.'],
              ['StabrixOracle', 'Chainlink CRE consumer: rates, halts, depeg prices, feed bounds and guardian.'],
              ['StabrixBatchTaker', 'Fills many legs across both routers in one transaction with a minimum output and deadline.'],
              ['StabrixLens', 'Builds orders and reads strategy balances and spendable amounts.'],
            ]}
          />
          <P>
            SwapVM caps instruction arguments at 255 bytes, so configs are packed. A range is n, the token addresses, their decimals, the floor (16 bytes), the edge ratio (8),
            the USD fee (2), the FX fee (2), the exposure cap (2) and the oracle (20): 1 + 21n + 50 bytes. A backstop swaps the range fields for the two discounts and the cap:
            1 + 21n + 40 bytes. That allows 9 coins on the Stabrix router and 8 through Extruction, where the target address takes 20 more bytes.
          </P>
          <H3>This app&apos;s deployment</H3>
          <DocsDeployment />
        </Section>

        <Section id="networks">
          <H3>Base mainnet, 1inch and Chainlink</H3>
          <Table
            mono
            head={['Contract', 'Address']}
            rows={[
              ['1inch Aqua', '0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a'],
              ['1inch AquaSwapVMRouter', '0x111111338c5091E8440b67B168bAe16a668AC0De'],
              ['Chainlink CRE forwarder', '0xF8344CFd5c43616a4366C34E3EEE75af79a74482'],
              ['Multicall3', '0xcA11bde05977b3631167028862bE2a173976CA11'],
            ]}
          />
          <H3>Coins on Base</H3>
          <Table mono head={['Coin', 'Address', 'Decimals']} rows={TOKENS} />
          <H3>Chainlink feeds on Base</H3>
          <Table mono head={['Feed', 'Address', 'Used for']} rows={FEEDS} />
          <H3>Base Sepolia</H3>
          <P>
            1inch has not deployed Aqua or the SwapVM router on Base Sepolia, so the deploy script deploys their unmodified source next to Stabrix, with test coins and
            testnet FX feeds synced from Base mainnet Chainlink. Chainlink&apos;s CRE simulation forwarder is <C>0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5</C>.
          </P>
        </Section>

        <Section id="sdk">
          <P>
            <C>@stabrix/sdk</C> (TypeScript, viem) reads the market, quotes, routes and ships. Amounts are bigints in token units; USD amounts use 18 decimals.
          </P>
          <Code>{SDK}</Code>
          <Table
            head={['Method', 'Does']}
            rows={[
              [<C key="1">market()</C>, 'Every live range and backstop with balances, spendable amounts and oracle prices'],
              [<C key="2">quoteExactIn(market, in, out, amount)</C>, 'The best split across strategies, with each leg'],
              [<C key="3">swap(wallet, quote, slippageBps)</C>, 'Approves if needed and settles the quote through the batch taker'],
              [<C key="4">buildRange(width, usdPerCoin, opts)</C>, 'A range config for the chosen coins, width, exposure cap and oracle'],
              [<C key="5">ship(wallet, config, usdPerCoin, venue)</C>, 'Approves Aqua and ships the range at live prices'],
              [<C key="6">buildBackstop(start, end, cap)</C>, 'A backstop config over every coin'],
              [<C key="7">shipBackstop(wallet, config, pledges, venue)</C>, 'Approves and ships a backstop'],
              [<C key="8">dock(wallet, strategy)</C>, 'Closes a strategy'],
              [<C key="9">oracleStatus()</C>, 'CRE and guardian halt flags and the last reported price for each coin'],
            ]}
          />
        </Section>

        <Section id="local">
          <P>Requirements: Foundry, Node 22 or newer, Go 1.25 or newer, and the Chainlink CRE CLI.</P>
          <Code>{LOCAL}</Code>
          <P>
            The fork freezes Chainlink&apos;s feeds while new blocks use the real clock, so FX swaps pause with a stale rate about 75 minutes after it starts. Restart it before
            a demo.
          </P>
        </Section>

        <Section id="errors">
          <Table
            head={['Error', 'Meaning']}
            rows={[
              [<C key="h">Halted</C>, 'Chainlink CRE or the guardian halted this coin. Ranges refuse it; only backstops buy it.'],
              [<C key="s">StaleRate</C>, 'A Chainlink FX rate is too old, so ranges with that coin pause.'],
              [<C key="e">RangeEdge</C>, 'The range reached its edge for this coin.'],
              [<C key="x">ExposureCap</C>, 'The fill would push one coin past its share of the range.'],
              [<C key="i">InsufficientLiquidity</C>, 'The maker no longer holds or allows enough of the output coin.'],
              [<C key="r">OutOfRange</C>, 'The trade is larger than the range can price.'],
              [<C key="b">BackstopFull</C>, 'The backstop cap for this coin is used up.'],
              [<C key="n">NotDepegged</C>, 'Backstops only buy halted coins.'],
              [<C key="p">PayoutHalted</C>, 'Backstops never pay out a halted coin.'],
              [<C key="a">ExactInOnly</C>, 'Backstops only take exact-input trades.'],
              [<C key="o">InsufficientOutput</C>, 'The trade moved past your slippage limit.'],
              [<C key="d">Expired</C>, 'The 10 minute deadline passed. Quote again.'],
              [<C key="v">ValueDecreased</C>, 'The fill would shrink the LP position, so it reverts.'],
              [<C key="w">UnauthorizedWorkflowOwner</C>, 'A report came from a workflow that is not the set owner.'],
            ]}
          />
        </Section>

        <Section id="security">
          <List
            items={[
              'Funds move only inside a fill, priced by the contracts, from a maker wallet to a taker and back. No admin function can move maker coins.',
              'Every fill re-derives the range and reverts if the LP position would shrink.',
              'The oracle owner sets feeds, staleness limits, the forwarder and the workflow owner, and acts as guardian. A wrong feed could misprice FX ranges, so on mainnet the owner should be a multisig.',
              'Chainlink CRE reports are accepted only from the forwarder and only from the set workflow owner.',
              'The routers can only rescue tokens held by the router itself; in normal use they hold none.',
              'The contracts are not audited.',
            ]}
          />
        </Section>

        <Section id="limits">
          <List
            items={[
              'Multi-token strategies rely on SwapVM v1.0.2, where the taker picks the token pair.',
              'One strategy holds at most 8 coins through the official router (9 natively). More coins means more strategies, combined by routing.',
              'A range at its edge refuses its heaviest coin instead of trading along the boundary.',
              'Production CRE needs deploy access from Chainlink. Without it, FX rates come from Chainlink feeds and halts only from the guardian.',
              'Free price APIs rate limit. An API halt needs every API to agree, so it can be delayed while one is down; Chainlink feeds still halt alone.',
              'Each leg of a trade costs gas, so the router favors larger strategies. Small strategies are filled less often.',
              'Liquidity outside EURC is thin on Base today: BRZ and IDRX supply is small.',
            ]}
          />
        </Section>

        <Section id="faq">
          <div className="grid gap-4 md:grid-cols-2">
            <QA q="Do my coins leave my wallet?">Only when a trade fills, and only the output coin of that trade, straight to the trader.</QA>
            <QA q="Can I spend while providing?">Yes. Fills check your live balance first and route around you if you are short.</QA>
            <QA q="Can I lose money?">
              Yes, through a coin that depegs before your edge, through currency moves if you hold EURC, BRZ or IDRX, or through a backstop buying a coin that keeps falling.
              A single trade can never shrink your position.
            </QA>
            <QA q="What if Chainlink CRE stops?">
              FX rates fall back to Chainlink feeds, ranges keep trading, and a stale feed pauses FX swaps instead of mispricing them. Halts then come only from the guardian.
            </QA>
            <QA q="Who pays gas?">Takers pay for swaps. Makers pay for approvals, ship and dock. Nobody pays to keep a strategy open.</QA>
            <QA q="Why at most 8 coins in one strategy?">SwapVM caps instruction arguments at 255 bytes. More coins are covered by more strategies, combined by the router.</QA>
            <QA q="Is there a token or a protocol fee?">No. LPs keep every fee their ranges earn.</QA>
            <QA q="What is Extruction?">A SwapVM instruction that calls out to another contract for pricing. It lets 1inch&apos;s official router price Stabrix strategies.</QA>
          </div>
        </Section>
      </article>
    </div>
  )
}
