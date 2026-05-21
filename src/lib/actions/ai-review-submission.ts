'use server'

/**
 * AI Review Agent — per-submission auto-trigger — Finals P2 D7.
 *
 * Spec 4.4 calls this out by name (AI 审核 Agent ⭐⭐⭐). On every
 * annotation submit transition, an after-hook fires this scheduler
 * which:
 *
 *   1. checks whether a verdict already exists for this annotation
 *      (idempotency_key = sha256(annotationId + judgeId + schemaV))
 *   2. inserts a `pending` row in `ai_submission_verdicts` for the
 *      worker to pick up (or to call inline if quota allows)
 *   3. invokes the function-calling Claude path (D8) and writes the
 *      structured verdict back
 *
 * D7 ships the schema + scheduler skeleton ONLY — no actual Claude
 * call yet. The row sits in `pending` and a future commit (D8) wires
 * the LLM. This staging keeps the after-hook wiring testable today
 * without burning quota.
 *
 * Design mirrors `src/lib/actions/trajectory-hints.ts:248-272`:
 *   - exported `scheduleAIReviewIfMissing` for use from `after()`
 *   - early-return if a verdict already exists (cache hit)
 *   - never throws — surface failures via console.warn so the
 *     after-window doesn't block the user response
 *
 * The annotation submit path stays unchanged in latency: this whole
 * function runs in Vercel's after() window, NOT the request path.
 */

import { z } from 'zod'
import { idempotencyKey } from './ai-review-keys'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  aiSubmissionVerdicts,
  annotations,
  tasks,
  topics,
} from '@/lib/db/schema'
import { uuidLike } from '@/lib/validators/uuid'

const inputSchema = z.object({
  annotationId: uuidLike,
})

// `idempotencyKey` is the pure helper, exported from ./ai-review-keys
// because 'use server' files can only export async functions.

/**
 * Fire-and-forget. Returns immediately. If a verdict already exists
 * (idempotency_key UNIQUE), the insert is a no-op and the helper
 * returns. Otherwise a `pending` row lands; D8 wires the actual
 * Claude call against it.
 *
 * Wired into submitAnnotation via `after()` so submit latency stays
 * unchanged — Vercel's after-window services the LLM call post-
 * response.
 */
export async function scheduleAIReviewIfMissing(input: {
  annotationId: string
}): Promise<void> {
  // Parse inside the try so a malformed annotationId surfaces via
  // console.warn rather than propagating up to the after() window
  // (which would still be caught by the caller's .catch(), but the
  // isolation contract is easier to reason about this way).
  let parsed: { annotationId: string }
  try {
    parsed = inputSchema.parse(input)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[ai-review] scheduleAIReviewIfMissing got malformed input:',
      e instanceof Error ? e.message : e,
    )
    return
  }
  try {
    const db = getDb()
    // Annotation → Topic → Task in one round trip. `annotation.taskId`
    // doesn't exist; the task lives behind the topic that owns the
    // annotation.
    const [row] = await db
      .select({
        annotationId: annotations.id,
        taskId: topics.taskId,
        templateMode: tasks.templateMode,
        templateConfig: tasks.templateConfig,
      })
      .from(annotations)
      .innerJoin(topics, eq(topics.id, annotations.topicId))
      .innerJoin(tasks, eq(tasks.id, topics.taskId))
      .where(eq(annotations.id, parsed.annotationId))
      .limit(1)
    if (!row) return
    const task = {
      id: row.taskId,
      templateMode: row.templateMode,
      templateConfig: row.templateConfig,
    }

    const cfg =
      (task.templateConfig as { aiAgent?: { enabled?: boolean; judgeId?: string } } | null)
        ?.aiAgent
    const enabled =
      cfg?.enabled ?? task.templateMode === 'custom-designer'
    if (!enabled) return

    const judgeId = cfg?.judgeId ?? 'default'
    const schemaVersion = 1 // D8 reads this from the FormSchema row.
    const key = idempotencyKey({
      annotationId: parsed.annotationId,
      judgeId,
      schemaVersion,
    })

    // Insert pending row. ON CONFLICT DO NOTHING relies on the
    // ai_verdicts_idempotency_uniq index from the D1 migration.
    await db
      .insert(aiSubmissionVerdicts)
      .values({
        annotationId: parsed.annotationId,
        judgeId: null, // wired in D8 once judges are workspace-scoped
        status: 'pending',
        idempotencyKey: key,
        attempts: 0,
      })
      .onConflictDoNothing({
        target: aiSubmissionVerdicts.idempotencyKey,
      })

    // D8 will call into src/lib/ai/review-agent.ts here. The pending
    // row is the contract — anything reading the table can see a
    // verdict is in flight.
  } catch (e) {
    // After-hook isolation — never bubble up to the caller. Submit
    // latency stays unchanged even if the scheduler crashes.
    // eslint-disable-next-line no-console
    console.warn(
      `[ai-review] scheduleAIReviewIfMissing failed for ${parsed.annotationId}:`,
      e instanceof Error ? e.message : e,
    )
  }
}

/**
 * Look up the most recent verdict row for an annotation. Used by the
 * Reviewer workbench (D11) and the audit timeline (D12) so the AI
 * verdict surfaces inline with the human review.
 */
export async function getLatestVerdict(annotationId: string): Promise<{
  id: string
  status: string
  verdict: string | null
  reasoning: string | null
  scores: unknown
  startedAt: Date
  finishedAt: Date | null
} | null> {
  const db = getDb()
  const rows = await db
    .select({
      id: aiSubmissionVerdicts.id,
      status: aiSubmissionVerdicts.status,
      verdict: aiSubmissionVerdicts.verdict,
      reasoning: aiSubmissionVerdicts.reasoning,
      scores: aiSubmissionVerdicts.scores,
      startedAt: aiSubmissionVerdicts.startedAt,
      finishedAt: aiSubmissionVerdicts.finishedAt,
    })
    .from(aiSubmissionVerdicts)
    .where(eq(aiSubmissionVerdicts.annotationId, annotationId))
    .orderBy(aiSubmissionVerdicts.startedAt)
  // Drizzle's order-by is ascending; reverse to get most-recent.
  return rows.length > 0 ? rows[rows.length - 1] : null
}

/**
 * Reset a verdict so the next submit re-runs the AI Agent. Used by
 * the owner config UI (D9) when the prompt changes — old verdicts
 * stay in the audit log; future submits ignore them via a fresh
 * idempotency key.
 *
 * D7 leaves this a no-op until D8 wires the real call; the helper
 * exists so callers can compile against the contract.
 */
export async function deleteVerdictForRerun(annotationId: string): Promise<void> {
  const db = getDb()
  await db
    .delete(aiSubmissionVerdicts)
    .where(
      and(
        eq(aiSubmissionVerdicts.annotationId, annotationId),
        eq(aiSubmissionVerdicts.status, 'pending'),
      ),
    )
}
