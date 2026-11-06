import { createServer } from 'node:http'

const PORT = Number(process.env.PRICE_API_PORT ?? 8790)
const prices = new Map<string, number>()

const json = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(body))
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,DELETE',
      'access-control-allow-headers': 'content-type',
    })
    return res.end()
  }
  if (req.method === 'GET' && url.pathname === '/prices') {
    return json(res, 200, Object.fromEntries(prices))
  }
  const match = url.pathname.match(/^\/price\/([A-Za-z0-9]+)$/)
  if (req.method === 'GET' && match) {
    const symbol = match[1]!
    return json(res, 200, { symbol, price: prices.get(symbol) ?? null })
  }
  if (req.method === 'DELETE' && match) {
    prices.delete(match[1]!)
    return json(res, 200, { symbol: match[1], price: null })
  }
  if (req.method === 'POST' && url.pathname === '/price') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const { symbol, price } = JSON.parse(raw || '{}') as { symbol?: string; price?: number }
    if (!symbol || typeof price !== 'number' || !(price > 0)) return json(res, 400, { error: 'symbol and price required' })
    prices.set(symbol, price)
    return json(res, 200, { symbol, price })
  }
  return json(res, 404, { error: 'not found' })
}).listen(PORT, '127.0.0.1', () => console.log(`price api on http://127.0.0.1:${PORT}`))
