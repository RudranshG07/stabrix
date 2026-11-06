'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { COIN_HEX } from '@/lib/coins'

type Layer = { dy: number; a: number; k: number; v: number; ph: number; fill?: string; span?: [number, number] }

const BACK: Layer[] = [
  { dy: -96, a: 16, k: 1.5, v: 0.9, ph: 0, fill: 'var(--sx-band)' },
  { dy: -50, a: 19, k: 1.9, v: 1.15, ph: 1.7, fill: 'var(--sx-sea)' },
]
const FRONT: Layer[] = [
  { dy: 0, a: 21, k: 1.7, v: 1.3, ph: 3.1, fill: 'var(--sx-band2)' },
  { dy: 26, a: 15, k: 2.4, v: 1, ph: 4.4, span: [0.06, 0.44] },
  { dy: 48, a: 18, k: 1.45, v: 1.4, ph: 0.6, fill: 'var(--sx-sea)' },
  { dy: 76, a: 13, k: 2.1, v: 1.2, ph: 5.1, span: [0.52, 0.97] },
  { dy: 104, a: 20, k: 1.8, v: 1.25, ph: 2.2, fill: 'var(--sx-sea)' },
  { dy: 130, a: 12, k: 2.7, v: 1, ph: 1.1, span: [0, 0.62] },
  { dy: 158, a: 17, k: 1.6, v: 1.1, ph: 3.8 },
]

const COINS = ['USDC', 'EURC', 'DAI', 'USDe', 'BRZ', 'USDT', 'IDRX', 'USDS'] as const
const BAD = COINS.indexOf('USDe')

interface Layout {
  w: number
  h: number
  wave: { y0: number; y1: number; gap0: number; gap1: number; amp1: number }
  buoys: { x0: number; x1: number; r: number }
  net: { w: number }
}

