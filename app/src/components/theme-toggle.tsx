'use client'

import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

const KEY = 'stabrix-theme'

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  }, [])

  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(KEY, next)
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="grid size-10 place-items-center rounded-full border border-line transition-colors duration-[160ms] hover:bg-surface"
    >
      {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  )
}

export const THEME_BOOT = `try{var t=localStorage.getItem('${KEY}');if(t==='light')document.documentElement.dataset.theme='light'}catch(e){}`
