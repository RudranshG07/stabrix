import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const dynamic = 'force-dynamic'

export async function GET() {
  const name = (process.env.DEPLOYMENT_NAME ?? 'base-fork').replace(/[^a-z0-9-]/gi, '')
  try {
    const raw = await readFile(join(process.cwd(), '..', 'deployments', `${name}.json`), 'utf8')
    return new Response(raw, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  } catch {
    return Response.json({ error: `deployment ${name} not found. Run ops/devnet.sh first.` }, { status: 404 })
  }
}
