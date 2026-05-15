import 'server-only'
import { and, eq, gte, inArray, lt } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events } from '@/lib/db/schema'

/**
 * Per-week quality trend for a workspace. The "flywheel" visualization:
 * does the workspace's agreement / approval rate trend up as more
 * guideline patches land + raters calibrate?
 *
 * Data source: `events` table — we fold `annotation.approved` and
 * `annotation.rejected` events into a per-week approval ratio (Bayesian
 * smoothed). One number per week, plus a sample count.
 *
 * Mode-agnostic: works for agent-trace-eval, pair-rubric, and arena-gsb
 * alike because all three emit the same approve/reject event shape.
 *
 * Why approval rate (not peer agreement): approval is the single
 * authoritative signal the platform optimizes for. Peer agreement is
 * an earlier proxy that's noisy without admin reviews. The trend line
 * the demo wants to show is "we're getting better at approving"
 * — exactly this metric.
 */

export interface QualityTrendBucket {
  /** ISO week start, Monday 00:00 UTC. */
  weekStart: Date
  /** Smoothed approval rate in [0, 1]. */
  approvalRate: number
  /** Total reviewed (approved + rejected) in this week. */
  sampleSize: number
  approved: number
  rejected: number
}

const PRIOR_ALPHA = 2.5
const PRIOR_BETA = 2.5

function smoothed(approved: number, rejected: number): number {
  return (
    (approved + PRIOR_ALPHA) /
    (approved + rejected + PRIOR_ALPHA + PRIOR_BETA)
  )
}

/** UTC Monday at 00:00 of the week containing `d`. */
function weekStartUTC(d: Date): Date {
  const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const x = new Date(ms)
  // getUTCDay: Sunday=0, Monday=1, ... Saturday=6
  const dayOfWeek = (x.getUTCDay() + 6) % 7 // Monday=0
  x.setUTCDate(x.getUTCDate() - dayOfWeek)
  return x
}

/**
 * Returns up to `weeks` most-recent weekly buckets (current week last).
 * Weeks with zero reviewed annotations are still emitted (sampleSize=0)
 * so the SVG can draw a continuous time axis.
 */
export async function getWorkspaceQualityTrend(opts: {
  workspaceId: string
  weeks?: number
}): Promise<QualityTrendBucket[]> {
  const db = getDb()
  const weekCount = Math.max(4, Math.min(opts.weeks ?? 12, 52))

  const now = new Date()
  const oldestWeek = weekStartUTC(
    new Date(now.getTime() - (weekCount - 1) * 7 * 24 * 60 * 60 * 1000),
  )

  const rows = await db
    .select({
      type: events.type,
      ts: events.ts,
    })
    .from(events)
    .where(
      and(
        eq(events.workspaceId, opts.workspaceId),
        inArray(events.type, ['annotation.approved', 'annotation.rejected']),
        gte(events.ts, oldestWeek),
      ),
    )

  // Initialize a bucket per week so empty weeks don't gap the chart.
  const buckets = new Map<number, { approved: number; rejected: number }>()
  for (let i = 0; i < weekCount; i++) {
    const wk = new Date(
      oldestWeek.getTime() + i * 7 * 24 * 60 * 60 * 1000,
    )
    buckets.set(wk.getTime(), { approved: 0, rejected: 0 })
  }
  for (const r of rows) {
    const wk = weekStartUTC(r.ts).getTime()
    const b = buckets.get(wk)
    if (!b) continue // outside our window — shouldn't happen given gte filter
    if (r.type === 'annotation.approved') b.approved++
    else b.rejected++
  }

  const out: QualityTrendBucket[] = []
  for (const [ts, b] of [...buckets.entries()].sort((a, c) => a[0] - c[0])) {
    out.push({
      weekStart: new Date(ts),
      approved: b.approved,
      rejected: b.rejected,
      sampleSize: b.approved + b.rejected,
      approvalRate: smoothed(b.approved, b.rejected),
    })
  }
  return out
}
