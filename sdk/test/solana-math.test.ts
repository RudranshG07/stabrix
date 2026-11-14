import { describe, expect, it } from 'vitest'
import { StabrixMathError, exactIn } from '../src/math.js'
import { solBackstopOut, solRate } from '../src/solana/math.js'
import vectors from './solana-vectors.json' with { type: 'json' }

type Case = Record<string, unknown> & { kind: string; out: string }

const run = (f: () => bigint) => {
  try {
    return f().toString()
  } catch (e) {
    if (e instanceof StabrixMathError) return e.code
    throw e
  }
}

describe('solana math matches the onchain program', () => {
  for (const [k, c] of (vectors as Case[]).entries()) {
    it(`${c.kind} case ${k}`, () => {
      if (c.kind === 'range') {
        const real = (c.real as string[]).map(BigInt)
        const rates = (c.decimals as number[]).map((d, x) => solRate(d, BigInt((c.price as string[])[x]!)))
        const got = run(() =>
          exactIn(
            real,
            rates,
            { floor: BigInt(c.floor as string), sumCapRatio: BigInt(c.sumCapRatio as string), feeBps: c.feeBps as number, maxShareBps: c.maxShareBps as number },
            c.i as number,
            c.j as number,
            BigInt(c.amountIn as string),
          ),
        )
        expect(got).toBe(c.out)
      } else {
        const got = run(() =>
          solBackstopOut({
            amountIn: BigInt(c.amountIn as string),
            absorbedIn: BigInt(c.absorbedIn as string),
            faceIn: BigInt(c.faceIn as string),
            marketIn: BigInt(c.marketIn as string),
            priceOut: BigInt(c.priceOut as string),
            decimalsIn: c.decimalsIn as number,
            decimalsOut: c.decimalsOut as number,
            startBps: c.startBps as number,
            endBps: c.endBps as number,
            cap: BigInt(c.cap as string),
          }),
        )
        expect(got).toBe(c.out)
      }
    })
  }
})
