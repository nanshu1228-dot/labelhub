'use server'

/**
 * Trajectory Summary cache.
 *
 * Mirror of the existing `trajectory-hints.ts` action pattern:
 *
 *   - `summarizeTrajectoryAndCache({ trajectoryId })` — synchronous,
 *     returns the cached summary. Called from scripts / "Re-run" buttons.
 *   - `scheduleSummaryIfMissing({ trajectoryId })` — fire-and-forget,
 *     used from `after()` so first /analyze visit isn't blocked on the
 *     LLM round-trip.
 *
 * Idempotent: when `trajectories.summary` already exists, returns it
 * unchanged. Setting `force: true` re-runs.
 */

import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { trajectories, trajectorySteps } from '@/lib/db/schema'
import { NotFoundError } from '@/lib/errors'
import {
  summarizeTrajectory,
  type TrajectorySummary,
} from '@/lib/ai/trajectory-summarizer'
import { logAICall } from '@/lib/ai/quota'
import { uuidLike } from '@/lib/validators/uuid'

const inputSchema = z.object({
  trajectoryId: uuidLike,
  force: z.boolean().optional(),
})

export interface SummaryCacheResult {
  ok: true
  summary: TrajectorySummary
  cached: boolean
}

export async function summarizeTrajectoryAndCache(
  input: z.infer<typeof inputSchema>,
): Promise<SummaryCacheResult | { ok: false; error: string }> {
  const parsed = inputSchema.parse(input)
  const db = getDb()

  const [traj] = await db
    .select()
    .from(trajectories)
    .where(eq(trajectories.id, parsed.trajectoryId))
    .limit(1)
  if (!traj) throw new NotFoundError('Trajectory')

  // Cache hit: return stored summary.
  if (!parsed.force && traj.summary) {
    return {
      ok: true,
      summary: parseStoredSummary(traj),
      cached: true,
    }
  }

  const steps = await db
    .select()
    .from(trajectorySteps)
    .where(eq(trajectorySteps.trajectoryId, parsed.trajectoryId))
    .orderBy(trajectorySteps.sequence)

  if (steps.length === 0) {
    return { ok: false, error: 'trajectory has no steps' }
  }

  try {
    const result = await summarizeTrajectory({
      agentName: traj.agentName,
      rootPrompt: traj.rootPrompt,
      finalResponse: traj.finalResponse,
      steps: steps.map((s) => ({
        sequence: s.sequence,
        kind: s.kind,
        content: s.content,
      })),
    })

    // Persist three fields: the paragraph (the only one a user ever sees
    // raw) and the metadata that lets us re-parse later if we widen
    // the schema. We keep pattern+keywords inside the same text column
    // by JSON-stringifying — simpler than four separate columns and we
    // can promote to columns later if filter perf becomes an issue.
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
      .where(eq(trajectories.id, parsed.trajectoryId))

    await logAICall({
      userId: '00000000-0000-0000-0000-000000000001',
      feature: 'trajectory-summarizer',
      model: result.usage.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      workspaceId: traj.workspaceId,
    })

    return { ok: true, summary: result.summary, cached: false }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'summarization failed',
    }
  }
}

/**
 * Fire-and-forget. Returns immediately. Run inside Vercel's `after()`
 * window so the originating request isn't blocked on the LLM call.
 */
export async function scheduleSummaryIfMissing(input: {
  trajectoryId: string
}): Promise<void> {
  const parsed = inputSchema.parse(input)
  const db = getDb()
  const [traj] = await db
    .select({ id: trajectories.id, summary: trajectories.summary })
    .from(trajectories)
    .where(eq(trajectories.id, parsed.trajectoryId))
    .limit(1)
  if (!traj || traj.summary) return
  await summarizeTrajectoryAndCache(parsed).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn(
      `scheduleSummaryIfMissing failed for trajectory ${parsed.trajectoryId}:`,
      e instanceof Error ? e.message : e,
    )
  })
}

/**
 * Parse a stored summary row back into the canonical TrajectorySummary
 * shape. Tolerates legacy plain-text-only entries (return them as a
 * summary string with no pattern/keywords).
 */
function parseStoredSummary(traj: {
  summary: string | null
}): TrajectorySummary {
  const raw = traj.summary ?? ''
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        return {
          summary: String(parsed.summary ?? ''),
          pattern:
            typeof parsed.pattern === 'string' ? parsed.pattern : 'other',
          keywords: Array.isArray(parsed.keywords)
            ? parsed.keywords.filter((k: unknown) => typeof k === 'string')
            : [],
        } as TrajectorySummary
      }
    } catch {
      /* fall through */
    }
  }
  return {
    summary: raw,
    pattern: 'other',
    keywords: [],
  }
}

/**
 * Read-only export so server components can decode the stored shape
 * without dragging the action machinery.
 */
export async function getCachedSummary(
  trajectoryId: string,
): Promise<TrajectorySummary | null> {
  const db = getDb()
  const [traj] = await db
    .select({ summary: trajectories.summary })
    .from(trajectories)
    .where(eq(trajectories.id, trajectoryId))
    .limit(1)
  if (!traj?.summary) return null
  return parseStoredSummary(traj)
}
