'use client'

import { useEffect } from 'react'
import { LiveRates } from './live-rates'

const P =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_'
const SHIP = P + '20261031_024714_39df675e-5060-4528-87dc-9d0c274815aa.png&w=1600&q=90'
const CAPT = P + '20261031_024703_a0298b6a-0117-47f1-8462-4be671d0407e.png&w=2048&q=90'
const PLANTS = P + '20261031_024704_3ccf1ac2-bec7-4fdb-bfce-ac19eca8db28.png&w=2048&q=90'
const FONTS =
  'https://fonts.googleapis.com/css2?family=Goudy+Bookletter+1911&family=Sorts+Mill+Goudy&family=Josefin+Sans:wght@600&family=Open+Sans:wght@700&display=swap'

const SERIF = 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap'
const SHEET = { w: 2048, h: 1360 }
type BoxId = 'capt' | 'chest' | 'palm' | 'bushL' | 'bushR'
const BOX: Record<BoxId, [string, number, number, number, number]> = {
  capt: [CAPT, 34, 153, 1246, 1074],
  chest: [CAPT, 1475, 830, 446, 392],
  palm: [PLANTS, 19, 32, 910, 1284],
  bushL: [PLANTS, 515, 820, 860, 496],
  bushR: [PLANTS, 1528, 908, 499, 405],
}

type Layer = { dy: number; a: number; k: number; v: number; ph: number; fill?: string; span?: [number, number] }
const BACK: Layer[] = [
  { dy: -100, a: 20, k: 1.5, v: 0.9, ph: 0, fill: 'var(--band)' },
  { dy: -52, a: 23, k: 1.9, v: 1.15, ph: 1.7, fill: 'var(--paper)' },
]
const FRONT: Layer[] = [
  { dy: 0, a: 25, k: 1.7, v: 1.3, ph: 3.1, fill: 'var(--band2)' },
  { dy: 26, a: 18, k: 2.4, v: 1, ph: 4.4, span: [0.06, 0.44] },
  { dy: 48, a: 22, k: 1.45, v: 1.4, ph: 0.6, fill: 'var(--paper)' },
  { dy: 76, a: 15, k: 2.1, v: 1.2, ph: 5.1, span: [0.52, 0.97] },
  { dy: 104, a: 24, k: 1.8, v: 1.25, ph: 2.2, fill: 'var(--paper)' },
  { dy: 130, a: 14, k: 2.7, v: 1, ph: 1.1, span: [0.0, 0.62] },
  { dy: 158, a: 20, k: 1.6, v: 1.1, ph: 3.8 },
]

type Spot = { x: number; y: number; w: number }
interface Lay {
  w: number
  h: number
  wave: { y0: number; y1: number; gap0: number; gap1: number }
  ship: { x0: number; w0: number; x1: number; w1: number }
  palm: Spot
  capt: Spot
  chest: Spot
  bushL: Spot
  bushR: Spot
}
const LAY: { land: Lay; port: Lay } = {
  land: {
    w: 1600,
    h: 900,
    wave: { y0: 748, y1: 272, gap0: 1, gap1: 0.6 },
    ship: { x0: 1130, w0: 646, x1: 1345, w1: 176 },
    palm: { x: -92, y: -112, w: 620 },
    capt: { x: 120, y: 318, w: 540 },
    chest: { x: 640, y: 628, w: 200 },
    bushL: { x: 96, y: 716, w: 700 },
    bushR: { x: 1370, y: 740, w: 300 },
  },
  port: {
    w: 800,
    h: 1500,
    wave: { y0: 1300, y1: 430, gap0: 1, gap1: 0.7 },
    ship: { x0: 420, w0: 564, x1: 640, w1: 150 },
    palm: { x: -150, y: -60, w: 560 },
    capt: { x: 20, y: 440, w: 600 },
    chest: { x: 560, y: 830, w: 190 },
    bushL: { x: -40, y: 1330, w: 520 },
    bushR: { x: 570, y: 1340, w: 260 },
  },
}

