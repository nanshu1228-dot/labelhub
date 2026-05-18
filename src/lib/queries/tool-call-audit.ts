import 'server-only'
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  toolProviders,
  trajectories,
  trajectorySteps,
} from '@/lib/db/schema'

/**
 * Tool-call audit lens (Phase-20).
 *
 * Walks every trajectory_steps row in the workspace with kind=
 * 'tool_call' joined to its provider, computes per-provider:
 *   - total call count
 *   - failure rate (matching tool_result step with content.error)
 *   - p95 latency
 *   - sum of tokens in/out
 *
 * Returns rows sorted by call count descending. Powers the new
 * "Tool providers" block on /workspaces/[id]/analyze.
 *
 * Failure heuristic: we look at the immediately-following step row
 * for the same trajectory + matching toolCallId where kind is
 * 'tool_result' or 'error'. If that row's `content.error` is truthy
 * OR the row is `kind=error`, we count the call as failed. Approx —
 * caller can drill down per provider for the exact failures.
 */

export interface ToolProviderStats {
  providerId: string
  kind: string
  identifier: string
  name: string
  calls: number
  failures: number
  failureRate: number
  totalTokensIn: number
  totalTokensOut: number
  p95LatencyMs: number
  meanLatencyMs: number
  lastSeenAt: Date | null
}

export async function getWorkspaceToolCallStats(
  workspaceId: string,
): Promise<ToolProviderStats[]> {
  const db = getDb()

  // Pull every tool_call step in the workspace + its provider. We
  // attach the matching tool_result by self-join on (trajectoryId,
  // toolCallId). Failure = result has content.error truthy, or no
  // matching result was ever recorded (timeout / abandoned call).
  const callRows = await db
    .select({
      providerId: trajectorySteps.toolProviderId,
      providerKind: toolProviders.kind,
      providerIdentifier: toolProviders.identifier,
      providerName: toolProviders.name,
      lastSeen: toolProviders.lastSeenAt,
      stepId: trajectorySteps.id,
      trajectoryId: trajectorySteps.trajectoryId,
      toolCallId: trajectorySteps.toolCallId,
      latencyMs: trajectorySteps.latencyMs,
      tokensIn: trajectorySteps.tokensIn,
      tokensOut: trajectorySteps.tokensOut,
    })
    .from(trajectorySteps)
    .innerJoin(
      trajectories,
      eq(trajectories.id, trajectorySteps.trajectoryId),
    )
    .leftJoin(
      toolProviders,
      eq(toolProviders.id, trajectorySteps.toolProviderId),
    )
    .where(
      and(
        eq(trajectories.workspaceId, workspaceId),
        eq(trajectorySteps.kind, 'tool_call'),
        isNotNull(trajectorySteps.toolProviderId),
      ),
    )
    .orderBy(asc(trajectorySteps.ts))

  if (callRows.length === 0) return []

  // Find matching result rows in one shot.
  const resultRows = await db
    .select({
      trajectoryId: trajectorySteps.trajectoryId,
      toolCallId: trajectorySteps.toolCallId,
      kind: trajectorySteps.kind,
      content: trajectorySteps.content,
    })
    .from(trajectorySteps)
    .innerJoin(
      trajectories,
      eq(trajectories.id, trajectorySteps.trajectoryId),
    )
    .where(
      and(
        eq(trajectories.workspaceId, workspaceId),
        sql`${trajectorySteps.kind} IN ('tool_result', 'error')`,
        isNotNull(trajectorySteps.toolCallId),
      ),
    )

  // Map (trajectoryId|toolCallId) → was-failure?
  const failByKey = new Map<string, boolean>()
  for (const r of resultRows) {
    if (!r.toolCallId) continue
    const key = `${r.trajectoryId}|${r.toolCallId}`
    const content = (r.content ?? {}) as Record<string, unknown>
    const isFail =
      r.kind === 'error' ||
      Boolean(content.error) ||
      Boolean(content.isError)
    failByKey.set(key, isFail)
  }

  // Bucket call rows by provider.
  type Bucket = {
    providerId: string
    kind: string
    identifier: string
    name: string
    lastSeen: Date | null
    latencies: number[]
    tokensIn: number
    tokensOut: number
    calls: number
    failures: number
  }
  const buckets = new Map<string, Bucket>()
  for (const r of callRows) {
    if (!r.providerId) continue
    const b: Bucket = buckets.get(r.providerId) ?? {
      providerId: r.providerId,
      kind: r.providerKind ?? 'unknown',
      identifier: r.providerIdentifier ?? '(unknown)',
      name: r.providerName ?? '(unknown)',
      lastSeen: r.lastSeen,
      latencies: [],
      tokensIn: 0,
      tokensOut: 0,
      calls: 0,
      failures: 0,
    }
    b.calls += 1
    if (r.latencyMs != null) b.latencies.push(r.latencyMs)
    b.tokensIn += r.tokensIn ?? 0
    b.tokensOut += r.tokensOut ?? 0
    if (r.toolCallId) {
      const key = `${r.trajectoryId}|${r.toolCallId}`
      const failed = failByKey.get(key)
      if (failed === true) b.failures += 1
      else if (failed === undefined) b.failures += 1 // no result row → timeout / abandoned
    }
    buckets.set(r.providerId, b)
  }

  const stats: ToolProviderStats[] = []
  for (const b of buckets.values()) {
    const sorted = b.latencies.slice().sort((a, b) => a - b)
    const p95Idx = Math.floor(sorted.length * 0.95)
    const p95 = sorted.length > 0 ? (sorted[p95Idx] ?? sorted[sorted.length - 1]) : 0
    const mean =
      sorted.length > 0
        ? sorted.reduce((a, b) => a + b, 0) / sorted.length
        : 0
    stats.push({
      providerId: b.providerId,
      kind: b.kind,
      identifier: b.identifier,
      name: b.name,
      calls: b.calls,
      failures: b.failures,
      failureRate: b.calls > 0 ? b.failures / b.calls : 0,
      totalTokensIn: b.tokensIn,
      totalTokensOut: b.tokensOut,
      p95LatencyMs: Math.round(p95),
      meanLatencyMs: Math.round(mean),
      lastSeenAt: b.lastSeen,
    })
  }
  stats.sort((a, b) => b.calls - a.calls)
  return stats
}
