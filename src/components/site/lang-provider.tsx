'use client'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DICT,
  LangContext,
  STORAGE_KEY,
  type DictKey,
  type Lang,
} from '@/lib/i18n'

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')

  // Hydrate from localStorage after mount (avoids SSR/CSR mismatch)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Lang | null
      if (saved === 'zh' || saved === 'en') setLangState(saved)
    } catch {
      // localStorage may be unavailable
    }
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-lang', lang)
    document.documentElement.setAttribute(
      'lang',
      lang === 'zh' ? 'zh-Hans' : 'en',
    )
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // ignore
    }
  }, [])

  const t = useCallback(
    (k: DictKey) => DICT[lang][k] ?? DICT.en[k] ?? String(k),
    [lang],
  )

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}