type Pt = [number, number]
interface Note {
  id: string
  scene: 0 | 1
  title: string
  sub: string
  subPort?: string
  land: { text: Pt; from: Pt; to: Pt }
  port: { text: Pt; from: Pt; to: Pt }
}
const NOTES: Note[] = [
  {
    id: 'coins',
    scene: 0,
    title: 'your coins aboard',
    sub: '8 stablecoins, one 1inch Aqua strategy',
    subPort: '8 stablecoins, one strategy',
    land: { text: [1262, 150], from: [1256, 186], to: [1150, 330] },
    port: { text: [440, 656], from: [476, 712], to: [430, 842] },
  },
  {
    id: 'cre',
    scene: 1,
    title: 'Chainlink CRE',
    sub: 'halts a broken coin',
    land: { text: [704, 438], from: [696, 450], to: [668, 414] },
    port: { text: [548, 586], from: [584, 580], to: [606, 548] },
  },
  {
    id: 'chest',
    scene: 1,
    title: 'the backstop',
    sub: 'same balance, buys below the peg',
    subPort: 'buys below the peg',
    land: { text: [870, 772], from: [862, 796], to: [802, 732] },
    port: { text: [566, 664], from: [560, 700], to: [572, 836] },
  },
  {
    id: 'pairs',
    scene: 1,
    title: 'healthy pairs',
    sub: 'keep trading on both 1inch routers',
    subPort: 'keep trading on 1inch',
    land: { text: [960, 118], from: [1226, 146], to: [1296, 184] },
    port: { text: [420, 150], from: [560, 214], to: [604, 300] },
  },
]

function arrowPath([sx, sy]: Pt, [tx, ty]: Pt) {
  const mx = (sx + tx) / 2
  const my = (sy + ty) / 2
  const dx = tx - sx
  const dy = ty - sy
  const cx = mx - dy * 0.28
  const cy = my + dx * 0.28
  const a = Math.atan2(ty - cy, tx - cx)
  const h = 13
  const l = [tx - h * Math.cos(a - 0.5), ty - h * Math.sin(a - 0.5)]
  const r = [tx - h * Math.cos(a + 0.5), ty - h * Math.sin(a + 0.5)]
  return `M${sx} ${sy}Q${cx} ${cy} ${tx} ${ty}M${l[0]} ${l[1]}L${tx} ${ty}L${r[0]} ${r[1]}`
}

type Metal = 'gold' | 'silver' | 'bronze' | 'copper'
const METAL: Record<Metal, [string, string, string]> = {
  gold: ['#f6c945', '#c98a1c', '#a86d10'],
  silver: ['#e4e8ee', '#a3adb8', '#7d8794'],
  bronze: ['#e7a865', '#b06a2c', '#8c5220'],
  copper: ['#ec8b6f', '#b4543b', '#8f3f2b'],
}
const COINS: { c: string; sym: string; metal: Metal }[] = [
  { c: 'USDC', sym: '$', metal: 'gold' },
  { c: 'EURC', sym: '€', metal: 'silver' },
  { c: 'BRZ', sym: 'R$', metal: 'bronze' },
  { c: 'IDRX', sym: 'Rp', metal: 'copper' },
]
const FLAGS = [
  { x: 28.9, y: 0.4, w: 10.9, h: 7.2 },
  { x: 49.8, y: 15.8, w: 9.4, h: 7.3 },
]

function Pennant() {
  return (
    <>
      <svg className="pfab" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden>
        <path
          d="M98 3 C72 -3 34 9 3 2 C6 22 0 40 4 58 C34 64 70 53 98 58 Z"
          fill="#1d2944"
          stroke="#16130e"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <svg className="panchor" viewBox="0 0 26 30" fill="none" stroke="#f3ecd8" strokeWidth="3" strokeLinecap="round" aria-hidden>
        {ANCHOR_PATH_1}
        {ANCHOR_PATH_2}
        <path d="m1 21 1.500-2.500L5 20.500M25 21l-1.500-2.500-2.500 2" />
      </svg>
    </>
  )
}

const CHEST_SPOTS = [
  { x: 128, y: 118 },
  { x: 318, y: 118 },
  { x: 182, y: 70 },
  { x: 266, y: 70 },
]

