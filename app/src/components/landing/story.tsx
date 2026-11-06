import katex from 'katex'
import Image from 'next/image'
import type { ReactNode } from 'react'
import { DepegChart, ImpactChart } from './charts'
import { Deployed } from './deployed'

const REPO = 'https://github.com/RudranshG07/stabrix'

function Tex({ children, display = false }: { children: string; display?: boolean }) {
  return <span dangerouslySetInnerHTML={{ __html: katex.renderToString(children, { displayMode: display, throwOnError: false, output: 'html' }) }} />
}

function Ink({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width="64"
      height="64"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

const ICONS = {
  ship: (
    <Ink>
      <path d="M12 40h40l-6 10H18zM32 10v30M32 12l14 20H32M32 18 20 32h12" />
    </Ink>
  ),
  orbit: (
    <Ink>
      <circle cx="32" cy="32" r="20" />
      <circle cx="32" cy="12" r="3.5" />
      <circle cx="51" cy="38" r="3.5" />
      <circle cx="19" cy="48" r="3.5" />
      <path d="M32 32 51 38" />
    </Ink>
  ),
  glass: (
    <Ink>
      <path d="M8 40 46 20M14 50 52 30" />
      <path d="M8 40l6 10M46 20l6 10" />
      <circle cx="54" cy="26" r="4" />
    </Ink>
  ),
  chest: (
    <Ink>
      <path d="M10 30h44v22H10zM10 30a22 14 0 0 1 44 0M28 34h8v8h-8z" />
    </Ink>
  ),
}

function SecHead({ eb, title, intro, id, logo }: { eb: string; title: ReactNode; intro?: ReactNode; id?: string; logo?: string }) {
  return (
    <header className="sec-head" id={id}>
      <p className="eb">
        {logo && <Image src={logo} alt="" width={44} height={44} />}
        {eb}
      </p>
      <h2>{title}</h2>
      {intro && <p className="intro">{intro}</p>}
    </header>
  )
}

const PROBLEMS: { id: string; tag: string; title: string; viz: ReactNode; tex: string; lead: string; facts: string[] }[] = [
  {
    id: 'locked',
    tag: 'Custody',
    title: 'Locked',
    viz: (
      <svg viewBox="0 0 280 120" aria-hidden>
        <rect x="14" y="30" width="96" height="62" rx="12" />
        <path d="M14 48h96M88 70h10" />
        <path d="M122 61h40m-10-9 10 9-10 9" />
        <rect x="176" y="40" width="90" height="56" rx="10" />
        <path d="M204 40v-10a17 17 0 0 1 34 0v10M221 62v12" />
      </svg>
    ),
    tex: '\\text{spendable} = \\text{balance} - \\text{deposited}',
    lead: 'Earning fees means handing your coins to a pool.',
    facts: ['A pool contract holds the deposit, not you', 'Withdraw before you can pay anyone', 'Each pool needs its own copy of your capital'],
  },
  {
    id: 'split',
    tag: '8 coins',
    title: 'Split',
    viz: (
      <svg viewBox="0 0 280 120" aria-hidden>
        {Array.from({ length: 28 }, (_, k) => (
          <rect key={k} x={14 + (k % 7) * 37} y={14 + Math.floor(k / 7) * 24} width="30" height="17" rx="5" />
        ))}
      </svg>
    ),
    tex: '\\tbinom{n}{2} = 28 \\text{ pools for } n = 8',
    lead: 'Pair pools split one basket into dozens of thin books.',
    facts: ['USDC to EURC cannot use USDC to DAI depth', 'Every new coin needs n minus 1 new pools', 'Each pool is thin where a dollar trades'],
  },
  {
    id: 'drained',
    tag: 'USDC $0.88 · March 2023',
    title: 'Drained',
    viz: (
      <svg viewBox="0 0 280 120" aria-hidden>
        <path d="M14 104h252M14 14v90" />
        <path d="M14 30h96l24 48 30 10h102" className="hot" />
        <path d="M14 98h112l20-34 30-22h90" />
      </svg>
    ),
    tex: '\\Delta V = x_{\\text{bad}}\\,(p - 1)',
    lead: 'When one coin breaks, the pool fills up with it.',
    facts: ['Traders dump the broken coin at par', 'Every unit absorbed loses 1 minus p', 'LPs end up holding the coin nobody wants'],
  },
]

const MATH: { title: string; tex: string; note: string }[] = [
  {
    title: 'One sphere, live rates',
    tex: '\\begin{gathered} \\sum_{k=1}^{n} (r - v_k)^2 = r^2 \\\\ v_k = x_k\\,\\rho_k + m \\end{gathered}',
    note: 'x is your Aqua balance of coin k, rho its USD rate from Chainlink CRE, m the floor that concentrates the range. Every coin trades against every other on one surface.',
  },
  {
    title: 'Sized from live balances',
    tex: 'r = \\frac{S + \\sqrt{S^2 - (n-1)\\,Q}}{n-1}',
    note: 'S and Q are the sum and the sum of squares of v. The radius is recomputed on every swap, so fees grow it and compound to the LP.',
  },
  {
    title: 'One square root per swap',
    tex: "v_j' = r - \\sqrt{r^2 - \\textstyle\\sum_{k \\ne j} (r - v_k')^2}",
    note: 'Only the two traded balances move, so the output is exact and in closed form, rounded in favor of the LP.',
  },
  {
    title: 'The edge',
    tex: '\\textstyle\\sum_k v_k > K\\,r \\;\\Rightarrow\\; \\text{refuse}',
    note: 'Past the edge a range refuses its heaviest coin and keeps trading the rest. Each width picks K: Tight stops at a 0.5% depeg, Balanced at 2%, Wide at 8%. An exposure cap limits how much of one coin a range can hold.',
  },
  {
    title: 'Never lose to a trade',
    tex: "r' \\ge r",
    note: "Checked after every fill on both routers. A swap that would shrink the LP's position reverts.",
  },
  {
    title: 'What a backstop pays',
    tex: '\\begin{gathered} p_{\\text{pay}} = \\min(p, p_{\\text{face}})\\,(1 - \\bar d) \\\\ \\bar d = d_0 + (d_1 - d_0)\\,\\frac{A + a/2}{C} \\end{gathered}',
    note: 'p comes from Chainlink CRE and the Chainlink market feed, A is what it already bought, a this sale, C its cap. Dormant until CRE halts the coin.',
  },
]

const VERSUS: [string, string, string, string, string][] = [
  ['Coins per pool', '2', '2 to 4', 'N', 'Up to 8 per strategy, routed together'],
  ['Concentrated liquidity', 'Yes', 'Amplified curve', 'Yes', 'Yes, three widths'],
  ['Where LP funds sit', 'Pool contract', 'Pool contract', 'v4 PoolManager', 'Your own wallet'],
  ['Spend while providing', 'No', 'No', 'No', 'Yes'],
  ['Non-USD stablecoins', 'One pair per pool', 'Separate pools', 'USD coins', 'EUR, BRL and IDR on one curve'],
  ['When a coin breaks', 'No protection', 'No protection', 'Range edge', 'Edge, Chainlink CRE halt, backstop'],
  ['Same capital, second job', 'No', 'No', 'No', 'Backstop on the same balance'],
  ['Venue', 'Uniswap', 'Curve', 'Uniswap v4 hook', '1inch Aqua, both routers'],
]

const REFERENCES: [string, string, string][] = [
  ['Paradigm', 'Research paper on AMMs for many stablecoins, 2025', 'https://www.paradigm.xyz/2025/06/orbital'],
  ['1inch', 'Aqua shared liquidity protocol', 'https://business.1inch.com/portal/documentation/overview/aqua'],
  ['1inch', 'SwapVM', 'https://github.com/1inch/swap-vm'],
  ['Chainlink', 'Runtime Environment (CRE)', 'https://docs.chain.link/cre'],
  ['Egorov', 'StableSwap, 2019', 'https://resources.curve.finance/pdf/stableswap-paper.pdf'],
]

const CHAPTERS: [string, string][] = [
  ['problem', 'The problem'],
  ['how', 'How it works'],
  ['math', 'The math'],
  ['see', 'See it'],
  ['aqua', 'Built for 1inch Aqua'],
  ['cre', 'Built for Chainlink CRE'],
  ['versus', 'Versus'],
  ['measured', 'Measured'],
  ['references', 'References'],
]

const STEPS = [
  {
    icon: ICONS.ship,
    tag: '1inch Aqua',
    title: 'Ship, never deposit',
    text: 'Your strategy is a set of virtual balances on Aqua. Coins stay in your wallet and move only when a trade fills, straight to the taker.',
  },
  {
    icon: ICONS.orbit,
    tag: 'SwapVM opcode 34',
    title: 'One curve, eight coins',
    text: "Sphere AMM math from Paradigm's research prices USDC, USDT, DAI, USDS, USDe, EURC, BRZ and IDRX on one curve, as a new SwapVM instruction with one square root per swap.",
  },
  {
    icon: ICONS.glass,
    tag: 'Chainlink CRE',
    title: 'Live FX from Chainlink',
    text: 'A CRE workflow pushes EUR, BRL and IDR rates, bounded onchain by Chainlink feeds. A stale rate stops the swap instead of mispricing it.',
  },
  {
    icon: ICONS.chest,
    tag: 'SwapVM opcode 35',
    title: 'When a coin breaks',
    text: 'CRE halts it on every range. Your backstop buys it at a discount you choose below market, paid from the same wallet balance that runs your FX range.',
  },
]

const AQUA = [
  {
    title: 'Shared liquidity',
    text: 'One wallet backs an FX range and a backstop at the same time. A $67 test wallet backed $108 of strategies: a 1.6x Shared Liquidity Ratio.',
  },
  {
    title: 'Two new instructions',
    text: 'StabrixTick (opcode 34) prices the sphere curve. StabrixBackstop (opcode 35) buys a depegged coin only while Chainlink says it is broken.',
  },
  {
    title: 'Your official router',
    text: "The same pricing runs on 1inch's AquaSwapVMRouter at 0x1111…C0De through Extruction, so any taker on the official router can fill it.",
  },
  {
    title: 'One trade, both routers',
    text: 'A batch taker splits each swap across every live strategy on our router and yours, settled in one transaction.',
  },
  {
    title: 'Multi-token strategies',
    text: 'One ship() covers 8 coins and 28 pairs. A wallet that spends its coins is skipped cleanly instead of failing the trade.',
  },
  {
    title: 'Tested on the real thing',
    text: 'All 56 swap directions filled on a Base mainnet fork against official Aqua and the official router, with real EURC, BRZ and IDRX.',
  },
]

const FLOW = [
  ['Cron', 'every 30 s'],
  ['One EVM read', '9 Chainlink feeds + oracle'],
  ['Two price APIs', 'median across nodes'],
  ['Policy', 'halt · resume · push rates'],
  ['Signed report', 'to StabrixOracle'],
  ['Every strategy', 'ranges and backstops'],
]

const LOG = [
  '$ cre workflow simulate depeg-sentinel -T fork-settings --broadcast',
  'EURC ref=1.116385 feed=1.117162 api=1.038238',
  '     halt=true  offchain 700bps >= hard 300bps',
  'USDe feed=0.998752  halt=false  back within resume band',
  'BRZ  ref=0.181687   halt=false  within peg',
  'oracle updated  pushed [USDe:false EURC:true BRZ:false IDRX:false]',
  'tx 0x3c298e53…bd63e5dc',
]

const CRE_FACTS = [
  'Rates must sit within 0.5% of the Chainlink feed onchain, or the feed wins.',
  'A halt needs both price APIs to agree, so one stale API cannot freeze a coin.',
  'Reports are refused until our workflow owner is set: no stranger can write.',
  'Guardian halts stay put even when a calm report arrives.',
]

const NUMBERS = [
  ['0.13%', 'cost of a 10,000 USDC to DAI swap, fees included'],
  ['0.23%', 'cost of a 5,000 USDC to EURC swap, FX fee included'],
  ['0', 'USDe bought by any range after the CRE halt'],
  ['+1.86%', 'backstop return from buying USDe at $0.93'],
  ['144', 'SDK tests, quotes equal to Solidity to the wei'],
  ['80', 'contract tests, 9 on official 1inch contracts on Base'],
]

export function Story() {
  return (
    <div className="story">
      <div className="idx" role="navigation" aria-label="Chapters">
        {CHAPTERS.map(([id, label], k) => (
          <a key={id} href={`#${id}`}>
            <span>{String(k + 1).padStart(2, '0')}</span>
            {label}
          </a>
        ))}
      </div>

      <section className="sec">
        <SecHead
          id="problem"
          eb="01 · The problem"
          title={
            <>
              Stablecoins{' '}
              <br />
              sit idle
            </>
          }
          intro="Stablecoins in wallets and treasuries earn nothing. Pools pay fees, but they take custody, split one basket into dozens of pairs, and fill up with the coin that breaks."
        />
        <div className="grid3">
          {PROBLEMS.map((c) => (
            <article key={c.id} className="ink-card prob">
              <p className="tag">{c.tag}</p>
              <h3>{c.title}</h3>
              <div className="viz">{c.viz}</div>
              <div className="formula">
                <Tex>{c.tex}</Tex>
              </div>
              <p>{c.lead}</p>
              <ol className="abc">
                {c.facts.map((f, k) => (
                  <li key={f}>
                    <span>{String.fromCharCode(65 + k)}</span>
                    {f}
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </section>

      <section className="sec">
        <SecHead
          id="how"
          eb="02 · How it works"
          title={
            <>
              Four moves,{' '}
              <br />
              one wallet
            </>
          }
          intro="Stabrix is an FX market made of wallets. You keep your coins, they earn spread, and when one coin breaks the same balance catches it."
        />
        <ol className="steps">
          {STEPS.map((st, k) => (
            <li key={st.title} className="ink-card step">
              <span className="num">{String(k + 1).padStart(2, '0')}</span>
              <span className="icon">{st.icon}</span>
              <span className="tag">{st.tag}</span>
              <h3>{st.title}</h3>
              <p>{st.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="sec">
        <SecHead
          id="math"
          eb="03 · The math"
          title={
            <>
              One curve,{' '}
              <br />
              every coin
            </>
          }
          intro="The pricing follows Paradigm's research on AMMs for many stablecoins, extended to live FX rates and written as two SwapVM instructions. These are the equations the contracts run."
        />
        <div className="math-grid">
          {MATH.map((m, k) => (
            <article key={m.title} className="ink-card flat eq">
              <p className="tag">{String(k + 1).padStart(2, '0')}</p>
              <h3>{m.title}</h3>
              <div className="formula big">
                <Tex display>{m.tex}</Tex>
              </div>
              <p>{m.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="sec">
        <SecHead
          id="see"
          eb="04 · See it"
          title={
            <>
              Run the curve{' '}
              <br />
              yourself
            </>
          }
          intro="Both charts are computed in your browser by the Stabrix SDK, which matches the contracts to the wei."
        />
        <div className="charts">
          <ImpactChart />
          <DepegChart />
        </div>
      </section>

      <section className="sec">
        <SecHead
          id="aqua"
          logo="/brand/1inch.png"
          eb="05 · Built for 1inch Aqua"
          title={
            <>
              Aqua, used the way{' '}
              <br />
              it was meant
            </>
          }
          intro="Aqua's promise is that one balance can back many strategies without being locked. Stabrix is built entirely on that promise."
        />
        <div className="grid3">
          {AQUA.map((c) => (
            <article key={c.title} className="ink-card flat">
              <h3>{c.title}</h3>
              <p>{c.text}</p>
            </article>
          ))}
        </div>
        <div className="arch" aria-label="How one trade flows through Stabrix">
          <div className="arch-row">
            <div className="node">
              <b>Trader</b>
              <span>the app or any taker</span>
            </div>
            <div className="node">
              <b>LP wallet</b>
              <span>ships strategies, keeps the coins</span>
            </div>
          </div>
          <p className="arch-link">one transaction</p>
          <div className="node strong">
            <b>StabrixBatchTaker</b>
            <span>splits the trade across every maker</span>
          </div>
          <p className="arch-link">each leg</p>
          <div className="arch-row">
            <div className="node">
              <b>StabrixRouter</b>
              <span>SwapVM, opcodes 34 and 35</span>
            </div>
            <div className="node">
              <b>1inch AquaSwapVMRouter</b>
              <span>official, through Extruction</span>
            </div>
          </div>
          <p className="arch-link">same pricing</p>
          <div className="node strong">
            <b>StabrixPricing · StabrixBackstopPricing</b>
            <span>checks the maker's wallet, asks the oracle</span>
          </div>
          <div className="arch-row">
            <div className="node">
              <b>1inch Aqua</b>
              <span>pulls from the maker's wallet on fill</span>
            </div>
            <div className="node">
              <b>StabrixOracle</b>
              <span>rates and halts from Chainlink CRE</span>
            </div>
          </div>
        </div>
      </section>

      <section className="sec">
        <SecHead
          id="cre"
          logo="/brand/chainlink.png"
          eb="06 · Built for Chainlink CRE"
          title={
            <>
              CRE runs the pool,{' '}
              <br />
              not just an alarm
            </>
          }
          intro="The workflow sets the FX rates every swap uses, and decides when a coin is broken. Without it, Stabrix cannot price a euro."
        />
        <ol className="flow">
          {FLOW.map(([a, b]) => (
            <li key={a}>
              <b>{a}</b>
              <span>{b}</span>
            </li>
          ))}
        </ol>
        <div className="cre-row">
          <pre className="term" aria-label="CRE simulation log">
            {LOG.join('\n')}
          </pre>
          <ul className="facts">
            {CRE_FACTS.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="sec">
        <SecHead
          id="versus"
          eb="07 · Versus"
          title={
            <>
              Where Stabrix{' '}
              <br />
              stands
            </>
          }
        />
        <div className="versus-wrap">
          <table className="versus">
            <thead>
              <tr>
                <th scope="col">Property</th>
                <th scope="col">Uniswap v3</th>
                <th scope="col">Curve</th>
                <th scope="col">Other builds of the paper</th>
                <th scope="col">Stabrix</th>
              </tr>
            </thead>
            <tbody>
              {VERSUS.map(([prop, ...cells]) => (
                <tr key={prop}>
                  <th scope="row">{prop}</th>
                  {cells.map((c, k) => (
                    <td key={`${prop}${k}`} className={k === 3 ? 'us' : undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sec">
        <SecHead
          id="measured"
          eb="08 · Measured, not promised"
          title={
            <>
              Real coins,{' '}
              <br />
              real numbers
            </>
          }
        />
        <div className="numbers">
          {NUMBERS.map(([n, t]) => (
            <div key={t}>
              <b>{n}</b>
              <span>{t}</span>
            </div>
          ))}
        </div>
        <p className="note-line">Measured on a Base mainnet fork with real coins and both 1inch routers.</p>
      </section>

      <Deployed />

      <section className="sec">
        <SecHead id="references" eb="09 · References" title="References" />
        <ol className="refs">
          {REFERENCES.map(([who, what, href], k) => (
            <li key={href}>
              <span>[{String(k + 1).padStart(2, '0')}]</span>
              <b>{who}</b>
              <a href={href} target="_blank" rel="noreferrer">
                {what} ↗
              </a>
            </li>
          ))}
        </ol>
      </section>

      <section className="sec cta">
        <h2>
          Put your coins{' '}
          <br />
          to work
        </h2>
        <div className="cta-row">
          <a href="/swap" className="pill">
            Open the app
          </a>
          <a href="/docs" className="pill ghost">
            Read the docs
          </a>
          <a href={REPO} className="pill ghost">
            Read the code
          </a>
        </div>
      </section>

      <footer className="foot">
        <span>Stabrix · MIT · ETHGlobal Mumbai</span>
        <span>1inch Aqua + SwapVM · Chainlink CRE · Base</span>
      </footer>
    </div>
  )
}
