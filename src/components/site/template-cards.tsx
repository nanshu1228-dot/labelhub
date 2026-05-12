'use client'
import { useLang, type DictKey } from '@/lib/i18n'

/**
 * §02 Templates — 6 mode cards, each with its own mini visualization.
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
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[1px]"
          style={{
            background: 'oklch(0.22 0 0)',
            border: '1px solid oklch(0.22 0 0)',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          <CardClassic />
          <CardPair />
          <CardArena />
          <CardToken />
          <CardGame />
          <CardApprentice />
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4">
          <p
            className="lh-body"
            style={{ color: 'oklch(0.55 0 0)', maxWidth: 560 }}
          >
            {t('tpl_closing')}
          </p>
          <div className="flex items-center gap-3">
            <a href="#" className="lh-btn lh-btn-ghost">{t('tpl_spec')}</a>
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

/* ── 01 Classic Survey — rubric grid ─────────────────────────────────────── */
function CardClassic() {
  const { t } = useLang()
  const rows = [
    [1, 0, 0.5, 0],
    [0, 1, 0, 0],
    [0.5, 1, 1, 0],
    [0, 0, 0, 1],
    [1, 0, 0.5, 0],
  ]
  // 0 = empty, 0.5 = hover, 1 = on
  return (
    <CardShell>
      <CardHeader tag="c1_tag" badge={<span className="badge">{t('c1_badge')}</span>} />
      <div className="rubric mb-5">
        <div className="rubric-cell col" />
        <div className="rubric-cell col">A</div>
        <div className="rubric-cell col">B</div>
        <div className="rubric-cell col">C</div>
        <div className="rubric-cell col">D</div>
        {rows.map((row, ri) => (
          <RubricRow key={ri} idx={ri + 1} cells={row} />
        ))}
        <div className="rubric-cell lbl">…</div>
        <div className="rubric-cell" style={{ opacity: 0.4 }} />
        <div className="rubric-cell" style={{ opacity: 0.4 }} />
        <div className="rubric-cell" style={{ opacity: 0.4 }} />
        <div className="rubric-cell" style={{ opacity: 0.4 }} />
      </div>
      <CardFooter title="c1_title" body="c1_body" />
    </CardShell>
  )
}

function RubricRow({ idx, cells }: { idx: number; cells: number[] }) {
  return (
    <>
      <div className="rubric-cell lbl">{String(idx).padStart(3, '0')}</div>
      {cells.map((v, i) => (
        <div
          key={i}
          className={`rubric-cell ${v === 1 ? 'on' : v === 0.5 ? 'h' : ''}`}
        />
      ))}
    </>
  )
}

/* ── 02 Pair Annotation — two cursors ────────────────────────────────────── */
function CardPair() {
  const { t } = useLang()
  return (
    <CardShell>
      <CardHeader
        tag="c2_tag"
        badge={
          <span className="badge">
            <span className="pulse" />
            <span>{t('c2_badge')}</span>
          </span>
        }
      />
      <div
        className="pair-canvas mb-5"
        style={{ border: '1px dashed oklch(0.22 0 0)', borderRadius: 8 }}
      >
        <div className="pair-trail" style={{ left: '12%', right: '12%', top: '38%' }} />
        <div className="pair-trail violet" style={{ left: '12%', right: '12%', top: '62%' }} />
        <div className="pair-target" />
        <div className="cursor cursor-a" style={{ left: '14%', top: '28%', color: 'oklch(0.92 0 0)' }}>
          <svg viewBox="0 0 14 14" fill="currentColor">
            <path d="M1 1l5 12 2-5 5-2L1 1z" />
          </svg>
          <div
            className="lh-mono mt-1 inline-block px-1.5 py-0.5 rounded"
            style={{ background: 'oklch(0.22 0 0)', color: 'oklch(0.78 0 0)', fontSize: 10 }}
          >
            you
          </div>
        </div>
        <div className="cursor cursor-b" style={{ right: '14%', bottom: '28%', color: 'oklch(0.6 0.18 280)' }}>
          <svg viewBox="0 0 14 14" fill="currentColor">
            <path d="M13 13L8 1 6 6 1 8l12 5z" />
          </svg>
          <div
            className="lh-mono mt-1 inline-block px-1.5 py-0.5 rounded"
            style={{
              background: 'oklch(0.6 0.18 280 / 0.18)',
              color: 'oklch(0.6 0.18 280)',
              fontSize: 10,
            }}
          >
            claude
          </div>
        </div>
      </div>
      <CardFooter title="c2_title" body="c2_body" />
    </CardShell>
  )
}