function Coin({ sym, metal }: { sym: string; metal: Metal }) {
  const [face, rim, side] = METAL[metal]
  const small = sym.length > 1
  return (
    <svg viewBox="0 0 100 100" aria-hidden>
      <ellipse cx="50" cy="56" rx="42" ry="40" fill={side} stroke="#16130e" strokeWidth="5" />
      <circle cx="50" cy="48" r="41" fill={face} stroke="#16130e" strokeWidth="5" />
      <circle cx="50" cy="48" r="30" fill="none" stroke={rim} strokeWidth="5" />
      <text
        x="50"
        y={small ? 58 : 62}
        textAnchor="middle"
        fill={rim}
        style={{ font: `400 ${small ? 28 : 40}px "Goudy Bookletter 1911", serif` }}
      >
        {sym}
      </text>
      <path d="M24 38A28 28 0 0 1 40 22" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity=".9" />
    </svg>
  )
}

const clamp = (v: number) => Math.min(1, Math.max(0, v))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a))
const io = (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2)
const out = (k: number) => 1 - (1 - k) ** 3
const back = (k: number) => 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2

const ANCHOR_PATH_1 = <circle cx="13" cy="4.5" r="2.8" />
const ANCHOR_PATH_2 = <path d="M13 7.5V28M7 12h12M2.5 19c.6 5.500 5.500 9 10.500 9s9.900-3.500 10.500-9" />

function NavAnchor() {
  return (
    <svg viewBox="0 0 26 30" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
      {ANCHOR_PATH_1}
      {ANCHOR_PATH_2}
    </svg>
  )
}