const LAY: Record<'land' | 'port', Layout> = {
  land: {
    w: 1600,
    h: 900,
    wave: { y0: 770, y1: 335, gap0: 1, gap1: 0.7, amp1: 1.55 },
    buoys: { x0: 760, x1: 1500, r: 31 },
    net: { w: 170 },
  },
  port: {
    w: 800,
    h: 1500,
    wave: { y0: 1200, y1: 640, gap0: 1, gap1: 0.75, amp1: 1.45 },
    buoys: { x0: 20, x1: 780, r: 30 },
    net: { w: 150 },
  },
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const seg = (v: number, a: number, b: number) => clamp((v - a) / (b - a))
const io = (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2)
const out = (k: number) => 1 - (1 - k) ** 3
const back = (k: number) => 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2

export function TwoScene() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const frame = root.current!
    const q = <T extends Element>(s: string) => frame.querySelector(s) as T
    const qa = <T extends Element>(s: string) => [...frame.querySelectorAll(s)] as T[]
    const scene = q<HTMLDivElement>('.sx-scene')
    const wBack = q<SVGSVGElement>('.sx-wback')
    const wFront = q<SVGSVGElement>('.sx-wfront')
    const peg = q<SVGLineElement>('.sx-peg')
    const pegLabel = q<HTMLDivElement>('.sx-peglabel')
    const t1 = q<HTMLDivElement>('.sx-t1')
    const t2 = q<HTMLDivElement>('.sx-t2')
    const eb2 = q<HTMLElement>('.sx-eb2')
    const h2 = q<HTMLElement>('.sx-h2')
    const p2 = q<HTMLElement>('.sx-p2')
    const stats = q<HTMLElement>('.sx-stats')
    const note = q<HTMLElement>('.sx-note')
    const cta2 = q<HTMLElement>('.sx-cta2')
    const net = q<SVGSVGElement>('.sx-net')
    const halt = q<HTMLDivElement>('.sx-halt')
    const buoys = qa<HTMLDivElement>('.sx-buoy')
    const tabs = qa<HTMLButtonElement>('.sx-tab')
    const cur = document.getElementById('sx-cur') as HTMLDivElement
    const ping = document.getElementById('sx-ping') as HTMLDivElement
    const backPaths = BACK.map(() => wBack.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path')))
    const frontPaths = FRONT.map(() => wFront.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path')))

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const fine = matchMedia('(hover: hover) and (pointer: fine)').matches
    document.documentElement.classList.toggle('sx-fine', fine)

    let L = LAY.land
    let DX = 0
    let DY = 0
    let p = 0
    let pFrom = 0
    let pTo = 0
    let pT0 = 0
    let lock = 0
    const t0 = performance.now()

    const resize = () => {
      const W = frame.clientWidth
      const H = frame.clientHeight
      const portrait = H > W
      frame.classList.toggle('sx-portrait', portrait)
      L = portrait ? LAY.port : LAY.land
      const S = Math.min(W / L.w, H / L.h)
      DX = (W / S - L.w) / 2
      DY = (H / S - L.h) / 2
      scene.style.width = `${L.w}px`
      scene.style.height = `${L.h}px`
      scene.style.transform = `translate(${DX * S}px,${DY * S}px) scale(${S})`
      for (const svg of [wBack, wFront]) {
        svg.setAttribute('width', String(L.w))
        svg.setAttribute('height', String(L.h))
      }
    }

    const yAt = (l: Layer, x: number, t: number) => {
      const w = L.wave
      const base = mix(w.y0, w.y1, p) + l.dy * mix(w.gap0, w.gap1, p)
      const a = l.a * mix(1, w.amp1, Math.sin(Math.PI * clamp(p * 1.15)) * 0.6 + p * 0.4)
      const f = ((2 * Math.PI) / 1100) * l.k * (1 - 0.3 * p)
      return base + a * Math.sin(f * x + t * l.v + l.ph) + a * 0.45 * Math.sin(f * 2.3 * x - t * l.v * 0.7 + l.ph * 1.7)
    }

    const pathFor = (l: Layer, t: number) => {
      const x0 = -DX - 20
      const x1 = L.w + DX + 20
      const bottom = L.h + DY + 40
      const from = l.span ? mix(x0, x1, l.span[0]) : x0
      const to = l.span ? mix(x0, x1, l.span[1]) : x1
      let d = ''
      for (let x = from; x <= to + 21; x += 22) {
        const xx = Math.min(x, to)
        d += `${d ? 'L' : 'M'}${xx.toFixed(1)} ${yAt(l, xx, t).toFixed(1)}`
      }
      return l.fill ? `${d}L${to} ${bottom}L${from} ${bottom}Z` : d
    }

    const go = (to: number) => {
      if (to === pTo) return
      pFrom = p
      pTo = to
      pT0 = performance.now()
    }

    let mx = -100
    let my = -100
    let cx = -100
    let cy = -100
    let pressed = false
    let pingAt = -1
    let pingX = 0
    let pingY = 0
    let last = t0
    let raf = 0

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const t = reduced ? 0 : (now - t0) / 1000
      const DUR = reduced ? 1 : 2100
      p = mix(pFrom, pTo, io(seg(now, pT0, pT0 + DUR)))

      BACK.forEach((l, i) => backPaths[i]!.setAttribute('d', pathFor(l, t)))
      FRONT.forEach((l, i) => frontPaths[i]!.setAttribute('d', pathFor(l, t)))
      BACK.forEach((l, i) => backPaths[i]!.setAttribute('fill', l.fill ?? 'none'))
      FRONT.forEach((l, i) => frontPaths[i]!.setAttribute('fill', l.fill ?? 'none'))

      const pegY = L.wave.y0 - 34
      peg.setAttribute('x1', String(-DX))
      peg.setAttribute('x2', String(L.w + DX))
      peg.setAttribute('y1', String(pegY))
      peg.setAttribute('y2', String(pegY))
      pegLabel.style.transform = `translate(${L.buoys.x0 - 120}px,${pegY - 26}px)`
      pegLabel.style.opacity = String(1 - seg(p, 0.15, 0.35))

      const intro = reduced ? 1 : out(seg(now, t0 + 150, t0 + 1050))
      t1.style.opacity = String(intro * (1 - seg(p, 0.55, 0.68)))
      t1.style.transform = `translateY(${(1 - intro) * 26 - p * 40}px)`
      t1.style.pointerEvents = p > 0.1 ? 'none' : ''

      const sink = io(seg(p, 0.22, 0.55))
      const lift = io(seg(p, 0.62, 0.96))
      const bx = (k: number) => mix(L.buoys.x0, L.buoys.x1, (k + 0.5) / COINS.length)
      let badX = 0
      let badY = 0
      buoys.forEach((b, k) => {
        const x = bx(k)
        const wy = yAt(FRONT[0]!, x, t)
        const slope = (yAt(FRONT[0]!, x + 40, t) - yAt(FRONT[0]!, x - 40, t)) / 80
        const r = L.buoys.r * (k === BAD ? 1.1 : 1)
        let y = wy - r * mix(0.55, 0.95, p)
        if (k === BAD) {
          y += mix(0, 150, sink) - mix(0, 150 + r * 0.9, lift)
          badX = x
          badY = y
          b.classList.toggle('sx-down', p > 0.24)
        }
        const intoB = reduced ? 1 : back(seg(now, t0 + 350 + k * 70, t0 + 1050 + k * 70))
        b.style.width = b.style.height = `${r * 2}px`
        b.style.transform = `translate(${x - r}px,${y - r}px) rotate(${Math.atan(slope) * 57.3 * 0.8}deg) scale(${intoB})`
      })

      halt.style.opacity = String(seg(p, 0.28, 0.42))
      halt.style.transform = `translate(${badX - 70}px,${badY - L.buoys.r * 2.6}px)`

      const e = io(seg(p, 0.5, 0.92))
      const nw = L.net.w
      const restY = badY + L.buoys.r * 0.15
      net.style.transform = `translate(${badX - nw / 2}px,${mix(restY + 420, restY, e)}px)`
      net.style.opacity = String(seg(p, 0.45, 0.6))

      const hk = seg(p, 0.48, 0.84)
      eb2.style.opacity = String(hk * hk)
      h2.style.opacity = String(hk * hk)
      h2.style.transform = `translateY(${mix(60, 0, out(hk))}px)`
      const pk = seg(p, 0.74, 0.9)
      p2.style.opacity = String(pk)
      p2.style.transform = `translateY(${mix(16, 0, pk)}px)`
      const sk = seg(p, 0.8, 0.96)
      stats.style.opacity = String(sk)
      stats.style.transform = `translateY(${mix(16, 0, sk)}px)`
      note.style.opacity = String(sk)
      const bk = seg(p, 0.86, 1)
      cta2.style.opacity = String(bk)
      cta2.style.transform = `scale(${mix(0.7, 1, back(bk))})`
      t2.style.pointerEvents = p > 0.9 ? '' : 'none'
      tabs.forEach((tab, k) => tab.setAttribute('aria-pressed', String(Math.round(pTo) === k)))

      if (fine) {
        const f = 1 - Math.exp(-dt * 22)
        cx += (mx - cx) * f
        cy += (my - cy) * f
        const over = (document.elementFromPoint(mx, my) as HTMLElement | null)?.closest('a,button')
        cur.style.transform = `translate(${cx}px,${cy}px) scale(${pressed ? 0.7 : over ? 1.35 : 1})`
        if (pingAt >= 0) {
          const k = seg(now, pingAt, pingAt + 650)
          ping.style.transform = `translate(${pingX}px,${pingY}px) scale(${1 + out(k) * 1.9})`
          ping.style.opacity = String(1 - k)
        }
      }
      raf = requestAnimationFrame(render)
    }

    const onWheel = (ev: WheelEvent) => {
      const now = performance.now()
      if (now < lock) return
      if (ev.deltaY > 8) go(1)
      else if (ev.deltaY < -8) go(0)
      else return
      lock = now + 1200
    }
    let touchY = 0
    const onTouchStart = (ev: TouchEvent) => {
      touchY = ev.touches[0]!.clientY
    }
    const onTouchEnd = (ev: TouchEvent) => {
      const dy = touchY - ev.changedTouches[0]!.clientY
      if (dy > 40) go(1)
      else if (dy < -40) go(0)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (['ArrowDown', 'PageDown', ' '].includes(ev.key)) go(1)
      if (['ArrowUp', 'PageUp'].includes(ev.key)) go(0)
    }
    const onMove = (ev: PointerEvent) => {
      mx = ev.clientX
      my = ev.clientY
      if (cx < 0) {
        cx = mx
        cy = my
      }
    }
    const onDown = (ev: PointerEvent) => {
      pressed = true
      pingAt = performance.now()
      pingX = ev.clientX
      pingY = ev.clientY
    }
    const onUp = () => {
      pressed = false
    }
    const onGo = (ev: MouseEvent) => {
      const el = (ev.target as HTMLElement).closest('[data-go]') as HTMLElement | null
      if (!el) return
      ev.preventDefault()
      go(Number(el.dataset.go))
    }

    resize()
    if (location.hash === '#depeg') go(1)
    raf = requestAnimationFrame(render)
    const ro = new ResizeObserver(resize)
    ro.observe(frame)
    frame.addEventListener('wheel', onWheel, { passive: true })
    frame.addEventListener('touchstart', onTouchStart, { passive: true })
    frame.addEventListener('touchend', onTouchEnd, { passive: true })
    frame.addEventListener('click', onGo)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      frame.removeEventListener('wheel', onWheel)
      frame.removeEventListener('touchstart', onTouchStart)
      frame.removeEventListener('touchend', onTouchEnd)
      frame.removeEventListener('click', onGo)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      document.documentElement.classList.remove('sx-fine')
    }
  }, [])

  return (
    <>
      <main ref={root} className="sx-frame">
        <Link href="/" className="sx-logo" aria-label="Stabrix home">
          <span className="sx-mark" aria-hidden />
          stabrix
        </Link>
        <nav className="sx-nav" aria-label="Scenes">
          <button type="button" className="sx-tab" data-go="0">
            Everyday
          </button>
          <button type="button" className="sx-tab" data-go="1">
            Depeg
          </button>
          <Link href="/liquidity" className="sx-link">
            Liquidity
          </Link>
          <Link href="/swap" className="sx-pill sx-pill-small">
            Launch app
          </Link>
        </nav>

        <div className="sx-scene">
          <svg className="sx-w sx-wback" aria-hidden />
          <svg className="sx-w sx-pegline" aria-hidden width="1" height="1">
            <line className="sx-peg" />
          </svg>
          <div className="sx-peglabel" aria-hidden>
            $1.00 peg
          </div>

          <div className="sx-t1">
            <p className="sx-eb">{'// everyday'}</p>
            <h1>
              One balance.
              <br />
              Every currency.
            </h1>
            <p className="sx-sub">
              USDC, EURC, BRZ, IDRX and four more trade in one Orbital range on 1inch Aqua. Your coins never leave your
              wallet, and they earn FX fees while they sit there.
            </p>
            <div className="sx-ctas">
              <a href="#depeg" className="sx-pill" data-go="1">
                See a depeg
              </a>
              <Link href="/swap" className="sx-ghost">
                Open the app
              </Link>
            </div>
          </div>


          {COINS.map((c) => (
            <div key={c} className="sx-buoy" style={{ ['--tone' as string]: COIN_HEX[c] }} aria-hidden>
              <span>{c}</span>
            </div>
          ))}
          <div className="sx-halt" aria-hidden>
            USDe $0.93 · halted
          </div>

          <svg className="sx-w sx-wfront" aria-hidden />

          <svg className="sx-net" viewBox="0 0 260 140" width="170" height="92" aria-hidden>
            <path d="M6 10 Q130 150 254 10" />
            <path d="M28 24 Q130 122 232 24" />
            <path d="M54 40 Q130 98 206 40" />
            <path d="M6 10 L54 40 M50 26 L92 62 M96 34 L118 74 M130 36 L130 80 M164 34 L142 74 M210 26 L168 62 M254 10 L206 40" />
            <circle cx="6" cy="10" r="5" />
            <circle cx="254" cy="10" r="5" />
          </svg>

          <div className="sx-t2" id="depeg">
            <p className="sx-eb sx-eb2">{'// when one breaks'}</p>
            <h2 className="sx-h2">
              The same balance
              <br />
              catches it.
            </h2>
            <p className="sx-p2">
              Chainlink CRE halts USDe at $0.93. Every range refuses it, and backstops buy it 2 to 10% below that, paid
              from wallets that never deposited.
            </p>
            <dl className="sx-stats">
              <div>
                <dt>+1.86%</dt>
                <dd>backstop return</dd>
              </div>
              <div>
                <dt>0</dt>
                <dd>USDe bought at par</dd>
              </div>
              <div>
                <dt>1</dt>
                <dd>wallet, two jobs</dd>
              </div>
            </dl>
            <p className="sx-note">{'// measured on a Base mainnet fork with real USDe, both 1inch routers'}</p>
            <div className="sx-cta2">
              <Link href="/swap" className="sx-pill">
                Open the app
              </Link>
              <button type="button" className="sx-ghost" data-go="0">
                Back to calm
              </button>
            </div>
          </div>
        </div>

      </main>
      <div id="sx-ping" aria-hidden />
      <div id="sx-cur" aria-hidden />
    </>
  )
}
