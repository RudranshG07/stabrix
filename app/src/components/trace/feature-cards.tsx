import type { ReactNode } from 'react'

const venues: [string, string][] = [
  ['Stabrix router', '62% · opcode 34'],
  ['1inch SwapVM', '38% · Extruction'],
  ['settled', '1 transaction'],
]

const sentinel: [string, string][] = [
  ['Chainlink USDe/USD', '$0.9991'],
  ['Price API, median', '$0.9300'],
  ['DepegSentinel', 'halted · 3% rule'],
]

const features: { title: string; text: string; visual: ReactNode }[] = [
  {
    title: 'Pick a range.',
    text: 'Tight, Balanced or Wide over five stablecoins. Tight is 31x capital efficiency and stops at a 0.5% depeg.',
    visual: (
      <div className="floating-card">
        <span className="coin">◎</span>
        <div>
          <b>Tight range · 31x</b>
          <small>USDC USDT DAI USDS USDe · fee 0.01%</small>
        </div>
        <span>↗</span>
      </div>
    ),
  },
  {
    title: 'Coins stay home.',
    text: 'A range is a 1inch Aqua strategy. Aqua records an allowance; tokens leave your wallet only when a trade fills.',
    visual: (
      <div className="preview">
        <small>Aqua allowance</small>
        <strong>40,000 USDC</strong>
        <span>still in your wallet ↗</span>
      </div>
    ),
  },
  {
    title: 'One pool, every pair.',
    text: "Paradigm's Orbital sphere over all five coins, priced by a new SwapVM instruction in one square root.",
    visual: (
      <div className="list">
        <small>Pairs on one range</small>
        {[
          ['USDC → DAI', 'same pool'],
          ['USDe → USDT', 'same pool'],
          ['USDS → USDC', 'same pool'],
        ].map(([a, b]) => (
          <div key={a}>
            <b>{a}</b>
            <span>{b}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Split across venues.',
    text: "Every trade is split across all LP ranges and settles on our router and 1inch's official one in a single transaction.",
    visual: (
      <div className="list">
        <small>Route</small>
        {venues.map(([a, b]) => (
          <div key={a}>
            <b>{a}</b>
            <span>{b}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'The edge holds.',
    text: 'When a coin floods in, the range reaches its edge and refuses that coin. Healthy pairs keep trading.',
    visual: (
      <div className="preview">
        <small>Tight range · USDe in</small>
        <strong>Refused at edge</strong>
        <div className="slider-track">
          <i />
        </div>
        <span>USDC → DAI still open ↗</span>
      </div>
    ),
  },
  {
    title: 'Chainlink halts it.',
    text: 'A CRE workflow reads Chainlink feeds and a price API. Past 3% it writes a signed halt to every range.',
    visual: (
      <div className="list">
        <small>Depeg sentinel</small>
        {sentinel.map(([a, b]) => (
          <div key={a}>
            <b>{a}</b>
            <span>{b}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Never lose to a trade.',
    text: 'Every swap re-derives the pool radius and reverts if it would shrink. Fees compound into your range.',
    visual: (
      <div className="token-card">
        <div>
          <i />
          <span>stabrix</span>
        </div>
        <small>LP RADIUS CHECK</small>
        <strong>r′ ≥ r</strong>
        <span>every swap, both routers</span>
      </div>
    ),
  },
  {
    title: 'No lockup.',
    text: 'Close a range any time. There is nothing to withdraw because nothing ever left your wallet.',
    visual: (
      <div className="passkey">
        <svg viewBox="0 0 80 80" aria-hidden>
          <path d="M16 28h48v34H16zM16 28l6-12h36l6 12M52 44h12v10H52z" />
        </svg>
      </div>
    ),
  },
]

export function FeatureCards() {
  return (
    <section className="features" aria-labelledby="features-title">
      <h2 id="features-title">How it works</h2>
      <div className="feature-grid">
        {features.map((f, i) => (
          <article key={f.title} className="feature">
            <div className="feature-visual" aria-hidden>
              {f.visual}
            </div>
            <div className="feature-copy">
              <span className="feature-number">0{i + 1}</span>
              <div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
