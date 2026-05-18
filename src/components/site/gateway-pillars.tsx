'use client'
import { useLang } from '@/lib/i18n'

/**
 * Three pillars that define the "Annotation-Aware LLM Gateway" thesis
 * (Phase-15). Sits between the hero and the template-cards section.
 *
 * Each card is a one-liner that points at where the feature lives in
 * the app, so a judge clicking through actually lands on the surface.
 */
export function GatewayPillars() {
  const { t } = useLang()
  const cards = [
    {
      tag: t('gp1_tag'),
      title: t('gp1_title'),
      body: t('gp1_body'),
      href: '/docs#proxy',
      cta: t('gp_cta_read'),
    },
    {
      tag: t('gp2_tag'),
      title: t('gp2_title'),
      body: t('gp2_body'),
      href: '/docs#guardrail',
      cta: t('gp_cta_read'),
    },
    {
      tag: t('gp3_tag'),
      title: t('gp3_title'),
      body: t('gp3_body'),
      href: '/docs#export',
      cta: t('gp_cta_read'),
    },
  ]
  return (
    <section className="relative" id="gateway">
      <div className="max-w-[1280px] mx-auto px-6 pt-10 pb-20">
        <div
          className="lh-mono lh-caption mb-6"
          style={{ color: 'oklch(0.55 0 0)' }}
        >
          {t('gp_section')}
        </div>
        <h2
          className="lh-h2 mb-2 max-w-[820px]"
          style={{
            color: 'oklch(0.95 0 0)',
            textWrap: 'balance',
          } as React.CSSProperties}
        >
          {t('gp_h')}
        </h2>
        <p
          className="lh-body mt-2 max-w-[640px]"
          style={{ color: 'oklch(0.62 0 0)' }}
        >
          {t('gp_sub')}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          {cards.map((c) => (
            <a
              key={c.title}
              href={c.href}
              className="group rounded-lg p-5 transition-colors"
              style={{
                background: 'oklch(0.16 0 0)',
                border: '1px solid oklch(0.24 0 0)',
                textDecoration: 'none',
              }}
            >
              <div
                className="lh-mono lh-caption mb-3"
                style={{ color: 'oklch(0.6 0.18 280)' }}
              >
                {c.tag}
              </div>
              <h3
                className="lh-h4 mb-2"
                style={{ color: 'oklch(0.95 0 0)' }}
              >
                {c.title}
              </h3>
              <p
                className="lh-body-sm"
                style={{ color: 'oklch(0.62 0 0)' }}
              >
                {c.body}
              </p>
              <div
                className="lh-mono lh-caption mt-4 inline-flex items-center gap-1.5 group-hover:translate-x-0.5 transition-transform"
                style={{ color: 'oklch(0.78 0 0)' }}
              >
                <span>{c.cta}</span>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M3 6h6m0 0L6 3m3 3L6 9"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="square"
                  />
                </svg>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
