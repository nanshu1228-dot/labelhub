import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  optionalUser,
  requireWorkspaceAdmin,
} from '@/lib/auth/guards'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import {
  getRaterDrilldown,
  type RaterAxisRow,
  type RaterSpeedStats,
} from '@/lib/queries/rater-drilldown'
import { formatElapsed } from '@/lib/queries/annotation-time'
import { readTrustStatus } from '@/lib/actions/trust-status'
import { TrustStatusControls } from '@/components/quality/trust-status-controls'

export const metadata: Metadata = {
  title: 'Rater calibration — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/quality/raters/[userId]
 *
 * Drill-down for ONE rater in ONE workspace. Shows:
 *
 *   1. Submission totals (submitted / approved / rejected)
 *   2. Per-axis alignment table — where they agree with consensus,
 *      where they drift. Sorted worst-first so admins can spot
 *      the rubrics/dimensions/step-kinds that need calibration
 *      conversations.
 *
 * Admin-only — these scores are operational intelligence that, if
 * shown to the rater themselves, create perverse incentives (people
 * optimize for the score, not for accurate annotation).
 */
export default async function RaterDrilldownPage(props: {
  params: Promise<{ id: string; userId: string }>
}) {
  const { id: workspaceId, userId } = await props.params

  const me = await optionalUser()
  if (!me) {
    redirect(
      `/signin?next=/workspaces/${workspaceId}/quality/raters/${userId}`,
    )
  }
  try {
    await requireWorkspaceAdmin(workspaceId)
  } catch {
    notFound()
  }

  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()

  const [drill, trustStatus] = await Promise.all([
    getRaterDrilldown({ userId, workspaceId }),
    readTrustStatus({ userId, workspaceId }),
  ])
  if (!drill) notFound()

  return (
    <div
      className="app-light min-h-screen px-6 py-8"
      style={{ background: 'var(--bg)' }}
    >
      <main className="max-w-[1000px] mx-auto">
        <nav className="ts-12 mono flex items-center gap-1.5 mb-4">
          <Link
            href={`/workspaces/${workspaceId}`}
            style={{ color: 'var(--mute)' }}
            className="hover:underline"
          >
            {workspace.name}
          </Link>
          <span style={{ color: 'var(--mute2)' }}>·</span>
          <Link
            href={`/workspaces/${workspaceId}/quality`}
            style={{ color: 'var(--mute)' }}
            className="hover:underline"
          >
            quality
          </Link>
          <span style={{ color: 'var(--mute2)' }}>·</span>
          <span style={{ color: 'var(--text)' }}>
            {drill.displayName ?? drill.email?.split('@')[0] ?? 'rater'}
          </span>
        </nav>

        <div className="mb-2">
          <div className="lbl">§ RATER CALIBRATION</div>
        </div>
        <h1
          className="ts-24 mb-1"
          style={{ color: 'var(--hi)', fontWeight: 600 }}
        >
          {drill.displayName ??
            drill.email?.split('@')[0] ??
            drill.userId.slice(0, 8)}
        </h1>
        {drill.email && (
          <p className="ts-12 mono mb-6" style={{ color: 'var(--mute2)' }}>
            {drill.email}
          </p>
        )}

        <section className="mb-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="SUBMITTED" value={drill.totalSubmitted} />
            <Stat label="APPROVED" value={drill.approved} accent="ok" />
            <Stat label="REJECTED" value={drill.rejected} accent="bad" />
            <Stat
              label="APPROVAL RATE"
              value={
                drill.approved + drill.rejected === 0
                  ? '—'
                  : `${Math.round((drill.approved / (drill.approved + drill.rejected)) * 100)}%`
              }
            />
          </div>
        </section>

        <section className="mb-8">
          <div className="flex items-baseline justify-between mb-2">
            <div className="lbl">§ TRUST STATUS</div>
            <StatusChip status={trustStatus} />
          </div>
          <TrustStatusControls
            workspaceId={workspaceId}
            userId={userId}
            currentStatus={trustStatus}
            raterName={
              drill.displayName ??
              drill.email?.split('@')[0] ??
              drill.userId.slice(0, 8)
            }
          />
        </section>

        <SpeedSection speed={drill.speed} />

        <section className="mb-8">
          <div className="flex items-baseline justify-between mb-2">
            <div className="lbl">§ ALIGNMENT BY AXIS (worst first)</div>
            <div className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
              {drill.axes.length} axes
            </div>
          </div>
          {drill.axes.length === 0 ? (
            <div
              className="rounded-md px-4 py-6 text-center ts-13"
              style={{
                background: 'var(--panel)',
                border: '1px dashed var(--line)',
                color: 'var(--mute2)',
              }}
            >
              No multi-rater data yet — this user&apos;s alignment can&apos;t
              be measured until at least one other rater submits on the same
              topic.
            </div>
          ) : (
            <AxisTable rows={drill.axes} />
          )}
          <p
            className="ts-11 mt-2 mono"
            style={{ color: 'var(--mute2)' }}
          >
            Axis legend: <span style={{ color: 'var(--text)' }}>pair|&lt;rubric&gt;|&lt;side&gt;</span>{' '}
            (pair-rubric) ·{' '}
            <span style={{ color: 'var(--text)' }}>arena|&lt;dim&gt;|&lt;side&gt;</span>{' '}
            (arena-gsb) ·{' '}
            <span style={{ color: 'var(--text)' }}>traj|&lt;step-kind&gt;</span>{' '}
            (agent-trace-eval)
          </p>
        </section>
      </main>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent?: 'ok' | 'bad'
}) {
  const color =
    accent === 'ok'
      ? 'oklch(0.65 0.18 200)'
      : accent === 'bad'
        ? 'var(--danger)'
        : 'var(--text)'
  return (
    <div
      className="rounded-md p-3"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div
        className="ts-11 mono mb-1"
        style={{ color: 'var(--mute2)' }}
      >
        {label}
      </div>
      <div
        className="ts-20 mono"
        style={{ color, fontWeight: 600 }}
      >
        {value}
      </div>
    </div>
  )
}

/**
 * Time-on-task summary block.
 *
 * Renders four tiles: measured-count, median time, p10 (fast outlier),
 * suspiciously-fast count. The 'suspiciously fast' tile turns red when
 * non-zero — that's the cheap-shot water-army signal admins want
 * surfaced immediately.
 *
 * When measuredCount is 0 (no rows have started_at/durationSec yet —
 * e.g. fresh deploy before any annotation finished post-rollout), we
 * collapse to a friendly empty state instead of showing four '—' tiles.
 */
/**
 * Compact chip echoing the rater's trust lifecycle state next to the
 * §TRUST STATUS section header. Colors carry the urgency — active is
 * neutral, probation is amber (admin reviewing closely), suspended is
 * danger red.
 */
function StatusChip({ status }: { status: 'active' | 'probation' | 'suspended' }) {
  const palette = {
    active: {
      fg: 'oklch(0.5 0.13 150)',
      bg: 'oklch(0.5 0.13 150 / 0.12)',
      label: 'active',
    },
    probation: {
      fg: 'oklch(0.55 0.14 75)',
      bg: 'oklch(0.6 0.14 75 / 0.15)',
      label: 'probation',
    },
    suspended: {
      fg: 'var(--danger)',
      bg: 'var(--danger-soft)',
      label: 'suspended',
    },
  }[status]
  return (
    <span
      className="mono ts-11 px-2 py-0.5 rounded"
      style={{
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.fg}55`,
        fontWeight: 600,
      }}
    >
      {palette.label}
    </span>
  )
}

function SpeedSection({ speed }: { speed: RaterSpeedStats }) {
  if (speed.measuredCount === 0) {
    return (
      <section className="mb-8">
        <div className="lbl mb-2">§ TIME ON TASK</div>
        <div
          className="rounded-md px-4 py-4 ts-13"
          style={{
            background: 'var(--panel)',
            border: '1px dashed var(--line)',
            color: 'var(--mute2)',
          }}
        >
          No timing data yet — duration is recorded from{' '}
          <span className="mono">annotations.started_at</span> on save
          and finalized at submit. New submissions after the rollout
          will populate these stats.
          {speed.unknownCount > 0 && (
            <span>
              {' '}({speed.unknownCount} legacy submission
              {speed.unknownCount === 1 ? '' : 's'} have no duration.)
            </span>
          )}
        </div>
      </section>
    )
  }
  const hasFastFlag = speed.suspiciouslyFastCount > 0
  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between mb-2">
        <div className="lbl">§ TIME ON TASK</div>
        <div className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
          {speed.measuredCount} measured
          {speed.unknownCount > 0
            ? ` · ${speed.unknownCount} unknown`
            : ''}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="MEDIAN"
          value={formatElapsed(speed.medianSec)}
        />
        <Stat
          label="P10 (FAST END)"
          value={formatElapsed(speed.p10Sec)}
        />
        <Stat
          label="P90 (SLOW END)"
          value={formatElapsed(speed.p90Sec)}
        />
        <Stat
          label="< 10s SUBMITS"
          value={speed.suspiciouslyFastCount}
          accent={hasFastFlag ? 'bad' : undefined}
        />
      </div>
      {hasFastFlag && (
        <p
          className="ts-12 mono mt-2"
          style={{ color: 'var(--danger)' }}
        >
          ⚠ {speed.suspiciouslyFastCount} submission
          {speed.suspiciouslyFastCount === 1 ? '' : 's'} under 10 seconds —
          unusually fast for any annotation mode. Worth a manual review
          before approving.
        </p>
      )}
    </section>
  )
}

function AxisTable({ rows }: { rows: RaterAxisRow[] }) {
  return (
    <div
      className="rounded-md overflow-hidden"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <table className="w-full ts-13">
        <thead>
          <tr
            style={{
              background: 'var(--panel2)',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <th
              className="text-left px-4 py-2 mono ts-11"
              style={{ color: 'var(--mute)' }}
            >
              AXIS
            </th>
            <th
              className="px-4 py-2 mono ts-11 text-center"
              style={{ color: 'var(--mute)', width: 100 }}
            >
              ALIGNED
            </th>
            <th
              className="px-4 py-2 mono ts-11 text-center"
              style={{ color: 'var(--mute)', width: 100 }}
            >
              DIVERGED
            </th>
            <th
              className="px-4 py-2 mono ts-11 text-center"
              style={{ color: 'var(--mute)', width: 100 }}
            >
              UNILATERAL
            </th>
            <th
              className="px-4 py-2 mono ts-11 text-center"
              style={{ color: 'var(--mute)', width: 120 }}
            >
              ALIGNMENT
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr
              key={r.axisId}
              style={{
                borderTop:
                  idx === 0 ? 'none' : '1px solid var(--line)',
              }}
            >
              <td
                className="px-4 py-2 mono ts-12"
                style={{ color: 'var(--text)' }}
              >
                {r.axisLabel}
              </td>
              <td
                className="px-4 py-2 mono ts-12 text-center"
                style={{ color: 'oklch(0.65 0.18 200)' }}
              >
                {r.aligned}
              </td>
              <td
                className="px-4 py-2 mono ts-12 text-center"
                style={{
                  color: r.diverged > 0 ? 'var(--danger)' : 'var(--mute)',
                }}
              >
                {r.diverged}
              </td>
              <td
                className="px-4 py-2 mono ts-12 text-center"
                style={{ color: 'var(--mute2)' }}
              >
                {r.unilateral}
              </td>
              <td
                className="px-4 py-2 mono ts-12 text-center"
                style={{
                  color:
                    r.aligned + r.diverged === 0
                      ? 'var(--mute2)'
                      : r.score >= 0.8
                        ? 'oklch(0.65 0.18 200)'
                        : r.score >= 0.5
                          ? 'oklch(0.7 0.14 75)'
                          : 'var(--danger)',
                  fontWeight: 600,
                }}
              >
                {r.aligned + r.diverged === 0
                  ? '—'
                  : `${Math.round(r.score * 100)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