/* ── 03 Arena Battle — head-to-head ──────────────────────────────────────── */
function CardArena() {
  const { t } = useLang()
  return (
    <CardShell>
      <CardHeader
        tag="c3_tag"
        badge={
          <span className="badge lh-mono">
            elo <span style={{ color: 'oklch(0.78 0 0)' }}>1284</span>
          </span>
        }
      />
      <div className="arena mb-3">
        <div className="arena-side win">
          <div className="flex items-center justify-between">
            <span className="lh-mono lh-caption" style={{ color: 'oklch(0.6 0.18 280)' }}>A</span>
            <span className="lh-mono lh-caption" style={{ color: 'oklch(0.42 0 0)' }}>claude-4.7</span>
          </div>
          <div className="space-y-1">
            <div className="h-1 rounded-full" style={{ background: 'oklch(0.27 0 0)', width: '78%' }} />
            <div className="h-1 rounded-full" style={{ background: 'oklch(0.27 0 0)', width: '92%' }} />
            <div className="h-1 rounded-full" style={{ background: 'oklch(0.27 0 0)', width: '64%' }} />
          </div>
        </div>
        <div className="vs">vs</div>
        <div className="arena-side">
          <div className="flex items-center justify-between">
            <span className="lh-mono lh-caption" style={{ color: 'oklch(0.55 0 0)' }}>B</span>
            <span className="lh-mono lh-caption" style={{ color: 'oklch(0.42 0 0)' }}>gpt-5o</span>
          </div>
          <div className="space-y-1">
            <div className="h-1 rounded-full" style={{ background: 'oklch(0.22 0 0)', width: '56%' }} />
            <div className="h-1 rounded-full" style={{ background: 'oklch(0.22 0 0)', width: '71%' }} />
            <div className="h-1 rounded-full" style={{ background: 'oklch(0.22 0 0)', width: '40%' }} />
          </div>
        </div>
      </div>

      <div
        className="flex items-center justify-between mb-3 lh-caption lh-mono"
        style={{ color: 'oklch(0.55 0 0)' }}
      >
        <span style={{ color: 'oklch(0.6 0.18 280)' }}>{t('c3_wins')}</span>
        <span>{t('c3_b')}</span>
      </div>
      <div className="vote-bar mb-5">
        <div className="a" style={{ width: '64%' }} />
        <div className="b" style={{ width: '36%' }} />
      </div>

      <CardFooter title="c3_title" body="c3_body" />
    </CardShell>
  )
}

/* ── 04 Token Economy — LBH ledger ───────────────────────────────────────── */
function CardToken() {
  const { t } = useLang()
  return (
    <CardShell>
      <CardHeader tag="c4_tag" badge={<span className="badge lh-mono">{t('c4_badge')}</span>} />

      <div className="mb-1 flex items-baseline gap-2">
        <span className="lh-h2 lh-mono" style={{ color: 'oklch(0.92 0 0)', letterSpacing: '-0.02em' }}>
          2,184
        </span>
        <span className="lh-mono lh-caption" style={{ color: 'oklch(0.55 0 0)' }}>
          {t('c4_balance')}
        </span>
      </div>
      <div className="lh-caption lh-mono mb-4" style={{ color: 'oklch(0.6 0.18 280)' }}>
        ▲ +6.2% · 7d
      </div>

      <div className="ledger-bar mb-2" />
      <div className="space-y-1.5">
        <LedgerRow up label={t('c4_l1')} amt="+42" />
        <LedgerRow up label={t('c4_l2')} amt="+38" />
        <LedgerRow label={t('c4_l3')} amt="+24" />
        <LedgerRow label={t('c4_l4')} amt="+18" />
      </div>

      <CardFooter title="c4_title" body="c4_body" />
    </CardShell>
  )
}

