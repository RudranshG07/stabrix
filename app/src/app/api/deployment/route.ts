import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const dynamic = 'force-dynamic'

const clean = (s: string) => s.trim().replace(/[^a-z0-9-]/gi, '')

function networks() {
  const list = (process.env.DEPLOYMENT_NAME ?? '').split(',').map(clean).filter(Boolean)
  return list.length ? list : ['base-fork']
}

export async function GET(req: Request) {
  const available = networks()
  const asked = clean(new URL(req.url).searchParams.get('network') ?? '')
  const name = available.includes(asked) ? asked : available[0]!
  try {
    const raw = JSON.parse(await readFile(join(process.cwd(), '..', 'deployments', `${name}.json`), 'utf8'))
    return Response.json({ ...raw, network: name, available }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return Response.json({ error: `deployment ${name} not found. Run ops/devnet.sh first.` }, { status: 404 })
  }
}
