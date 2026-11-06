import katex from 'katex'
import 'katex/dist/katex.min.css'
import Link from 'next/link'
import { FeatureCards } from '@/components/trace/feature-cards'
import { Marquee } from '@/components/trace/marquee'
import { type CardStep, StepCard } from '@/components/trace/step-card'
import './trace-landing.css'

const REPO = 'https://github.com/RudranshG07/stabrix'

const lifecycle: { kicker: string; tex: string[]; note: string }[] = [
  {
    kicker: '00 — the pool',
    tex: ['\\sum_{i=1}^{5} (r - v_i)^2 = r^2'],
    note: 'Five stablecoins share one Orbital sphere. Every pair trades against the same liquidity, so a USDC to DAI swap can use depth that a separate pool would never see.',
  },
  {
    kicker: '01 — the range',
    tex: ['v_k = x_k\\,\\rho_k + m'],
    note: 'An LP picks Tight, Balanced or Wide. The floor m lifts every balance, so the LP deposits only what can actually trade. Tight is 31x capital efficiency.',
  },
  {
    kicker: '02 — the wallet',
    tex: ['\\text{allowance}_k \\le \\text{balance}_k'],
    note: 'The range is a 1inch Aqua strategy. Aqua records what it may use and pulls tokens only when a trade fills. Nothing is deposited, and one balance can back several ranges.',
  },
  {
    kicker: '03 — the radius',
    tex: ['r = \\dfrac{S + \\sqrt{S^2 - (n-1)\\,Q}}{n-1}'],
    note: 'Aqua strategies are immutable, so the sphere is derived from live balances on every swap. S is the sum, Q the sum of squares. Fees grow r and compound to the LP.',
  },
  {
    kicker: '04 — the price',
    tex: ["v_j' = r - \\sqrt{r^2 - \\sum_{k \\ne j} (r - v_k')^2}"],
    note: 'Only the two traded balances move, so the output is one square root in closed form. Opcode 34 in SwapVM runs it with rounding that always favors the LP.',
  },
  {
    kicker: '05 — the split',
    tex: ['\\sum_{\\ell} a_\\ell = a,\\quad \\text{one transaction}'],
    note: "The SDK finds every live range and sends each chunk where it pays most. One batch fills every leg on the Stabrix router and on 1inch's official SwapVM router.",
  },
  {
    kicker: '06 — the edge',
    tex: ['\\textstyle\\sum v_k > K\\,r \\;\\Rightarrow\\; \\text{refuse heaviest}'],
    note: 'USDe breaks its peg and arbitrageurs dump it. Each range reaches its edge and refuses the coin flooding in, while every other pair keeps trading.',
  },
  {
    kicker: '07 — the halt',
    tex: ['|p - 1| \\ge 3\\% \\;\\Rightarrow\\; \\text{halt}'],
    note: 'A Chainlink CRE workflow reads the Chainlink feeds and a price API, agrees across nodes, and writes a signed report. Every range on both routers refuses the halted coin.',
  },
  {
    kicker: '08 — the guard',
    tex: ["r' \\ge r"],
    note: 'Every swap re-derives the radius after the trade and reverts if it would shrink. 20,000 fuzzed swap sequences, zero losses to a trade.',
  },
  {
    kicker: '09 — the result',
    tex: ['\\Delta V_{\\text{edge}} = -4.4\\% \\quad \\text{vs} \\quad \\Delta V_{\\text{open}} = -12.3\\%'],
    note: 'At USDe $0.80 a Tight range loses 4.4%, close to the 4.0% of simply holding the coin. The same range without an edge loses 12.3%. Same math as the contracts.',
  },
]

const steps: CardStep[] = lifecycle.map((step) => ({
  kicker: step.kicker,
  note: step.note,
  html: step.tex.map((tex) => katex.renderToString(tex, { displayMode: true, throwOnError: false })),
}))

export default function Landing() {
  return (
    <div className="trace">
      <StepCard steps={steps} />

      <main className="landing">
        <header className="bar">
          <Link className="mark" href="/">
            <span className="mark-glyph" aria-hidden />
            <span>stabrix</span>
          </Link>
          <nav className="bar-links" aria-label="Main">
            <Link className="bar-link" href="/liquidity">
              Liquidity
            </Link>
            <Link className="bar-link" href="/lab">
              Depeg Lab
            </Link>
            <Link className="bar-cta" href="/swap">
              Start →
            </Link>
          </nav>
        </header>

        <section className="hero">
          <div className="headline-wrap">
            <Marquee />
            <h1>
              Every stablecoin in one pool, <em>your wallet keeps the coins.</em>
            </h1>
          </div>
        </section>

        <FeatureCards />

        <footer>
          <span className="dim">1inch SwapVM · Chainlink CRE</span>
          <Link href="/swap">Swap</Link>
          <Link href="/lab">Depeg Lab</Link>
          <a href={REPO}>Code</a>
        </footer>
      </main>
    </div>
  )
}
