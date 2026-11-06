import type { ReactNode } from 'react'

const REPO = 'https://github.com/RudranshG07/stabrix'

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
  idle: (
    <Ink>
      <rect x="8" y="18" width="48" height="34" rx="7" />
      <path d="M8 28h48M42 39h6" />
      <path d="M20 12h24" />
    </Ink>
  ),
  lock: (
    <Ink>
      <rect x="12" y="28" width="40" height="28" rx="6" />
      <path d="M20 28v-8a12 12 0 0 1 24 0v8M32 39v7" />
    </Ink>
  ),
  drain: (
    <Ink>
      <path d="M10 14h44l-16 20v16l-12 6V34z" />
      <path d="M44 48c3 3 6 3 9 0" />
    </Ink>
  ),
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

function SecHead({ eb, title, intro, id }: { eb: string; title: ReactNode; intro?: ReactNode; id?: string }) {
  return (
    <header className="sec-head" id={id}>
      <p className="eb">{eb}</p>
      <h2>{title}</h2>
      {intro && <p className="intro">{intro}</p>}
    </header>
  )
}

const PROBLEMS = [
  {
    icon: ICONS.idle,
    title: 'Idle money',
    text: 'Stablecoins in wallets and treasuries usually earn nothing, because earning swap fees means handing them to a pool.',
  },
  {
    icon: ICONS.lock,
    title: 'Locked liquidity',
    text: 'Once deposited, the coins are not yours to spend until you withdraw. Payroll and payments cannot wait for that.',
  },
  {
    icon: ICONS.drain,
    title: 'The depeg drain',
    text: 'When one coin breaks, traders dump it into every pool at par and LPs are left holding it. USDC fell to about $0.88 in March 2023.',
  },
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
    text: "Paradigm's Orbital sphere prices USDC, USDT, DAI, USDS, USDe, EURC, BRZ and IDRX on one curve, as a new SwapVM instruction with one square root per swap.",
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
    text: 'CRE halts it on every range. Your backstop buys it 2 to 10% below market, paid from the same wallet balance that runs your FX range.',
  },
]

const AQUA = [
  {
    title: 'Shared liquidity',
    text: 'One wallet backs an FX range and a backstop at the same time. A $67 test wallet backed $108 of strategies: a 1.6x Shared Liquidity Ratio.',
  },
  {
    title: 'Two new instructions',
    text: 'StabrixTick (opcode 34) prices the Orbital curve. StabrixBackstop (opcode 35) buys a depegged coin only while Chainlink says it is broken.',
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
  '$ cre workflow simulate depeg-sentinel --target fork-settings --broadcast',
  '✓ Workflow compiled',
  'USDe  api 0.93      halt  offchain 700bps >= hard 300bps',
  'EURC  feed 1.11689  push  first FX rate',
  'BRZ   ref 0.18167   push  first FX rate',
  'IDRX  ref 0.0000553 push  first FX rate',
  'oracle updated  tx 0x030c385b…ab9fa5dc4',
]

const CRE_FACTS = [
  'Rates must sit within 0.5% of the Chainlink feed onchain, or the feed wins.',
  'A halt needs both price APIs to agree, so one stale API cannot freeze a coin.',
  'Reports are refused until our workflow owner is set: no stranger can write.',
  'Guardian halts stay put even when a calm report arrives.',
]

const NUMBERS = [
  ['0.13%', 'cost of a 10,000 USDC to DAI swap, fees included'],
  ['0.17%', 'cost of a 5,000 USDC to EURC swap, FX fee included'],
  ['0', 'USDe bought at par by any range in the crash test'],
  ['+1.86%', 'backstop return from buying USDe at $0.93'],
  ['144', 'SDK tests, quotes equal to Solidity to the wei'],
  ['80', 'contract tests, 9 on official 1inch contracts on Base'],
]

export function Story() {
  return (
    <div className="story">
      <section className="sec">
        <SecHead
          eb="The problem"
          title={
            <>
              Stablecoins{' '}
              <br />
              sit idle
            </>
          }
        />
        <div className="grid3">
          {PROBLEMS.map((c) => (
            <article key={c.title} className="ink-card">
              <span className="icon">{c.icon}</span>
              <h3>{c.title}</h3>
              <p>{c.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="sec">
        <SecHead
          id="how"
          eb="How it works"
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
          {STEPS.map((s, k) => (
            <li key={s.title} className="ink-card step">
              <span className="num">{String(k + 1).padStart(2, '0')}</span>
              <span className="icon">{s.icon}</span>
              <span className="tag">{s.tag}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="sec">
        <SecHead
          eb="Built for 1inch Aqua"
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
      </section>

      <section className="sec">
        <SecHead
          eb="Built for Chainlink CRE"
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
          eb="Measured, not promised"
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
        <p className="note-line">Measured on a Base mainnet fork with real coins and both 1inch routers. Mainnet deployment is next.</p>
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
