export const PHRASES = [
  'one pool.',
  'five stablecoins.',
  'aqua allowance.',
  'opcode 34.',
  'one square root.',
  'radius never shrinks.',
  'edge holds.',
  'heaviest coin refused.',
  'chainlink halt.',
  'two venues.',
  'one transaction.',
  'zero wei drift.',
]

export function Marquee() {
  return (
    <div className="marquee" aria-hidden style={{ ['--n' as string]: PHRASES.length }}>
      {PHRASES.map((phrase, i) => (
        <span key={phrase} className="phrase" style={{ ['--i' as string]: i }}>
          {phrase}
        </span>
      ))}
    </div>
  )
}
