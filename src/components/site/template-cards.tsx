'use client'
import Link from 'next/link'
import { useLang, type DictKey } from '@/lib/i18n'

/**
 * §02 Templates — three template modes as plain, calm cards.
 *
 * The previous version rendered a dense per-card mini-visualization
 * (yes/no grids, score pips, a trajectory timeline). Simplified to a
 * clean title + one-line description per mode for a low-noise, white
 * landing. The three cards still map 1:1 to the shipping engine modes
 * (`pair-rubric`, `arena-gsb`, `agent-trace-eval`).
 */
const CARDS: Array<{ tag: DictKey; title: DictKey; body: DictKey }> = [
  { tag: 'c1_tag', title: 'c1_title', body: 'c1_body' },
  { tag: 'c2_tag', title: 'c2_title', body: 'c2_body' },
  { tag: 'c3_tag', title: 'c3_title', body: 'c3_body' },
]

export function TemplateCards() {
  const { t } = useLang()
  return (
    <section id="templates" className="hairline">
      <div className="max-w-[1100px] mx-auto px-6 pt-20 pb-24">
        <div className="flex items-end justify-between mb-10 gap-6">
          <div>
            <div
              className="lh-mono lh-caption mb-3"
              style={{ color: 'var(--accent)' }}
            >
              {t('tpl_section')}
            </div>
            <h2 className="lh-h2" style={{ color: 'var(--hi)', maxWidth: 720 }}>
              {t('tpl_h')}
            </h2>
          </div>
          <a
            href="/docs"
            className="lh-body-sm lh-mono hidden md:inline-flex items-center gap-2"
            style={{ color: 'var(--mute)' }}
          >
            <span>{t('tpl_all')}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 6h6m0 0L6 3m3 3L6 9"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="square"
              />
            </svg>
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {CARDS.map((c) => (
            <article
              key={c.tag}
              className="rounded-xl p-6"
              style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
            >
              <span className="mode-tag">{t(c.tag)}</span>
              <h3 className="lh-h4 mt-4 mb-2" style={{ color: 'var(--hi)' }}>
                {t(c.title)}
              </h3>
              <p className="lh-body-sm" style={{ color: 'var(--mute)' }}>
                {t(c.body)}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4">
          <p className="lh-body" style={{ color: 'var(--mute)', maxWidth: 560 }}>
            {t('tpl_closing')}
          </p>
          <div className="flex items-center gap-3">
            <a href="/docs" className="lh-btn lh-btn-ghost">
              {t('tpl_spec')}
            </a>
            <Link href="/workspaces/new" className="lh-btn lh-btn-solid">
              <span>{t('cta_start')}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M3 6h6m0 0L6 3m3 3L6 9"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="square"
                />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
