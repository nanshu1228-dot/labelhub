'use client'
import { useLang, type DictKey } from '@/lib/i18n'

export function SiteFooter() {
  const { t } = useLang()
  return (
    <footer className="hairline">
      <div className="max-w-[1280px] mx-auto px-6 pt-14 pb-10">
        <div className="grid grid-cols-2 md:grid-cols-12 gap-10 mb-12">
          <div className="col-span-2 md:col-span-6">
            <div className="flex items-center gap-2">
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
                style={{ color: 'var(--hi)', letterSpacing: '-0.01em' }}
              >
                LabelHub
              </span>
            </div>
            <p
              className="lh-body-sm mt-3 max-w-[320px]"
              style={{ color: 'var(--mute)' }}
            >
              {t('footer_tagline')}
            </p>
            <div
              className="lh-mono lh-caption mt-6 flex items-center gap-2"
              style={{ color: 'var(--mute2)' }}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: 'oklch(0.65 0.13 150)' }}
              />
              <span>{t('footer_status')}</span>
              <span style={{ color: 'var(--mute2)' }}>·</span>
              <span>v0.4.21</span>
            </div>
          </div>

          <FooterColumn
            heading="footer_product"
            links={[
              { key: 'footer_templates', href: '#templates' },
              { key: 'footer_docs', href: '/docs' },
            ]}
          />
        </div>

        <div
          className="grid grid-cols-1 md:grid-cols-3 items-center gap-3 pt-6 text-center md:text-left"
          style={{ borderTop: '1px solid var(--line)' }}
        >
          <span className="lh-mono lh-caption" style={{ color: 'var(--mute2)' }}>
            © 2026 LabelHub Labs, Inc.
          </span>
          <a
            className="lh-mono lh-caption md:text-center"
            href="http://beian.miit.gov.cn/"
            rel="noreferrer"
            target="_blank"
            style={{ color: 'var(--mute)' }}
          >
            京ICP备2026029587号
          </a>
          <span
            className="lh-mono lh-caption md:text-right"
            style={{ color: 'var(--mute2)' }}
          >
            {t('footer_built')}
          </span>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({
  heading,
  links,
  wide,
}: {
  heading: DictKey
  links: { key: DictKey; href?: string }[]
  wide?: boolean
}) {
  const { t } = useLang()
  return (
    <div className={wide ? 'col-span-2 md:col-span-2' : 'col-span-1 md:col-span-2'}>
      <div
        className="lh-mono lh-caption mb-3"
        style={{ color: 'var(--mute2)', letterSpacing: '0.04em' }}
      >
        {t(heading)}
      </div>
      <div className="flex flex-col gap-2">
        {links.map((l) => (
          <a key={l.key} className="nav-link" href={l.href ?? '#'}>
            {t(l.key)}
          </a>
        ))}
      </div>
    </div>
  )
}