function LedgerRow({ up, label, amt }: { up?: boolean; label: string; amt: string }) {
  return (
    <div className={`ledger-row ${up ? 'up' : ''}`}>
      <span className="dot" />
      <span className="lbl">{label}</span>
      <span className="amt">{amt}</span>
    </div>
  )
}

/* ── 05 Game Mode — streak chips ─────────────────────────────────────────── */
function CardGame() {
  const { t } = useLang()
  return (
    <CardShell>
      <CardHeader
        tag="c5_tag"
        badge={
          <span className="badge lh-mono">
            <span style={{ color: 'oklch(0.78 0 0)' }}>{t('c5_diamond')}</span> · <span>{t('c5_league')}</span>
          </span>
        }
      />

      <div className="flex items-baseline gap-3 mb-3">
        <span className="lh-h2 lh-mono" style={{ color: 'oklch(0.92 0 0)', letterSpacing: '-0.02em' }}>
          17
        </span>
        <span className="lh-mono lh-caption" style={{ color: 'oklch(0.55 0 0)' }}>
          {t('c5_streak')}
        </span>
      </div>

      <div className="chip-tiles mb-4">
        {(['done', 'done', 'done', 'streak', 'streak', 'streak', 'today',
           'done', 'done', 'streak', 'streak', 'streak', 'streak', 'done'] as const).map((s, i) => (
          <div key={i} className={`chip ${s}`} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-1">
        <StatTile label={t('c5_rank')} value="#42" />
        <StatTile label={t('c5_xp')} value="12.4k" />
        <StatTile label={t('c5_mult')} value="×1.8" accent />
      </div>

      <CardFooter title="c5_title" body="c5_body" />
    </CardShell>
  )
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="text-center py-2 rounded"
      style={{ background: 'oklch(0.155 0 0)', border: '1px solid oklch(0.22 0 0)' }}
    >
      <div className="lh-mono lh-caption" style={{ color: 'oklch(0.42 0 0)' }}>{label}</div>
      <div
        className="lh-mono lh-body-sm"
        style={{ color: accent ? 'oklch(0.6 0.18 280)' : 'oklch(0.92 0 0)' }}
      >
        {value}
      </div>
    </div>
  )
}

/* ── 06 Apprentice Mode — chat ───────────────────────────────────────────── */
function CardApprentice() {
  const { t } = useLang()
  return (
    <CardShell>
      <CardHeader
        tag="c6_tag"
        badge={
          <span className="badge">
            <span className="pulse" />
            <span>{t('c6_badge')}</span>
          </span>
        }
      />

      <div className="space-y-2 mb-5" style={{ minHeight: 132 }}>
        <Bubble role="ai" html={t('c6_msg1')} />
        <Bubble role="you" html={t('c6_msg2')} />
        <Bubble role="ai" html={t('c6_msg3')} />
        <Bubble role="you" html={t('c6_msg4')} />
      </div>

      <div
        className="flex items-center gap-2 lh-caption lh-mono pt-3"
        style={{ borderTop: '1px solid oklch(0.22 0 0)', color: 'oklch(0.42 0 0)' }}
      >
        <span style={{ color: 'oklch(0.6 0.18 280)' }}>●</span>
        <span>{t('c6_foot')}</span>
      </div>

      <CardFooter title="c6_title" body="c6_body" />
    </CardShell>
  )
}

function Bubble({ role, html }: { role: 'you' | 'ai'; html: string }) {
  return (
    <div
      className={`bub ${role}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
