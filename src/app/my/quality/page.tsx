import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import { getMyQuality } from '@/lib/queries/my-quality'
import { CoachButton } from '@/components/quality/coach-button'

export const metadata: Metadata = {
  title: 'My quality — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /my/quality — annotator self-view.
 *
 * One card per workspace where the user has submission history.
 * Shows: lifecycle status banner (if non-active), cold counts,
 * 8-week approval trend, weak rubric axes, recent reviewer feedback,
 * and the 🪄 AI Coach CTA that turns this raw signal into a
 * personalized note.
 *
 * Deliberately does NOT show a composite trust score — keeps the
 * incentive on "do good work" not "game the number". The lifecycle
 * state IS surfaced because raters need to know when they're under
 * extra review or paused.
 */
export default async function MyQualityPage() {
  const me = await optionalUser()
  if (!me) redirect('/signin?next=/my/quality')
  const snapshot = await getMyQuality(me.id)

  return (
    <main
      className="app-light min-h-screen px-6 py-8"
      style={{ background: 'var(--bg)' }}
    >
      <div className="mx-auto max-w-[900px]">
        <nav
          className="ts-12 mono flex items-center gap-1.5 mb-4"
          style={{ color: 'var(--mute2)' }}
        >
          <Link
            href="/account"
            className="hover:underline"
            style={{ color: 'var(--mute)' }}
          >
            account
          </Link>
          <span>·</span>
          <span style={{ color: 'var(--text)' }}>quality</span>
        </nav>

        <div className="mb-6">
          <div className="lbl mb-2">§ MY QUALITY</div>
          <h1 className="ts-28" style={{ color: 'var(--hi)' }}>
            How my work is landing
          </h1>
          <p
            className="ts-13 mt-2"
            style={{ color: 'var(--mute)', maxWidth: 620 }}
          >
            Per-workspace view of where your annotations get approved,
            where reviewers push back, and what to focus on next.
            We don&apos;t show a composite score on purpose — quality
            is judged by patterns, not a leaderboard. Click{' '}
            <span className="mono">🪄 ask AI Coach</span> for a
            personalized one-page note.
          </p>
        </div>

        {snapshot.workspaces.length === 0 ? (
          <div
            className="rounded-md px-6 py-12 text-center"
            style={{
              background: 'var(--panel)',
              border: '1px dashed var(--line2)',
            }}
          >
            <div
              className="ts-32 mb-2"
              style={{ color: 'var(--mute2)' }}
              aria-hidden
            >
              ◌
            </div>
            <div
              className="ts-14"
              style={{ color: 'var(--text)', fontWeight: 500 }}
            >
              Submit some work first
            </div>
            <p
              className="ts-12 mt-1 mx-auto"
              style={{ color: 'var(--mute)', maxWidth: 360 }}
            >
              You haven&apos;t submitted any annotations yet — once you
              have a few in, this page will show how they&apos;re
              landing.{' '}
              <Link
                href="/my/tasks"
                style={{ color: 'var(--accent)', textDecoration: 'none' }}
              >
                Pick a task →
              </Link>
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {snapshot.workspaces.map((ws) => (
              <WorkspaceCard key={ws.workspaceId} ws={ws} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

function WorkspaceCard({
  ws,
}: {
  ws: Awaited<ReturnType<typeof getMyQuality>>['workspaces'][number]
}) {
  return (
    <section
      className="rounded-xl p-5"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="lbl" style={{ color: 'var(--mute)' }}>
            § {ws.workspaceName.toUpperCase()}
          </div>
          <h2
            className="ts-18 mt-1"
            style={{ color: 'var(--hi)', fontWeight: 500 }}
          >
            Approval pattern + areas to focus on
          </h2>
        </div>
        <CoachButton workspaceId={ws.workspaceId} />
      </div>

      {ws.trustStatus !== 'active' && <StatusBanner ws={ws} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Tile label="SUBMITTED" value={String(ws.submitted)} />
        <Tile label="APPROVED" value={String(ws.approved)} accent="ok" />
        <Tile label="REJECTED" value={String(ws.rejected)} accent="bad" />
        <Tile label="PENDING" value={String(ws.pending)} />
      </div>

      <div className="mb-4">
        <div
          className="ts-12 mono mb-2"
          style={{ color: 'var(--mute2)', letterSpacing: '0.04em' }}
        >
          APPROVAL TREND · LAST 8 WEEKS
        </div>
        <TrendSparkline weekly={ws.trendWeekly} />
      </div>

      {ws.weakAxes.length > 0 && (
        <div className="mb-4">
          <div
            className="ts-12 mono mb-2"
            style={{ color: 'var(--mute2)', letterSpacing: '0.04em' }}
          >
            AREAS TO FOCUS · WHERE YOU DIVERGE FROM PEERS
          </div>
          <ul className="flex flex-wrap gap-2">
            {ws.weakAxes.map((a) => {
              const pct = Math.round(a.rate * 100)
              const color =
                pct >= 70
                  ? 'oklch(0.5 0.13 150)'
                  : pct >= 50
                    ? 'oklch(0.55 0.14 75)'
                    : 'var(--danger)'
              return (
                <li
                  key={a.axisId}
                  className="ts-12 mono px-2 py-1 rounded"
                  style={{
                    background: `${color}1f`,
                    color,
                    border: `1px solid ${color}55`,
                  }}
                  title={`${a.aligned} aligned / ${a.diverged} diverged with peers`}
                >
                  {a.axisId} · {pct}%
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {ws.recentFeedback.length > 0 && (
        <div>
          <div
            className="ts-12 mono mb-2"
            style={{ color: 'var(--mute2)', letterSpacing: '0.04em' }}
          >
            RECENT REVIEWER NOTES
          </div>
          <ul className="flex flex-col gap-2">
            {ws.recentFeedback.map((f, i) => (
              <li
                key={i}
                className="rounded-md p-3"
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--line)',
                  borderLeft: `3px solid ${
                    f.type === 'rejected'
                      ? 'var(--danger)'
                      : 'oklch(0.6 0.14 75)'
                  }`,
                }}
              >
                <div
                  className="ts-11 mono mb-1"
                  style={{ color: 'var(--mute2)' }}
                >
                  {f.type === 'rejected' ? 'rejected' : 'asked to revise'}{' '}
                  · {f.ts.toISOString().slice(0, 10)}
                </div>
                <div
                  className="ts-13"
                  style={{ color: 'var(--text)' }}
                >
                  {f.feedback}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function StatusBanner({
  ws,
}: {
  ws: Awaited<ReturnType<typeof getMyQuality>>['workspaces'][number]
}) {
  const isSus = ws.trustStatus === 'suspended'
  return (
    <div
      className="rounded-md p-4 mb-4"
      style={{
        background: isSus ? 'var(--danger-soft)' : 'oklch(0.6 0.14 75 / 0.1)',
        border: `1px solid ${
          isSus
            ? 'oklch(0.55 0.2 25 / 0.4)'
            : 'oklch(0.6 0.14 75 / 0.4)'
        }`,
      }}
    >
      <div
        className="lbl"
        style={{
          color: isSus ? 'var(--danger)' : 'oklch(0.55 0.14 75)',
          letterSpacing: '0.05em',
        }}
      >
        § {isSus ? 'ACCESS PAUSED' : 'CLOSER REVIEW'}
      </div>
      <h3
        className="ts-15 mt-1"
        style={{ color: 'var(--hi)', fontWeight: 500 }}
      >
        {isSus
          ? 'You can\'t claim new topics in this workspace right now.'
          : "An admin is reviewing your work more closely until calibration is back on track."}
      </h3>
      {ws.trustStatusReason && (
        <p
          className="ts-13 mt-2 mono"
          style={{ color: 'var(--text)' }}
        >
          <span style={{ color: 'var(--mute)' }}>reason: </span>
          {ws.trustStatusReason}
        </p>
      )}
      {ws.trustStatusAt && (
        <p
          className="ts-11 mt-1 mono"
          style={{ color: 'var(--mute2)' }}
        >
          since {ws.trustStatusAt.toISOString().slice(0, 10)}
        </p>
      )}
      <p
        className="ts-12 mt-2"
        style={{ color: 'var(--mute)' }}
      >
        Click <span className="mono">🪄 ask AI Coach</span> above for a
        concrete next-step, or reach out to your admin.
      </p>
    </div>
  )
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: 'ok' | 'bad'
}) {
  const color =
    accent === 'ok'
      ? 'oklch(0.5 0.13 150)'
      : accent === 'bad'
        ? 'var(--danger)'
        : 'var(--text)'
  return (
    <div
      className="rounded-md p-3"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--line)',
      }}
    >
      <div
        className="ts-11 mono mb-1"
        style={{ color: 'var(--mute2)', letterSpacing: '0.04em' }}
      >
        {label}
      </div>
      <div
        className="ts-18 mono"
        style={{ color, fontWeight: 600 }}
      >
        {value}
      </div>
    </div>
  )
}

function TrendSparkline({
  weekly,
}: {
  weekly: Awaited<ReturnType<typeof getMyQuality>>['workspaces'][number]['trendWeekly']
}) {
  const W = 600
  const H = 64
  const padding = 4
  const bars = weekly.length
  const barW = (W - padding * (bars + 1)) / bars
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ maxWidth: 600 }}
    >
      {weekly.map((w, i) => {
        const x = padding + i * (barW + padding)
        if (w.rate == null) {
          return (
            <rect
              key={i}
              x={x}
              y={H - 8}
              width={barW}
              height={4}
              fill="var(--line2)"
              opacity={0.3}
            >
              <title>
                week {i + 1}: too few items ({w.sampleCount})
              </title>
            </rect>
          )
        }
        const h = Math.max(2, Math.round(w.rate * (H - 8)))
        const color =
          w.rate >= 0.8
            ? 'oklch(0.5 0.13 150)'
            : w.rate >= 0.6
              ? 'oklch(0.6 0.18 280)'
              : w.rate >= 0.4
                ? 'oklch(0.6 0.14 75)'
                : 'var(--danger)'
        return (
          <rect
            key={i}
            x={x}
            y={H - h - 4}
            width={barW}
            height={h}
            fill={color}
            rx={2}
          >
            <title>
              week {i + 1}: {Math.round(w.rate * 100)}% approval · {w.sampleCount} items
            </title>
          </rect>
        )
      })}
    </svg>
  )
}
