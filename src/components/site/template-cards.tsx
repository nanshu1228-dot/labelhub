'use client'
import { useLang, type DictKey } from '@/lib/i18n'

/**
 * §02 Templates — three mode cards, each with its own mini visualization.
 *
 * The three cards correspond 1:1 to the three template modes that actually
 * ship in the engine (`pair-rubric`, `arena-gsb`, `agent-trace-eval`).
 *
 * Cards share a single bordered container; gap: 1px reveals the divider.
 */
export function TemplateCards() {
  const { t } = useLang()
  return (
    <section id="templates" className="hairline">
      <div className="max-w-[1280px] mx-auto px-6 pt-20 pb-28">
        <div className="flex items-end justify-between mb-10 gap-6">
          <div>
            <div className="lh-mono lh-caption mb-3" style={{ color: 'oklch(0.6 0.18 280)' }}>
              {t('tpl_section')}
            </div>
            <h2 className="lh-h2" style={{ color: 'oklch(0.92 0 0)', maxWidth: 720 }}>
              {t('tpl_h')}
            </h2>
          </div>
          <a
            href="#"
            className="lh-body-sm lh-mono hidden md:inline-flex items-center gap-2"
            style={{ color: 'oklch(0.55 0 0)' }}
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

        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-[1px]"
          style={{
            background: 'oklch(0.22 0 0)',
            border: '1px solid oklch(0.22 0 0)',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          <CardPairRubric />
          <CardArenaGsb />
          <CardAgentTraceEval />
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4">
          <p
            className="lh-body"
            style={{ color: 'oklch(0.55 0 0)', maxWidth: 560 }}
          >
            {t('tpl_closing')}
          </p>
          <div className="flex items-center gap-3">
            <a href="/docs" className="lh-btn lh-btn-ghost">{t('tpl_spec')}</a>
            <a href="/workspaces/new" className="lh-btn lh-btn-solid">
              <span>{t('cta_start')}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M3 6h6m0 0L6 3m3 3L6 9"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="square"
                />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

function CardShell({ children }: { children: React.ReactNode }) {
  return <article className="p-6" style={{ background: 'oklch(0.13 0 0)' }}>{children}</article>
}

function CardHeader({ tag, badge }: { tag: DictKey; badge: React.ReactNode }) {
  const { t } = useLang()
  return (
    <div className="flex items-center justify-between mb-5">
      <span className="mode-tag">{t(tag)}</span>
      {badge}
    </div>
  )
}

function CardFooter({ title, body }: { title: DictKey; body: DictKey }) {
  const { t } = useLang()
  return (
    <>
      <h3 className="lh-h4 mt-5 mb-2" style={{ color: 'oklch(0.92 0 0)' }}>{t(title)}</h3>
      <p className="lh-body-sm" style={{ color: 'oklch(0.55 0 0)' }}>{t(body)}</p>
    </>
  )
}

/* ── 01 Pair Rubric — yes/no per model checklist ─────────────────────────── */
function CardPairRubric() {
  const { t } = useLang()
  // Visual: 5 rubric rows × A/B columns of yes/no chips.
  // Mix of yes (violet), no (muted), and pending (faint) cells so it
  // reads as "in progress".
  const rows: Array<{ a: 1 | 0 | -1; b: 1 | 0 | -1; label: string }> = [
    { a: 1, b: 0, label: 'cites sources' },
    { a: 1, b: 1, label: 'no hallucination' },
    { a: 0, b: 1, label: 'follows format' },
    { a: 1, b: 0, label: 'reasoning shown' },
    { a: -1, b: -1, label: 'safety check' },
  ]
  return (
    <CardShell>
      <CardHeader tag="c1_tag" badge={<span className="badge">{t('c1_badge')}</span>} />
      <div className="space-y-1.5 mb-2">
        <div className="grid grid-cols-[1fr_44px_44px] gap-2 items-center">
          <span />
          <span
            className="lh-mono lh-caption text-center"
            style={{ color: 'oklch(0.65 0.18 200)' }}
          >
            A
          </span>
          <span
            className="lh-mono lh-caption text-center"
            style={{ color: 'oklch(0.7 0.18 30)' }}
          >
            B
          </span>
        </div>
        {rows.map((r, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_44px_44px] gap-2 items-center"
          >
            <span
              className="lh-mono"
              style={{ color: 'oklch(0.62 0 0)', fontSize: 11.5 }}
            >
              {r.label}
            </span>
            <YesNoChip v={r.a} side="a" />
            <YesNoChip v={r.b} side="b" />
          </div>
        ))}
      </div>
      <CardFooter title="c1_title" body="c1_body" />
    </CardShell>
  )
}

function YesNoChip({ v, side }: { v: 1 | 0 | -1; side: 'a' | 'b' }) {
  const sideColor = side === 'a' ? 'oklch(0.65 0.18 200)' : 'oklch(0.7 0.18 30)'
  if (v === -1) {
    return (
      <span
        className="lh-mono"
        style={{
          fontSize: 10,
          color: 'oklch(0.42 0 0)',
          textAlign: 'center',
          padding: '2px 0',
          border: '1px dashed oklch(0.27 0 0)',
          borderRadius: 4,
        }}
      >
        —
      </span>
    )
  }
  if (v === 1) {
    return (
      <span
        className="lh-mono"
        style={{
          fontSize: 10,
          color: 'white',
          background: sideColor,
          textAlign: 'center',
          padding: '2px 0',
          borderRadius: 4,
          fontWeight: 600,
        }}
      >
        yes
      </span>
    )
  }
  return (
    <span
      className="lh-mono"
      style={{
        fontSize: 10,
        color: 'oklch(0.55 0 0)',
        background: 'transparent',
        textAlign: 'center',
        padding: '2px 0',
        borderRadius: 4,
        border: '1px solid oklch(0.27 0 0)',
      }}
    >
      no
    </span>
  )
}

/* ── 02 Arena GSB — head-to-head 1-5 ─────────────────────────────────────── */
function CardArenaGsb() {
  const { t } = useLang()
  // Visual: two model "scorecards" with 3 dimensions each, plus a
  // verdict bar at the bottom showing A/B/tie split.
  const dims = [
    { name: 'helpful', a: 4, b: 3 },
    { name: 'factual', a: 5, b: 3 },
    { name: 'concise', a: 3, b: 4 },
  ]
  return (
    <CardShell>
      <CardHeader
        tag="c2_tag"
        badge={
          <span className="badge lh-mono">
            elo <span style={{ color: 'oklch(0.78 0 0)' }}>1284</span>
          </span>
        }
      />
      <div
        className="rounded-lg overflow-hidden mb-3"
        style={{ border: '1px solid oklch(0.22 0 0)' }}
      >
        <div
          className="grid grid-cols-[1fr_46px_46px] items-center px-3 py-2"
          style={{ borderBottom: '1px solid oklch(0.22 0 0)', background: 'oklch(0.155 0 0)' }}
        >
          <span className="lh-mono lh-caption" style={{ color: 'oklch(0.42 0 0)' }}>
            dimension
          </span>
          <span
            className="lh-mono lh-caption text-center"
            style={{ color: 'oklch(0.65 0.18 200)' }}
          >
            A
          </span>
          <span
            className="lh-mono lh-caption text-center"
            style={{ color: 'oklch(0.7 0.18 30)' }}
          >
            B
          </span>
        </div>
        {dims.map((d, i) => (
          <div
            key={d.name}
            className="grid grid-cols-[1fr_46px_46px] items-center px-3 py-2"
            style={{
              borderTop: i === 0 ? 'none' : '1px solid oklch(0.22 0 0)',
            }}
          >
            <span
              className="lh-mono"
              style={{ color: 'oklch(0.78 0 0)', fontSize: 11.5 }}
            >
              {d.name}
            </span>
            <ScorePip n={d.a} side="a" />
            <ScorePip n={d.b} side="b" />
          </div>
        ))}
      </div>

      <div
        className="flex items-center justify-between mb-2 lh-caption lh-mono"
        style={{ color: 'oklch(0.55 0 0)' }}
      >
        <span style={{ color: 'oklch(0.6 0.18 280)' }}>{t('c2_wins')}</span>
        <span>{t('c2_b')}</span>
      </div>
      <div className="vote-bar mb-1">
        <div className="a" style={{ width: '64%' }} />
        <div className="b" style={{ width: '36%' }} />
      </div>

      <CardFooter title="c2_title" body="c2_body" />
    </CardShell>
  )
}

function ScorePip({ n, side }: { n: number; side: 'a' | 'b' }) {
  const color = side === 'a' ? 'oklch(0.65 0.18 200)' : 'oklch(0.7 0.18 30)'
  return (
    <span
      className="lh-mono"
      style={{
        fontSize: 11,
        textAlign: 'center',
        padding: '2px 0',
        background: `${color}1f`,
        color,
        border: `1px solid ${color}55`,
        borderRadius: 4,
        fontWeight: 600,
      }}
    >
      {n}
    </span>
  )
}

/* ── 03 Agent Trace Eval — per-step rubric ───────────────────────────────── */
function CardAgentTraceEval() {
  const { t } = useLang()
  // Visual: a vertical agent-trajectory timeline with step kinds
  // (thinking, tool, result, final), each annotated with a tiny
  // rubric verdict on the right.
  const steps: Array<{
    kind: 'think' | 'tool' | 'result' | 'final'
    label: string
    verdict: 'ok' | 'flag' | 'miss' | null
  }> = [
    { kind: 'think', label: 'plan: search → verify → cite', verdict: 'ok' },
    { kind: 'tool', label: 'web_search("ICD-10 R51")', verdict: 'ok' },
    { kind: 'result', label: 'returned 12 candidates', verdict: 'flag' },
    { kind: 'tool', label: 'fetch_url(top result)', verdict: 'miss' },
    { kind: 'final', label: 'answer with citation', verdict: null },
  ]
  return (
    <CardShell>
      <CardHeader
        tag="c3_tag"
        badge={
          <span className="badge">
            <span className="pulse" />
            <span>{t('c3_badge')}</span>
          </span>
        }
      />
      <div
        className="rounded-lg overflow-hidden mb-2"
        style={{ border: '1px solid oklch(0.22 0 0)' }}
      >
        {steps.map((s, i) => (
          <div
            key={i}
            className="grid grid-cols-[16px_1fr_44px] items-center gap-2 px-2.5 py-1.5"
            style={{
              borderTop: i === 0 ? 'none' : '1px solid oklch(0.22 0 0)',
              background: i === steps.length - 1 ? 'oklch(0.155 0 0)' : 'transparent',
            }}
          >
            <KindGlyph kind={s.kind} />
            <span
              className="lh-mono"
              style={{
                color: s.kind === 'final' ? 'oklch(0.92 0 0)' : 'oklch(0.72 0 0)',
                fontSize: 11.5,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {s.label}
            </span>
            <VerdictPip v={s.verdict} />
          </div>
        ))}
      </div>
      <CardFooter title="c3_title" body="c3_body" />
    </CardShell>
  )
}

function KindGlyph({ kind }: { kind: 'think' | 'tool' | 'result' | 'final' }) {
  // Each step kind gets its own glyph + color so the trajectory reads
  // at a glance the way it does in the real annotator.
  const config = {
    think: { ch: '◇', color: 'oklch(0.55 0 0)' },
    tool: { ch: '▸', color: 'oklch(0.6 0.18 280)' },
    result: { ch: '◂', color: 'oklch(0.5 0.13 150)' },
    final: { ch: '★', color: 'oklch(0.92 0 0)' },
  }[kind]
  return (
    <span
      className="lh-mono"
      style={{
        color: config.color,
        fontSize: 12,
        textAlign: 'center',
      }}
    >
      {config.ch}
    </span>
  )
}

function VerdictPip({ v }: { v: 'ok' | 'flag' | 'miss' | null }) {
  if (v === null) {
    return (
      <span
        className="lh-mono"
        style={{
          fontSize: 9.5,
          color: 'oklch(0.42 0 0)',
          textAlign: 'center',
          letterSpacing: '0.04em',
        }}
      >
        pending
      </span>
    )
  }
  const config = {
    ok: { ch: '✓', color: 'oklch(0.5 0.13 150)' },
    flag: { ch: '!', color: 'oklch(0.7 0.14 75)' },
    miss: { ch: '×', color: 'oklch(0.6 0.2 25)' },
  }[v]
  return (
    <span
      className="lh-mono"
      style={{
        fontSize: 10,
        color: 'white',
        background: config.color,
        textAlign: 'center',
        padding: '2px 0',
        borderRadius: 4,
        fontWeight: 700,
      }}
    >
      {config.ch}
    </span>
  )
}
