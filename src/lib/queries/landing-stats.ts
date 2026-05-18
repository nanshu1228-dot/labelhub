import 'server-only'
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
 * All counts come from production DB — no fake data. We cache via
 * Next's server-component RSC cache (the landing is server-rendered
 * with `force-dynamic` off), so this runs once per build/revalidate
 * window, not on every visitor request.
 *
 * Failure-mode: if any query fails (DB down at build time), the page
 * still renders — the caller catches and substitutes "—". Better to
 * ship a working landing with dashes than blow up the route.
 */

export interface LandingStats {
  trajectoriesCaptured: number
  teachingSignals: number // annotations with claudeProposal (Δ between AI and human)
  workspaceCount: number
  toolCallsCaptured: number
}

export async function getLandingStats(): Promise<LandingStats> {
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

/**
 * Compact formatter: 1234 → "1.2k", 12345 → "12k". Landing-only —
 * admin surfaces should show exact counts.
 */
export function compactNum(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

// silence unused import
void sql
