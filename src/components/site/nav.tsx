'use client'
import { useLang } from '@/lib/i18n'
import { LangSwitch } from './lang-switch'

const ARROW = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path
      d="M3 6h6m0 0L6 3m3 3L6 9"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="square"
    />
  </svg>
)

export function SiteNav() {
  const { t } = useLang()
  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background: 'oklch(0.13 0 0 / 0.78)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid oklch(0.22 0 0)',
      }}
    >
      <div className="max-w-[1280px] mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <a href="#" className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <rect x="0.5" y="0.5" width="17" height="17" rx="4" stroke="oklch(0.6 0.18 280)" />
              <path
                d="M5 4.5V13.5H13"
                stroke="oklch(0.6 0.18 280)"
                strokeWidth="1.5"
                strokeLinecap="square"
              />
            </svg>
            <span
              className="lh-body font-medium"
              style={{ color: 'oklch(0.92 0 0)', letterSpacing: '-0.01em' }}
            >
              LabelHub
            </span>
          </a>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#templates" className="nav-link">{t('nav_templates')}</a>
            <a href="#" className="nav-link">{t('nav_marketplace')}</a>
            <a href="#" className="nav-link">{t('nav_pricing')}</a>
            <a href="#" className="nav-link">{t('nav_docs')}</a>
            <a href="#" className="nav-link">{t('nav_changelog')}</a>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <LangSwitch />
          <a href="#" className="nav-link hidden sm:inline">
            {t('auth_login')}
          </a>
          <a href="#" className="lh-btn lh-btn-solid">
            {t('auth_signup')}
            {ARROW}
          </a>
        </div>
      </div>
    </header>
  )
}
