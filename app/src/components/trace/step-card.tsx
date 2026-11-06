'use client'

import { useEffect, useRef } from 'react'
import { StabrixFigure } from './figure'

export interface CardStep {
  kicker: string
  html: string[]
  note?: string
}

const MIN_TEX = 14

export function StepCard({ steps }: { steps: CardStep[] }) {
  const card = useRef<HTMLElement>(null)

  useEffect(() => {
    const root = card.current
    if (!root) return
    const fill = root.querySelector<HTMLElement>('.rail-fill')
    const panes = Array.from(root.querySelectorAll<HTMLElement>('.step'))
    if (!fill || !panes.length) return
    const compact = window.matchMedia('(max-width: 900px)')
    let active = -1

    const fit = () => {
      for (const step of panes) {
        const blocks = Array.from(step.querySelectorAll<HTMLElement>('.tex'))
        if (!blocks.length) continue
        const wasHidden = !step.classList.contains('is-active')
        if (wasHidden) step.style.visibility = 'hidden'
        step.classList.add('is-active')
        let ratio = Number.POSITIVE_INFINITY
        let base = 0
        for (const block of blocks) {
          block.style.fontSize = ''
          const width = block.querySelector<HTMLElement>('.katex')?.getBoundingClientRect().width ?? 0
          if (!width) continue
          base = Number.parseFloat(getComputedStyle(block).fontSize)
          ratio = Math.min(ratio, block.clientWidth / width)
        }
        if (base && Number.isFinite(ratio)) {
          const size = Math.min(compact.matches ? 22 : 40, Math.max(MIN_TEX, base * ratio))
          for (const block of blocks) block.style.fontSize = `${size}px`
        }
        if (wasHidden) {
          step.classList.remove('is-active')
          step.style.visibility = ''
        }
      }
    }

    const draw = () => {
      const travel = document.documentElement.scrollHeight - window.innerHeight
      const p = travel > 0 ? Math.min(1, Math.max(0, window.scrollY / travel)) : 0
      fill.style.setProperty('--progress', `${p * 100}%`)
      const next = Math.min(panes.length - 1, Math.floor(p * panes.length))
      if (next === active) return
      panes[active]?.classList.remove('is-active')
      panes[next]!.classList.add('is-active')
      active = next
    }

    let queued = false
    const schedule = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        draw()
      })
    }
    const remeasure = () => {
      fit()
      draw()
    }

    fit()
    draw()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', remeasure)
    document.fonts?.ready.then(remeasure)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', remeasure)
    }
  }, [])

  return (
    <aside ref={card} className="card" aria-label="How one Stabrix swap is priced and protected">
      <div className="sim">
        <StabrixFigure steps={steps.length} />
      </div>
      <div className="viewport">
        {steps.map((step) => (
          <article key={step.kicker} className="step">
            <span className="kicker" style={{ ['--i' as string]: 0 }}>
              {step.kicker}
            </span>
            {step.html.map((html, n) => (
              <div key={html} className="tex" style={{ ['--i' as string]: n + 1 }} dangerouslySetInnerHTML={{ __html: html }} />
            ))}
            {step.note && (
              <p className="note" style={{ ['--i' as string]: step.html.length + 1 }}>
                {step.note}
              </p>
            )}
          </article>
        ))}
      </div>
      <div className="rail">
        <span className="rail-fill" />
      </div>
    </aside>
  )
}
