'use client'
import { useLang } from '@/lib/i18n'
import { GatewaySnippet } from './gateway-snippet'

/**
 * Landing hero (Phase-15 rewrite).
 *
 * Old thesis ("AI-native annotation platform") relegated; the headline
 * is now "Annotation-Aware LLM Gateway". The proxy / topic-scope /
 * counterfactual fork story is the actual differentiator, so it goes
 * above the fold:
 *   - h1 names the thesis verbatim
 *   - the right column carries the 3-line drop-in code snippet that
 *     proves the integration is real (not a slogan)
 *   - the 4-col stats below show *live* counts pulled from the prod
 *     DB at render time (passed in via props from the server page).
 *
 * Video placeholder lives below the stats — replaced in Phase-18 once
 * a real 60–90s screencast is recorded.
 */

export interface HeroStats {
  trajectoriesCaptured: number
  teachingSignals: number
  workspaceCount: number
  toolCallsCaptured: number
}

function compactNum(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000)
    return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export function Hero({ stats }: { stats: HeroStats | null }) {
  const { t } = useLang()
  return (
    <section className="relative">
      <div
        className="absolute inset-0 bg-dot opacity-[0.35] pointer-events-none"
        aria-hidden
      />
      <div className="max-w-[1280px] mx-auto px-6 pt-24 pb-20 relative">
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

        {/* H1 + subtitle + CTAs + code snippet */}
        <div className="grid grid-cols-12 gap-10 mt-10 items-start">
          <div className="col-span-12 md:col-span-6 rise d1">
            <h1
              className="lh-h1"
              style={
                {
                  color: 'oklch(0.95 0 0)',
                  textWrap: 'balance',
                } as React.CSSProperties
              }
            >
              {t('hero_h1')}
            </h1>
            <p
              className="lh-body-lg mt-6 max-w-[520px]"
              style={{ color: 'oklch(0.62 0 0)' }}
            >
              {t('hero_sub')}
            </p>

            <div className="mt-7 flex items-center gap-3 flex-wrap">
              <a
                href="/workspaces/new"
                className="lh-btn lh-btn-solid"
              >
                <span>{t('cta_start')}</span>
                <svg
                  width="12"
                  height="12"
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
              </a>
              <a href="#gateway" className="lh-btn lh-btn-ghost">
                {t('cta_demo')}
              </a>
            </div>

            <a
              href="/workspaces/00000000-0000-0000-0000-000000000010"
              className="mt-4 inline-flex items-center gap-2 group"
              style={{
                color: 'oklch(0.6 0.18 280)',
                textDecoration: 'none',
              }}
            >
              <span
                className="lh-body-sm"
                style={{ fontWeight: 500 }}
              >
                {t('cta_tour_demo')}
              </span>
              <svg
                width="10"
                height="10"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
                style={{ transition: 'transform 120ms' }}
                className="group-hover:translate-x-0.5"
              >
                <path
                  d="M3 6h6m0 0L6 3m3 3L6 9"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="square"
                />
              </svg>
              <span
                className="lh-caption lh-mono"
                style={{ color: 'oklch(0.42 0 0)' }}
              >
                · {t('cta_tour_demo_hint')}
              </span>
            </a>
          </div>

          {/* code snippet column — the proof */}
          <div className="col-span-12 md:col-span-6 rise d2">
            <div
              className="lh-mono lh-caption mb-2"
              style={{ color: 'oklch(0.5 0 0)' }}
            >
              {t('snip_label')}
            </div>
            <GatewaySnippet />
            <div
              className="lh-caption mt-3"
              style={{ color: 'oklch(0.42 0 0)' }}
            >
              {t('snip_caption')}
            </div>
          </div>
        </div>

        {/* live stats — real DB counts, no fake data */}
        <div className="mt-16 pt-6 hairline grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat
            label={t('meta_trajectories')}
            value={
              <span className="lh-mono">
                {stats ? compactNum(stats.trajectoriesCaptured) : '—'}
              </span>
            }
          />
          <Stat
            label={t('meta_tool_calls')}
            value={
              <span className="lh-mono">
                {stats ? compactNum(stats.toolCallsCaptured) : '—'}
              </span>
            }
          />
          <Stat
            label={t('meta_teaching')}
            value={
              <span className="lh-mono">
                {stats ? compactNum(stats.teachingSignals) : '—'}
              </span>
            }
          />
          <Stat
            label={t('meta_workspaces')}
            value={
              <span className="lh-mono">
                {stats ? compactNum(stats.workspaceCount) : '—'}
              </span>
            }
          />
        </div>

        {/* video placeholder — replaced in Phase-18 by real screencast */}
        <div
          className="mt-12 rounded-lg overflow-hidden aspect-video flex items-center justify-center text-center"
          style={{
            background:
              'linear-gradient(135deg, oklch(0.14 0 0), oklch(0.18 0.02 280))',
            border: '1px dashed oklch(0.32 0 0)',
          }}
        >
          <div>
            <div
              className="lh-mono lh-caption mb-2"
              style={{ color: 'oklch(0.5 0 0)' }}
            >
              {t('video_placeholder_eyebrow')}
            </div>
            <div
              className="lh-body"
              style={{ color: 'oklch(0.62 0 0)' }}
            >
              {t('video_placeholder_body')}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Stat({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div>
      <div
        className="lh-mono lh-caption"
        style={{ color: 'oklch(0.42 0 0)' }}
      >
        {label}
      </div>
      <div
        className="lh-body mt-1"
        style={{ color: 'oklch(0.78 0 0)' }}
      >
        {value}
      </div>
    </div>
  )
}
