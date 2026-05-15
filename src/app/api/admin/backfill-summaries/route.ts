import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { trajectories, trajectorySteps } from '@/lib/db/schema'
import { summarizeTrajectory } from '@/lib/ai/trajectory-summarizer'
import { checkAdminToken } from '@/lib/auth/admin-token'

/**
 * POST /api/admin/backfill-summaries?token=...&limit=10&force=true
 *
 * Runs the LLM summarizer over trajectories that don't yet have a cached
 * summary, then writes the result to `trajectories.summary`. Token-gated
 * (no workspace API key) so it's an out-of-band ops tool, not a customer
 * surface.
 *
 * Bounded by `limit` per request so a single invocation stays under the
 * 60s function timeout — call repeatedly until `remaining=0`.
 *
 * Auth: token-gated via `ADMIN_DIAG_TOKEN` env (required, no fallback).
 */

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const block = checkAdminToken(request)
  if (block) return block
  const url = new URL(request.url)
  const limit = Math.min(
    Math.max(Number(url.searchParams.get('limit') ?? '5') || 5, 1),
    20,
  )
  const force = url.searchParams.get('force') === 'true'

  const db = getDb()
  // Pull all trajectories; filter client-side because the summary column
  // is text and we want to support `force` cleanly.
  const allRows = await db
    .select({
      id: trajectories.id,
      agentName: trajectories.agentName,
      rootPrompt: trajectories.rootPrompt,
      finalResponse: trajectories.finalResponse,
      summary: trajectories.summary,
    })
    .from(trajectories)

  const pending = force
    ? allRows
    : allRows.filter((r) => !r.summary)
  const batch = pending.slice(0, limit)
  const remaining = pending.length - batch.length

  const results: Array<{ id: string; status: string; error?: string }> = []

  for (const t of batch) {
    const steps = await db
      .select()
      .from(trajectorySteps)
      .where(eq(trajectorySteps.trajectoryId, t.id))
      .orderBy(trajectorySteps.sequence)
    if (steps.length === 0) {
      results.push({ id: t.id, status: 'skipped-no-steps' })
      continue
    }
    try {
      const result = await summarizeTrajectory({
        agentName: t.agentName,
        rootPrompt: t.rootPrompt,
        finalResponse: t.finalResponse,
        steps: steps.map((s) => ({
          sequence: s.sequence,
          kind: s.kind,
          content: s.content,
        })),
      })
      const stored = JSON.stringify({
        v: 1,
        summary: result.summary.summary,
        pattern: result.summary.pattern,
        keywords: result.summary.keywords,
      })
      await db
        .update(trajectories)
        .set({
          summary: stored,
          summaryAt: new Date(),
          summaryModel: result.usage.model,
        })
        .where(eq(trajectories.id, t.id))
      results.push({ id: t.id, status: result.summary.pattern })
    } catch (e) {
      results.push({
        id: t.id,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return NextResponse.json({
    processed: batch.length,
    pendingBefore: pending.length,
    remaining,
    force,
    results,
  })
}
