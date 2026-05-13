'use client'
import { useLang } from '@/lib/i18n'

export function Hero() {
  const { t } = useLang()
  return (
    <section className="relative">
      <div className="absolute inset-0 bg-dot opacity-[0.35] pointer-events-none" aria-hidden />
      <div className="max-w-[1280px] mx-auto px-6 pt-24 pb-24 relative">
        {/* eyebrow */}
        <div
          className="lh-mono lh-caption flex items-center gap-2 rise"
          style={{ color: 'oklch(0.55 0 0)' }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: 'oklch(0.6 0.18 280)',
              boxShadow: '0 0 0 3px oklch(0.6 0.18 280 / 0.18)',
            }}
          />
          <span>{t('eyebrow')}</span>
        </div>

        {/* H1 + sub */}
        <div className="grid grid-cols-12 gap-10 mt-10 items-end">
          <div className="col-span-12 md:col-span-7 rise d1">
            <h1
              className="lh-h1"
              style={{ color: 'oklch(0.95 0 0)', textWrap: 'balance' } as React.CSSProperties}
            >
              {t('hero_h1')}
            </h1>
          </div>

          <div className="col-span-12 md:col-span-5 md:pl-6 rise d2">
            <p
              className="lh-body-lg max-w-[440px]"
              style={{ color: 'oklch(0.62 0 0)' }}
            >
              {t('hero_sub')}
            </p>

            <div className="mt-7 flex items-center gap-3 flex-wrap">
              <a href="/workspaces/new" className="lh-btn lh-btn-solid">
                <span>{t('cta_start')}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="M3 6h6m0 0L6 3m3 3L6 9"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="square"
                  />
                </svg>
              </a>
              <a href="#live" className="lh-btn lh-btn-ghost">
                {t('cta_demo')}
              </a>
            </div>

            <a
              href="/workspaces/00000000-0000-0000-0000-000000000010"
              className="mt-4 inline-flex items-center gap-2 group"
              style={{ color: 'oklch(0.6 0.18 280)', textDecoration: 'none' }}
            >
              <span className="lh-body-sm" style={{ fontWeight: 500 }}>
                {t('cta_tour_demo')}
              </span>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ transition: 'transform 120ms' }} className="group-hover:translate-x-0.5">
                <path
                  d="M3 6h6m0 0L6 3m3 3L6 9"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="square"
                />
              </svg>
              <span className="lh-caption lh-mono" style={{ color: 'oklch(0.42 0 0)' }}>
                · {t('cta_tour_demo_hint')}
              </span>
            </a>

            <div
              className="mt-5 flex items-center gap-2 lh-caption lh-mono"
              style={{ color: 'oklch(0.42 0 0)' }}
            >
              <span>{t('kbd_open')}</span>
              <span className="kbd">⌘</span>
              <span className="kbd">K</span>
              <span className="mx-1" style={{ color: 'oklch(0.32 0 0)' }}>/</span>
              <span>{t('kbd_no_card')}</span>
            </div>
          </div>
        </div>

        {/* 4-col stats */}
        <div className="mt-20 pt-6 hairline grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat label={t('meta_runs')} value={t('meta_runs_v')} />
          <Stat
            label={t('meta_scale')}
            value={
              <span className="lh-mono">
                1,000 × 4 &nbsp;
                <span style={{ color: 'oklch(0.42 0 0)' }}>{t('meta_smooth')}</span>
              </span>
            }
          />
          <Stat label={t('meta_pair')} value={t('meta_pair_v')} />
          <Stat label={t('meta_payout')} value={<span className="lh-mono">USD · USDC · LBH</span>} />
        </div>
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="lh-mono lh-caption" style={{ color: 'oklch(0.42 0 0)' }}>
        {label}
      </div>
      <div className="lh-body mt-1" style={{ color: 'oklch(0.78 0 0)' }}>
        {value}
      </div>
    </div>
  )
}
