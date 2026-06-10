'use client'
import { useLang } from '@/lib/i18n'

export function LiveLearning() {
  const { t } = useLang()
  return (
    <section id="live" className="hairline">
      <div className="max-w-[1280px] mx-auto px-6 pt-20 pb-24">
        <div className="grid grid-cols-12 gap-10 mb-10 items-end">
          <div className="col-span-12 md:col-span-7">
            <div className="lh-mono lh-caption mb-3" style={{ color: 'oklch(0.6 0.18 280)' }}>
              {t('live_section')}
            </div>
            <h2 className="lh-h2" style={{ color: 'var(--hi)' }}>{t('live_h')}</h2>
          </div>
          <div className="col-span-12 md:col-span-5 md:pl-6">
            <p className="lh-body-lg" style={{ color: 'var(--mute2)' }}>{t('live_sub')}</p>
          </div>
        </div>

        {/* chart card */}
        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 14,
            background: 'var(--panel)',
            overflow: 'hidden',
          }}
        >
          {/* header row */}
          <div
            className="grid grid-cols-2 md:grid-cols-4 px-6 py-5"
            style={{ borderBottom: '1px solid var(--line)' }}
          >
            <div>
              <div className="lh-mono lh-caption mb-1.5" style={{ color: 'var(--mute2)' }}>
                claude-4.7 · sft-medical-qa-v7
              </div>
              <div className="flex items-baseline gap-2">
                <span
                  className="lh-mono"
                  style={{
                    fontSize: 32,
                    lineHeight: 1,
                    color: 'var(--hi)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  81.1%
                </span>
                <span className="lh-mono lh-body-sm" style={{ color: 'oklch(0.6 0.18 280)' }}>
                  ▲ +2.9
                </span>
              </div>
              <div className="lh-mono lh-caption mt-1" style={{ color: 'var(--mute2)' }}>
                <span>{t('live_acc')}</span> · 7d
              </div>
            </div>
            <MetricStat label={t('live_factuality')} value="81.4%" delta="+3.1" />
            <MetricStat label={t('live_helpfulness')} value="76.8%" delta="+0.6" />
            <MetricStat label={t('live_safety')} value="94.2%" delta="±0.0" muted />
          </div>

          {/* chart */}
          <div className="chart-wrap" style={{ padding: '24px 24px 16px' }}>
            <div style={{ position: 'relative' }}>
              <svg
                viewBox="0 0 740 240"
                width="100%"
                preserveAspectRatio="none"
                style={{ display: 'block' }}
              >
                <defs>
                  <linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.6 0.18 280)" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="oklch(0.6 0.18 280)" stopOpacity="0" />
                  </linearGradient>
                </defs>

                <g className="chart-grid">
                  <line x1="40" x2="720" y1="40" y2="40" />
                  <line x1="40" x2="720" y1="100" y2="100" />
                  <line x1="40" x2="720" y1="160" y2="160" />
                  <line x1="40" x2="720" y1="220" y2="220" />
                </g>

                <g className="chart-axis" textAnchor="end">
                  <text x="32" y="44">82%</text>
                  <text x="32" y="104">80%</text>
                  <text x="32" y="164">78%</text>
                  <text x="32" y="224">76%</text>
                </g>

                <g className="chart-axis" textAnchor="middle">
                  <text x="40" y="236">Mon</text>
                  <text x="153" y="236">Tue</text>
                  <text x="267" y="236">Wed</text>
                  <text x="380" y="236">Thu</text>
                  <text x="493" y="236">Fri</text>
                  <text x="607" y="236">Sat</text>
                  <text x="720" y="236">Sun</text>
                </g>

                <path
                  className="chart-area"
                  d="M40,154 L96.7,148 L153.3,151 L210,139 L266.7,127 L323.3,121 L380,106 L436.7,100 L493.3,91 L550,85 L606.7,76 L663.3,70 L720,67 L720,220 L40,220 Z"
                />
                <path
                  className="chart-curve"
                  d="M40,154 L96.7,148 L153.3,151 L210,139 L266.7,127 L323.3,121 L380,106 L436.7,100 L493.3,91 L550,85 L606.7,76 L663.3,70 L720,67"
                />

                <circle
                  className="chart-dot"
                  cx="380"
                  cy="106"
                  r="3.5"
                  style={{ animationDelay: '1400ms' }}
                />
                <circle
                  className="chart-dot"
                  cx="550"
                  cy="85"
                  r="3.5"
                  style={{ animationDelay: '2000ms' }}
                />

                <circle
                  cx="720"
                  cy="67"
                  r="14"
                  fill="oklch(0.6 0.18 280)"
                  className="pulse-dot"
                  opacity="0.18"
                />
                <circle className="chart-dot live" cx="720" cy="67" r="4" />
              </svg>

              <div
                className="chart-pill"
                style={{
                  left: 'calc(380px * (100% / 740px) - 30px)',
                  top: 30,
                  animationDelay: '1700ms',
                }}
              >
                <div className="lh-mono">{t('live_pill2_delta')}</div>
                <div>{t('live_pill2_label')}</div>
              </div>
              <div
                className="chart-pill"
                style={{
                  left: 'calc(550px * (100% / 740px) - 30px)',
                  top: 5,
                  animationDelay: '2300ms',
                }}
              >
                <div className="lh-mono">{t('live_pill1_delta')}</div>
                <div>{t('live_pill1_label')}</div>
              </div>
              <div
                className="chart-pill"
                style={{
                  right: 0,
                  top: -8,
                  animationDelay: '2700ms',
                  borderColor: 'oklch(0.6 0.18 280 / 0.5)',
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{
                      background: 'oklch(0.6 0.18 280)',
                      boxShadow: '0 0 0 3px oklch(0.6 0.18 280 / 0.22)',
                    }}
                  />
                  <span className="lh-mono">{t('live_now')}</span>
                  <span className="lh-mono">81.1%</span>
                </div>
              </div>
            </div>
          </div>

          {/* impact feed */}
          <div style={{ borderTop: '1px solid var(--line)' }}>
            <div className="px-6 py-4 flex items-center justify-between">
              <div
                className="lh-mono lh-caption"
                style={{ color: 'var(--mute2)', letterSpacing: '0.04em' }}
              >
                {t('live_feed_h')}
              </div>
              <div className="lh-mono lh-caption" style={{ color: 'var(--mute)' }}>
                live · 7d
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--line)' }}>
              <FeedRow ts="14:22" html={t('live_feed_1')} delta="+3.1%" />
              <FeedRow ts="13:58" html={t('live_feed_2')} delta="+2.1%" />
              <FeedRow ts="13:31" html={t('live_feed_3')} delta="rule" mutedDelta />
              <FeedRow ts="13:04" html={t('live_feed_4')} delta="+428 labels" mutedDelta last />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function MetricStat({
  label,
  value,
  delta,
  muted,
}: {
  label: string
  value: string
  delta: string
  muted?: boolean
}) {
  return (
    <div>
      <div className="lh-mono lh-caption mb-1.5" style={{ color: 'var(--mute2)' }}>{label}</div>
      <div className="lh-mono" style={{ fontSize: 20, color: 'var(--hi)' }}>{value}</div>
      <div
        className="lh-mono lh-caption mt-1"
        style={{ color: muted ? 'var(--mute)' : 'oklch(0.6 0.18 280)' }}
      >
        {delta}
      </div>
    </div>
  )
}

function FeedRow({
  ts,
  html,
  delta,
  mutedDelta,
  last,
}: {
  ts: string
  html: string
  delta: string
  mutedDelta?: boolean
  last?: boolean
}) {
  return (
    <div
      className="px-4 md:px-6 py-3 grid grid-cols-12 gap-2 md:gap-4 items-center"
      style={{ borderBottom: last ? undefined : '1px solid var(--line)' }}
    >
      <span className="lh-mono lh-caption col-span-2" style={{ color: 'var(--mute2)' }}>{ts}</span>
      <span
        className="lh-body-sm col-span-8"
        style={{ color: 'var(--text)' }}
      >
        {renderFeedSpans(html)}
      </span>
      <span
        className="lh-mono lh-caption col-span-2 text-right"
        style={{ color: mutedDelta ? 'var(--mute)' : 'oklch(0.6 0.18 280)' }}
      >
        {delta}
      </span>
    </div>
  )
}

/**
 * Tiny safe renderer for the constrained "<span class=...style=...>text</span>"
 * pattern used by the LiveLearning i18n strings.
 *
 * Replaces the previous `dangerouslySetInnerHTML` (Phase-6 security audit
 * called this out — currently safe because i18n values are hardcoded, but
 * an open invitation to break later when someone passes user-controlled
 * input). The new path:
 *
 *   1. Recognizes ONLY <span class="..." style="..."> ... </span>
 *      with `class` and `style` attribute values restricted to a
 *      character class that can't contain quotes / brackets.
 *   2. Anything outside that pattern is rendered as a plain text node
 *      (React already escapes < > & in plain strings — no XSS surface).
 *   3. HTML entities the i18n strings rely on (&ldquo;, &rdquo;, etc.)
 *      get decoded by `decodeBasicEntities` before rendering.
 *
 * If the i18n shape ever needs richer markup (anchors, code blocks),
 * extend this — but DO NOT reintroduce dangerouslySetInnerHTML.
 */
function renderFeedSpans(s: string): React.ReactNode {
  const SPAN_RE = /<span\s+(?:class="([^"<>]*)"\s+)?(?:style="([^"<>]*)"\s*)?>([^<]*)<\/span>/g
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = SPAN_RE.exec(s)) !== null) {
    if (m.index > last) {
      out.push(decodeBasicEntities(s.slice(last, m.index)))
    }
    const className = m[1] || undefined
    const styleStr = m[2] || ''
    const text = decodeBasicEntities(m[3])
    out.push(
      <span
        key={`s${key++}`}
        className={className}
        style={parseSafeStyle(styleStr)}
      >
        {text}
      </span>,
    )
    last = SPAN_RE.lastIndex
  }
  if (last < s.length) {
    out.push(decodeBasicEntities(s.slice(last)))
  }
  return out
}

/** Decode the small set of HTML entities the i18n strings actually use. */
function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
}

/**
 * Parse a tiny subset of CSS declarations from the i18n strings into a
 * React style object. Whitelist of properties so a future i18n change
 * that adds `background:url(javascript:...)` or `expression(...)`
 * never reaches the DOM. Currently the strings only use `color`.
 */
function parseSafeStyle(s: string): React.CSSProperties | undefined {
  if (!s) return undefined
  const ALLOWED = new Set<keyof React.CSSProperties>(['color'])
  const out: Record<string, string> = {}
  for (const decl of s.split(';')) {
    const [propRaw, ...valParts] = decl.split(':')
    const prop = propRaw?.trim()
    const val = valParts.join(':').trim()
    if (!prop || !val) continue
    if (!ALLOWED.has(prop as keyof React.CSSProperties)) continue
    // Reject anything with parens that aren't simple oklch / rgb / hsl.
    // The i18n values are all `oklch(...)`; we whitelist that prefix.
    if (val.includes('(') && !/^(oklch|rgb|hsl|rgba|hsla)\(/.test(val)) {
      continue
    }
    if (val.includes('url(') || val.includes('expression(')) continue
    out[prop] = val
  }
  return out as React.CSSProperties
}