export function Saltwake() {
  useEffect(() => {
    const html = document.documentElement
    html.classList.add('sw')
    const $ = (id: string) => document.getElementById(id) as HTMLElement
    const frame = $('frame')
    const hero = $('hero')
    const page = hero.closest('.swp') as HTMLElement
    const hint = $('scrollhint')
    const scene = $('scene')
    const wBack = $('wBack') as unknown as SVGSVGElement
    const wFront = $('wFront') as unknown as SVGSVGElement
    const ship = $('ship')
    const cloud = $('cloudA')
    const t1 = $('t1')
    const t2 = $('t2')
    const h2 = $('h2')
    const p2 = $('p2')
    const btn2 = $('btn2')
    const logo = frame.querySelector('.logo') as HTMLElement
    const shade = $('shade') as HTMLCanvasElement
    const cur = $('cur')
    const ping = $('ping')
    const sprites: Record<BoxId, HTMLElement> = {
      palm: $('palm'),
      capt: $('capt'),
      chest: $('chest'),
      bushL: $('bushL'),
      bushR: $('bushR'),
    }
    const NS = 'http://www.w3.org/2000/svg'
    const mkPaths = (svg: SVGSVGElement, layers: Layer[]) =>
      layers.map((l) => {
        const path = document.createElementNS(NS, 'path')
        path.setAttribute('stroke', 'var(--line)')
        path.setAttribute('stroke-width', '3.2')
        path.setAttribute('stroke-linecap', 'round')
        path.setAttribute('fill', l.fill || 'none')
        svg.appendChild(path)
        return path
      })
    const notesArr = $('notesArr') as unknown as SVGSVGElement
    const noteEls = NOTES.map((n) => $(`note-${n.id}`))
    const notePaths = NOTES.map(() => {
      const path = document.createElementNS(NS, 'path')
      path.setAttribute('stroke', 'var(--line)')
      path.setAttribute('stroke-width', '3')
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('stroke-linejoin', 'round')
      path.setAttribute('fill', 'none')
      path.setAttribute('pathLength', '1')
      path.style.strokeDasharray = '1'
      path.style.strokeDashoffset = '1'
      notesArr.appendChild(path)
      return path
    })
    const backPaths = mkPaths(wBack, BACK)
    const frontPaths = mkPaths(wFront, FRONT)

    for (const id of Object.keys(BOX) as BoxId[]) {
      const [url, x, y, w, h] = BOX[id]
      const targets = id === 'chest' ? [...sprites.chest.querySelectorAll<HTMLElement>('.cpart')] : [sprites[id]]
      for (const el of targets) {
        el.style.backgroundImage = `url("${url}")`
        el.style.backgroundSize = `${(SHEET.w / w) * 100}% ${(SHEET.h / h) * 100}%`
        el.style.backgroundPosition = `${(x / (SHEET.w - w)) * 100}% ${(y / (SHEET.h - h)) * 100}%`
      }
    }
    const chestLid = sprites.chest.querySelector('.clid') as HTMLElement
    const openLid = $('openLid')
    const openInside = $('openInside')
    const chestCoins = [...sprites.chest.querySelectorAll<HTMLElement>('.ccoin')]
    const slip = $('slip')
    ship.style.backgroundImage = `url("${SHIP}")`

    const ctx = shade.getContext('2d')!
    ctx.scale(0.5, 0.5)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 128, 72)
    ctx.strokeStyle = 'rgba(120,114,96,.9)'
    ctx.lineCap = 'round'
    for (const [x0, y0, x1, y1, lw] of [
      [-10, 26, 38, -8, 8],
      [-8, 46, 58, -2, 5],
      [-10, 62, 74, 6, 4],
      [14, 78, 96, 16, 4],
      [40, 82, 118, 22, 3],
      [78, 80, 140, 34, 5],
      [-12, 74, 22, 56, 6],
    ] as const) {
      ctx.lineWidth = lw
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.quadraticCurveTo((x0 + x1) / 2 + 6, (y0 + y1) / 2 + 8, x1, y1)
      ctx.stroke()
    }

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const fine = matchMedia('(hover:hover) and (pointer:fine)').matches
    html.classList.toggle('fine', fine)

    let L = LAY.land
    let DX = 0
    let DY = 0
    let p = 0
    const t0 = performance.now()
    const scrollSpan = () => Math.max(1, hero.offsetHeight - innerHeight)

    const resize = () => {
      const W = frame.clientWidth
      const H = frame.clientHeight
      const portrait = H > W
      page.classList.toggle('portrait', portrait)
      L = portrait ? LAY.port : LAY.land
      const S = Math.min(W / L.w, H / L.h)
      const DW = W / S
      const DH = H / S
      DX = (DW - L.w) / 2
      DY = (DH - L.h) / 2
      scene.style.width = `${L.w}px`
      scene.style.height = `${L.h}px`
      scene.style.transform = `translate(${DX * S}px,${DY * S}px) scale(${S})`
      for (const svg of [wBack, wFront, notesArr]) {
        svg.setAttribute('width', String(L.w))
        svg.setAttribute('height', String(L.h))
      }
      NOTES.forEach((n, i) => {
        const at = portrait ? n.port : n.land
        const el = noteEls[i]!
        el.style.left = `${at.text[0]}px`
        el.style.top = `${at.text[1]}px`
        const path = notePaths[i]!
        path.setAttribute('d', arrowPath(at.from, at.to))
      })
      for (const id of Object.keys(BOX) as BoxId[]) {
        const [, , , w, h] = BOX[id]
        const spot = L[id]
        const el = sprites[id]
        el.style.left = `${spot.x}px`
        el.style.top = `${spot.y}px`
        el.style.width = `${spot.w}px`
        el.style.height = `${(spot.w * h) / w}px`
      }
    }

    const yAt = (l: Layer, x: number, t: number) => {
      const W = L.wave
      const base = mix(W.y0, W.y1, p) + l.dy * mix(W.gap0, W.gap1, p)
      const a = l.a * mix(1, 0.72, p)
      const f = ((2 * Math.PI) / 1100) * l.k * (1 - 0.35 * p)
      return base + a * Math.sin(f * x + t * l.v + l.ph) + a * 0.45 * Math.sin(f * 2.3 * x - t * l.v * 0.7 + l.ph * 1.7)
    }

    const pathD = (l: Layer, t: number) => {
      const x0 = -DX - 20
      const x1 = L.w + DX + 20
      const H = L.h + DY + 40
      const a = l.span ? mix(x0, x1, l.span[0]) : x0
      const b = l.span ? mix(x0, x1, l.span[1]) : x1
      let d = `M${a.toFixed(1)} ${yAt(l, a, t).toFixed(1)}`
      for (let x = a + 22; x < b; x += 22) d += `L${x.toFixed(1)} ${yAt(l, x, t).toFixed(1)}`
      d += `L${b.toFixed(1)} ${yAt(l, b, t).toFixed(1)}`
      if (l.fill) d += `L${x1} ${H}L${x0} ${H}Z`
      return d
    }

    const go = (to: number) => {
      window.scrollTo({ top: to ? scrollSpan() * 0.86 : 0, behavior: reduced ? 'auto' : 'smooth' })
    }

    const tf = (el: HTMLElement, x: number, y: number, r = 0, s = 1) => {
      el.style.transform = `translate(${x}px,${y}px) rotate(${r}deg) scale(${s})`
    }

    let mx = innerWidth / 2
    let my = innerHeight / 2
    let cx = mx
    let cy = my
    let pressed = false
    let overLink = false
    let pingT = -1e9
    let pingX = 0
    let pingY = 0
    let last = t0
    let raf = 0

    const render = (now: number) => {
      const t = reduced ? 0 : (now - t0) / 1000
      const target = clamp(window.scrollY / (scrollSpan() * 0.8))
      p = reduced ? target : p + (target - p) * (1 - Math.exp(-Math.min(0.05, (now - last) / 1000) * 7))
      if (Math.abs(target - p) < 1e-4) p = target
      hint.style.opacity = String(1 - seg(p, 0, 0.08))

      BACK.forEach((l, i) => backPaths[i]!.setAttribute('d', pathD(l, t)))
      FRONT.forEach((l, i) => frontPaths[i]!.setAttribute('d', pathD(l, t)))

      const c = L.ship
      const sw = mix(c.w0, c.w1, p)
      const sx = mix(c.x0, c.x1, p)
      const sh = (sw * 2002) / 1961
      const wy = yAt(FRONT[0]!, sx, t)
      const slope = (yAt(FRONT[0]!, sx + 90, t) - yAt(FRONT[0]!, sx - 90, t)) / 180
      ship.style.width = `${sw}px`
      ship.style.height = `${sh}px`
      ship.style.left = `${sx - sw / 2}px`
      ship.style.top = `${wy + sw * 0.05 - sh}px`
      ship.style.transform = `rotate(${Math.atan(slope) * 57.3 * 0.75}deg)`

      const span = L.w + 700
      cloud.style.left = `${((((L.w * 0.72 - t * 16) % span) + span) % span) - 400}px`
      cloud.style.top = `${L === LAY.port ? 110 : 150}px`
      cloud.style.opacity = String(1 - seg(p, 0.3, 0.7))

      const intro = reduced ? 1 : out(seg(now, t0 + 200, t0 + 1100))
      t1.style.opacity = String(intro * (1 - seg(p, 0.62, 0.7)))
      tf(t1, 0, (1 - intro) * 26 - p * 40)
      t1.style.pointerEvents = p > 0.1 ? 'none' : ''
      logo.style.opacity = String(1 - seg(p, 0.12, 0.3))

      const e = io(seg(p, 0.04, 0.92))
      tf(sprites.palm, mix(-L.palm.w - 80, 0, e), mix(-170, 0, e), Math.sin(t * 0.8) * 0.7)
      tf(sprites.capt, mix(-L.capt.w - 160, 0, e), 0, Math.sin(t * 1.1) * 0.5 * p)
      tf(sprites.chest, mix(-L.chest.w - 720, 0, e), mix(120, 0, e))
      const o = seg(p, 0.88, 1)
      chestLid.style.opacity = String(1 - seg(o, 0, 0.22))
      openInside.style.opacity = String(seg(o, 0, 0.2))
      openLid.setAttribute('transform', `translate(0 150) scale(1 ${out(seg(o, 0.08, 0.55))}) translate(0 -150)`)
      chestCoins.forEach((coin, i) => {
        const k = seg(o, 0.3 + 0.1 * i, 0.68 + 0.1 * i)
        coin.style.opacity = String(k)
        coin.style.transform = `translate(-50%,-50%) translateY(${mix(70, 0, out(k))}%) scale(${mix(0.35, 1, back(k))})`
      })
      const sk = seg(o, 0.8, 1)
      slip.style.opacity = String(sk)
      slip.style.transform = `translate(-50%,0) rotate(-6deg) scale(${mix(0.6, 1, back(sk))})`
      const b = out(seg(p, 0.5, 1))
      tf(sprites.bushL, 0, mix(340, 0, b))
      tf(sprites.bushR, 0, mix(300, 0, b))

      const hk = seg(p, 0.42, 0.82)
      h2.style.opacity = String(hk * hk)
      tf(h2, 0, mix(70, 0, out(hk)))
      const pk = seg(p, 0.76, 0.92)
      p2.style.opacity = String(pk)
      tf(p2, 0, mix(16, 0, pk))
      const bk = seg(p, 0.86, 1)
      btn2.style.opacity = String(bk)
      tf(btn2, 0, 0, 0, mix(0.7, 1, back(bk)))
      t2.style.pointerEvents = p > 0.9 ? '' : 'none'

      const ink0 = (reduced ? 1 : out(seg(now, t0 + 1100, t0 + 1900))) * (1 - seg(p, 0.04, 0.18))
      const ink1 = seg(p, 0.88, 1)
      NOTES.forEach((n, i) => {
        const k = n.scene === 0 ? ink0 : ink1
        noteEls[i]!.style.opacity = String(k)
        tf(noteEls[i]!, 0, (1 - k) * 8)
        notePaths[i]!.style.strokeDashoffset = String(1 - out(k))
        notePaths[i]!.style.opacity = k > 0 ? '1' : '0'
      })

      shade.style.transform = `translate(${Math.sin(t * 0.35) * 2.2}%,${Math.cos(t * 0.27) * 1.6}%) rotate(${Math.sin(t * 0.22) * 0.8}deg)`

      if (fine) {
        const dt = Math.min(0.05, (now - last) / 1000)
        const f = 1 - Math.exp(-dt * 22)
        cx += (mx - cx) * f
        cy += (my - cy) * f
        cur.style.transform = `translate(${cx}px,${cy}px) scale(${pressed ? 0.7 : overLink ? 1.35 : 1})`
        const pk2 = seg(now, pingT, pingT + 650)
        ping.style.transform = `translate(${pingX}px,${pingY}px) scale(${1 + out(pk2) * 1.9})`
        ping.style.opacity = String(pk2 >= 1 ? 0 : 1 - pk2)
      }
      last = now
      raf = requestAnimationFrame(render)
    }

    const onClick = (ev: MouseEvent) => {
      const a = (ev.target as HTMLElement).closest('a') as HTMLAnchorElement | null
      if (!a) return
      if (a.getAttribute('href') === '#') ev.preventDefault()
      const goTo = a.dataset.go
      if (goTo !== undefined) go(Number(goTo))
    }
    const onMove = (ev: PointerEvent) => {
      mx = ev.clientX
      my = ev.clientY
      overLink = !!(ev.target as HTMLElement).closest?.('a')
    }
    const onDown = (ev: PointerEvent) => {
      pressed = true
      pingT = performance.now()
      pingX = ev.clientX
      pingY = ev.clientY
    }
    const onUp = () => {
      pressed = false
    }

    resize()
    raf = requestAnimationFrame(render)
    window.addEventListener('resize', resize)
    document.addEventListener('click', onClick)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('click', onClick)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      html.classList.remove('sw', 'fine')
    }
  }, [])

  return (
    <>
      <link rel="stylesheet" href={FONTS} precedence="default" />
      <link rel="stylesheet" href={SERIF} precedence="default" />
      <div className="hero" id="hero">
      <main className="frame" id="frame">
        <div className="logo">
          <svg viewBox="0 0 26 30" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            {ANCHOR_PATH_1}
            {ANCHOR_PATH_2}
            <path d="m1 21 1.500-2.500L5 20.500M25 21l-1.500-2.500-2.500 2" />
          </svg>
          Stabrix
        </div>
        <nav>
          <a href="#" data-go="0">
            Everyday
            <NavAnchor />
          </a>
          <a href="#" data-go="1">
            Backstop
            <NavAnchor />
          </a>
          <a href="#how">
            How it works
            <NavAnchor />
          </a>
          <a href="/swap">
            App
            <NavAnchor />
          </a>
        </nav>
        <div id="scene">
          <div className="spr" id="cloudA">
            <svg viewBox="0 0 300 80" width="300" height="80" aria-hidden>
              <path
                fill="#d3cebe"
                d="M0 79c14-3 26-3 38-10-4-16 10-30 30-26 6-22 42-34 62-16 16-12 42-6 50 14 10-2 18 2 22 8 24 22 66 26 98 30z"
              />
            </svg>
          </div>
          <svg className="w" id="wBack" aria-hidden />
          <div className="t1" id="t1">
            <div className="eb">USD · EUR · BRL · IDR</div>
            <h1>
              Liquidity that
              <br />
              never leaves
            </h1>
            <p className="lede">
              One wallet balance makes FX markets on 1inch Aqua{' '}
              <br />
              and backs every stablecoin when one breaks
            </p>
            <div className="stamps">
              <span>1inch Aqua + SwapVM</span>
              <span>Chainlink CRE</span>
              <span>Base</span>
            </div>
            <a href="#" className="pill" data-go="1">
              Weather a depeg
            </a>
          </div>
          <div className="spr" id="ship">
            {FLAGS.map((f, i) => (
              <span
                key={i}
                className="pennant"
                style={{ left: `${f.x}%`, top: `${f.y}%`, width: `${f.w}%`, height: `${f.h}%`, animationDelay: `${i * -0.7}s` }}
              >
                <Pennant />
              </span>
            ))}
          </div>
          <svg className="w" id="wFront" aria-hidden />
          <div className="spr" id="palm" />
          <div className="spr" id="capt" />
          <div className="spr" id="chest">
            <svg className="copen" viewBox="0 0 446 392" aria-hidden>
              <g id="openLid">
                <path
                  d="M72 150 L66 38 Q223 -26 380 38 L374 150 Z"
                  fill="#5a2414"
                  stroke="#16130e"
                  strokeWidth="9"
                  strokeLinejoin="round"
                />
                <path d="M92 142 L88 52 Q223 0 358 52 L354 142 Z" fill="#3c170c" />
                <path d="M124 150 L120 30 M322 150 L326 30" stroke="#c9952e" strokeWidth="22" />
                <path d="M124 150 L120 30 M322 150 L326 30" stroke="#16130e" strokeWidth="4" opacity=".5" />
              </g>
            </svg>
            <div className="cpart cbody" />
            <div className="cpart clid" />
            <svg className="copen" viewBox="0 0 446 392" aria-hidden>
              <g id="openInside">
                <path d="M40 184 L406 184 L378 150 L68 150 Z" fill="#1d0a04" stroke="#16130e" strokeWidth="8" strokeLinejoin="round" />
                <ellipse cx="223" cy="172" rx="150" ry="14" fill="#f1c84f" opacity=".55" />
              </g>
            </svg>
            {COINS.map((coin, i) => (
              <span
                key={coin.c}
                className="ccoin"
                style={{ left: `${(CHEST_SPOTS[i]!.x / 446) * 100}%`, top: `${(CHEST_SPOTS[i]!.y / 392) * 100}%` }}
              >
                <Coin sym={coin.sym} metal={coin.metal} />
              </span>
            ))}
            <div className="slip" id="slip">
              buys USDe
              <br />
              at $0.91
            </div>
          </div>
          <div className="spr" id="bushL" />
          <div className="spr" id="bushR" />
          <div className="t2" id="t2">
            <h2 id="h2">
              When a coin
              <br />
              breaks
            </h2>
            <p id="p2">
              Chainlink CRE halts it at $0.93
              <br />
              backstops buy it below that
            </p>
            <span className="btnw" id="btn2">
              <i className="tick a" />
              <i className="tick b" />
              <i className="tick c" />
              <a href="#how" className="pill">
                How it works
              </a>
            </span>
          </div>
          <svg className="w" id="notesArr" aria-hidden />
          {NOTES.map((n) => (
            <div className="note" id={`note-${n.id}`} key={n.id}>
              <b>{n.title}</b>
              <span className="sub-land">{n.sub}</span>
              <span className="sub-port">{n.subPort ?? n.sub}</span>
            </div>
          ))}
        </div>
        <canvas id="shade" width="64" height="36" />
        <LiveRates />
        <div className="scrollhint" id="scrollhint" aria-hidden>
          scroll
          <i />
        </div>
      </main>
      </div>
      <div id="ping" />
      <div id="cur" />
    </>
  )
}
