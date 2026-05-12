'use client'
import { useLang, type Lang } from '@/lib/i18n'

export function LangSwitch() {
  const { lang, setLang } = useLang()
  return (
    <div className="lang-seg" role="tablist" aria-label="Language">
      {(['en', 'zh'] as const).map((code) => (
        <button
          key={code}
          type="button"
          className={`lang-btn ${lang === code ? 'on' : ''}`}
          aria-pressed={lang === code}
          onClick={() => setLang(code as Lang)}
        >
          {code === 'en' ? 'EN' : '中文'}
        </button>
      ))}
    </div>
  )
}
