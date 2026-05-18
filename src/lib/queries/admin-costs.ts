import 'server-only'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  aiCallLog,
  workspaceMembers,
  workspaces,
} from '@/lib/db/schema'

/**
 * Platform-cost rollups for /admin (Phase-19).
 *
 * Scope: only workspaces the viewer admins (cross-tenant cockpit, but
 * never shows another admin's spend). Anchored on `ai_call_log` which
 * every Claude call writes to via `logAICall`.
 *
 * Two views:
 *   getAdminCostSummary  — today + 7d totals per workspace + per feature
 *   getAdminCostSeries   — daily series for the last 14d so the UI can
 *                          render a sparkline
 *
 * No PII — just aggregates.
 */

export interface CostSummary {
  scope: 'today' | 'last7d'
  totalCostUsd: number
  totalTokensIn: number
  totalTokensOut: number
  totalCalls: number
  byWorkspace: Array<{
    workspaceId: string
    workspaceName: string
    costUsd: number
    calls: number
  }>
  byFeature: Array<{
    feature: string
    costUsd: number
    calls: number
  }>
}

/**
 * Return today + last-7d cost summaries, scoped to workspaces the
 * viewer admins. Empty workspace list ⇒ both summaries are zero —
 * caller can short-circuit the render.
 */
export async function getAdminCostSummary(opts: {
  viewerUserId: string
}): Promise<{ today: CostSummary; last7d: CostSummary }> {
  const db = getDb()

  // 1. Workspaces the viewer admins.
  const adminWs = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      name: workspaces.name,
    })
    .from(workspaceMembers)
    .innerJoin(
      workspaces,
      eq(workspaces.id, workspaceMembers.workspaceId),
    )
    .where(
      and(
        eq(workspaceMembers.userId, opts.viewerUserId),
        eq(workspaceMembers.role, 'admin'),
      ),
    )
  const wsIds = adminWs.map((r) => r.workspaceId)
  const wsName = new Map(adminWs.map((r) => [r.workspaceId, r.name]))
  if (wsIds.length === 0) {
    return {
      today: emptySummary('today'),
      last7d: emptySummary('last7d'),
    }
  }

  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)

  const [today, last7d] = await Promise.all([
    summarize(wsIds, wsName, startOfDay, 'today'),
    summarize(wsIds, wsName, sevenDaysAgo, 'last7d'),
  ])

  return { today, last7d }

  async function summarize(
    wsIds: string[],
    wsName: Map<string, string>,
    since: Date,
    scope: 'today' | 'last7d',
  ): Promise<CostSummary> {
    const totals = await db
      .select({
        cost: sql<number>`coalesce(sum(${aiCallLog.costUsd}), 0)::float8`,
        tin: sql<number>`coalesce(sum(${aiCallLog.tokensIn}), 0)::int`,
        tout: sql<number>`coalesce(sum(${aiCallLog.tokensOut}), 0)::int`,
        n: sql<number>`count(*)::int`,
      })
      .from(aiCallLog)
      .where(
        and(
          inArray(aiCallLog.workspaceId, wsIds),
          gte(aiCallLog.ts, since),
        ),
      )
    const byWs = await db
      .select({
        workspaceId: aiCallLog.workspaceId,
        cost: sql<number>`coalesce(sum(${aiCallLog.costUsd}), 0)::float8`,
        n: sql<number>`count(*)::int`,
      })
      .from(aiCallLog)
      .where(
        and(
          inArray(aiCallLog.workspaceId, wsIds),
          gte(aiCallLog.ts, since),
        ),
      )
      .groupBy(aiCallLog.workspaceId)
    const byFeat = await db
      .select({
        feature: aiCallLog.feature,
        cost: sql<number>`coalesce(sum(${aiCallLog.costUsd}), 0)::float8`,
        n: sql<number>`count(*)::int`,
      })
      .from(aiCallLog)
      .where(
        and(
          inArray(aiCallLog.workspaceId, wsIds),
          gte(aiCallLog.ts, since),
        ),
      )
      .groupBy(aiCallLog.feature)

    const t = totals[0]
    return {
      scope,
      totalCostUsd: Number(t?.cost ?? 0),
      totalTokensIn: Number(t?.tin ?? 0),
      totalTokensOut: Number(t?.tout ?? 0),
      totalCalls: Number(t?.n ?? 0),
      byWorkspace: byWs
        .map((r) => ({
          workspaceId: r.workspaceId ?? '',
          workspaceName: r.workspaceId
            ? (wsName.get(r.workspaceId) ?? '?')
            : '(unscoped)',
          costUsd: Number(r.cost),
          calls: Number(r.n),
        }))
        .sort((a, b) => b.costUsd - a.costUsd),
      byFeature: byFeat
        .map((r) => ({
          feature: r.feature,
          costUsd: Number(r.cost),
          calls: Number(r.n),
        }))
        .sort((a, b) => b.costUsd - a.costUsd),
    }
  }
}

function emptySummary(scope: 'today' | 'last7d'): CostSummary {
  return {
    scope,
    totalCostUsd: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalCalls: 0,
    byWorkspace: [],
    byFeature: [],
  }
}
