import { StabrixClient, StabrixMathError, exactIn, spotPrice, sumRatio } from '@stabrix/sdk'
import { connect, loadDeployment } from './env.js'

async function main() {
  const c = await connect()
  const d = loadDeployment(c.chainId)
  const client = new StabrixClient(c.publicClient, d)
  const ranges = await client.listRanges()
  const sym = (a: string) => d.tokens.find((t) => t.address.toLowerCase() === a.toLowerCase())!.symbol
  for (const r of ranges) {
    const s = client.stateOf(r)
    const i = s.indexOf(d.tokens.find((t) => t.symbol === 'USDC')!.address)
    const j = s.indexOf(d.tokens.find((t) => t.symbol === 'DAI')!.address)
    const bal = r.config.tokens.map((t, k) => `${sym(t)}=${(Number(r.balances[k]) / 10 ** r.config.decimals[k]!).toFixed(0)}`).join(' ')
    let why = 'ok'
    try { exactIn(r.balances, r.rates, r.range, i, j, 10n ** 8n) } catch (e) { why = (e as StabrixMathError).code }
    const ratio = Number(sumRatio(r.balances, r.rates, r.config.floor)) / 1e18
    const px = Number(spotPrice(r.balances, r.rates, { ...r.range, sumCapRatio: 2n ** 63n }, i, j)) / 1e18 / 1e12
    console.log(r.venue.kind, bal, '| sumRatio', ratio.toFixed(6), 'cap', (Number(r.config.sumCapRatio) / 1e18).toFixed(6), '| USDC->DAI px', px.toFixed(5), '|', why)
  }
}
main()
