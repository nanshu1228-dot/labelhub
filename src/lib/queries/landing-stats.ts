import 'server-only'
import { unstable_cache } from 'next/cache'
import { count, eq, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  trajectories,
  trajectorySteps,
  workspaces,
} from '@/lib/db/schema'

/**
 * Live numbers for the landing page (Phase-15).
 *
 * All counts come from production DB — no fake data. Wrapped in
 * unstable_cache with 60s revalidation so a burst of landing GETs
 * doesn't translate into a burst of count(*) full-table scans
 * (Phase-17 audit fix #F4 — `count(*) FROM trajectory_steps` is
 * O(rows) and the landing is the most-trafficked route).
 *
 * Failure-mode: if any query fails the caller catches and substitutes
 * "—". Better to ship a working landing with dashes than blow up.
 */

export interface LandingStats {
  trajectoriesCaptured: number
  teachingSignals: number // annotations with claudeProposal (Δ between AI and human)
  workspaceCount: number
  toolCallsCaptured: number
}

async function fetchLandingStats(): Promise<LandingStats> {
  const db = getDb()
  const [traj, teaching, ws, tools] = await Promise.all([
    db
      .select({ n: count() })
      .from(trajectories)
      .then((r) => Number(r[0]?.n ?? 0)),
    db
      .select({ n: count() })
      .from(annotations)
      .where(isNotNull(annotations.claudeProposal))
      .then((r) => Number(r[0]?.n ?? 0)),
    db
      .select({ n: count() })
      .from(workspaces)
      .then((r) => Number(r[0]?.n ?? 0)),
    db
      .select({ n: count() })
      .from(trajectorySteps)
      .where(eq(trajectorySteps.kind, 'tool_call'))
      .then((r) => Number(r[0]?.n ?? 0)),
  ])
  return {
    trajectoriesCaptured: traj,
    teachingSignals: teaching,
    workspaceCount: ws,
    toolCallsCaptured: tools,
  }
}

export const getLandingStats = unstable_cache(
  fetchLandingStats,
  ['landing-stats:v1'],
  { revalidate: 60, tags: ['landing-stats'] },
)

// silence unused import
void sql
