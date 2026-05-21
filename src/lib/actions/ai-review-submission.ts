'use server'

/**
 * AI Review Agent — per-submission auto-trigger — Finals P2 D7+D8.
 *
 * Spec 4.4 calls this out by name (AI 审核 Agent ⭐⭐⭐). On every
 * annotation submit transition, an after-hook fires this scheduler
 * which:
 *
 *   1. checks whether a verdict already exists for this annotation
 *      (idempotency_key = sha256(annotationId + judgeId + schemaV))
 *   2. inserts a `pending` row in `ai_submission_verdicts`
 *   3. invokes the function-calling Claude path (D8) and writes the
 *      structured verdict back to the row
 *
 * The annotation submit path stays unchanged in latency: this whole
 * function runs in Vercel's after() window, NOT the request path.
 *
 * Design mirrors `src/lib/actions/trajectory-hints.ts:248-272`:
 *   - exported `scheduleAIReviewIfMissing` for use from `after()`
 *   - early-return if a verdict already exists (cache hit)
 *   - never throws — surface failures via console.warn so the
 *     after-window doesn't block the user response
 *
 * Quota: D8 calls `assertWithinDailyAIQuota` against the submitter
 * BEFORE the Claude call; quota-exhausted submits leave a 'failed'
 * verdict with status='quota_exhausted' so the audit log carries
 * the signal.
 */

import { z } from 'zod'
import { idempotencyKey } from './ai-review-keys'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  aiSubmissionVerdicts,
  annotations,
  events,
  tasks,
  topics,
} from '@/lib/db/schema'
import { uuidLike } from '@/lib/validators/uuid'
import {
  runReviewAgentWithRetry,
  type ReviewDimension,
} from '@/lib/ai/review-agent'
import { assertWithinDailyAIQuota, logAICall } from '@/lib/ai/quota'
import { writeRevision } from '@/lib/quality/annotation-revisions'
import { emitNotification } from '@/lib/notifications/emit'

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
    // annotation. Also pull the submitter + workspaceId so we can
    // attribute quota correctly.
    const [row] = await db
      .select({
        annotationId: annotations.id,
        annotationUserId: annotations.userId,
        annotationPayload: annotations.payload,
        topicId: annotations.topicId,
        taskId: topics.taskId,
        workspaceId: tasks.workspaceId,
        templateMode: tasks.templateMode,
        templateConfig: tasks.templateConfig,
        topicItemData: topics.itemData,
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
      (task.templateConfig as {
        aiAgent?: {
          enabled?: boolean
          judgeId?: string
          promptTemplate?: string
          dimensions?: ReviewDimension[]
          passAt?: number
          sendBackAt?: number
          tier?: 'fast' | 'default' | 'premium'
        }
      } | null)?.aiAgent
    const enabled =
      cfg?.enabled ?? task.templateMode === 'custom-designer'
    if (!enabled) return

    const judgeId = cfg?.judgeId ?? 'default'
    const schemaVersion = 1 // D9 reads this from the FormSchema row.
    const key = idempotencyKey({
      annotationId: parsed.annotationId,
      judgeId,
      schemaVersion,
    })

    // Insert pending row. ON CONFLICT DO NOTHING relies on the
    // ai_verdicts_idempotency_uniq index from the D1 migration.
    // If the row already exists, the LLM call below was already done
    // (or in flight from another submit) — short-circuit out.
    const inserted = await db
      .insert(aiSubmissionVerdicts)
      .values({
        annotationId: parsed.annotationId,
        judgeId: null, // wired in D9 once judges are workspace-scoped
        status: 'pending',
        idempotencyKey: key,
        attempts: 0,
      })
      .onConflictDoNothing({
        target: aiSubmissionVerdicts.idempotencyKey,
      })
      .returning({ id: aiSubmissionVerdicts.id })

    if (inserted.length === 0) return

    const verdictRowId = inserted[0].id

    // Move the topic into the new 'ai_review' stage so the Labeler /
    // Reviewer UIs can show the "in flight" indicator. We do the
    // update conditionally on the current state being 'submitted' so
    // a concurrent reviewer click doesn't race us. workflowStage on
    // topics.status was extended in the D1 migration + D9 Drizzle
    // pgEnum bump.
    await db
      .update(topics)
      .set({
        status: 'ai_review',
        version: sql`${topics.version} + 1`,
      })
      .where(and(eq(topics.id, row.topicId), eq(topics.status, 'submitted')))

    await db.insert(events).values({
      type: 'ai_review.started',
      workspaceId: row.workspaceId,
      actorId: null,
      payload: {
        annotationId: parsed.annotationId,
        verdictId: verdictRowId,
        topicId: row.topicId,
        taskId: row.taskId,
      },
    })

    // Default prompt + dimensions for owners who haven't customized.
    // Keeps the default-on behavior for custom-designer tasks useful
    // out of the box.
    const promptTemplate =
      cfg?.promptTemplate ??
      'Review this annotation for completeness, accuracy, and adherence ' +
        'to the task instructions. Pass if it is publishable, send_back ' +
        'if it needs minor edits, human_review if it requires expert ' +
        'judgment.'
    const dimensions: ReviewDimension[] =
      cfg?.dimensions ??
      [
        { id: 'completeness', name: 'Completeness' },
        { id: 'accuracy', name: 'Accuracy' },
        { id: 'clarity', name: 'Clarity' },
      ]

    // Quota gate. Attribute to the submitter so heavy users see the
    // limit, not the workspace owner.
    try {
      await assertWithinDailyAIQuota(row.annotationUserId)
    } catch (e) {
      await db
        .update(aiSubmissionVerdicts)
        .set({
          status: 'failed',
          errorText:
            e instanceof Error ? e.message : 'quota assertion failed',
          finishedAt: new Date(),
        })
        .where(eq(aiSubmissionVerdicts.id, verdictRowId))
      return
    }

    // Run the LLM. Retry with backoff (3 attempts) inside the agent;
    // we bump the verdict-row attempts counter after each completion
    // so the audit log knows how many tries this verdict took.
    try {
      const { payload, usage } = await runReviewAgentWithRetry({
        tier: cfg?.tier,
        promptTemplate,
        dimensions,
        submissionJson: JSON.stringify(row.annotationPayload ?? {}),
        contextText:
          row.topicItemData != null
            ? JSON.stringify(row.topicItemData).slice(0, 6000)
            : undefined,
        passAt: cfg?.passAt,
        sendBackAt: cfg?.sendBackAt,
        feature: 'ai-review-agent',
      })

      await db
        .update(aiSubmissionVerdicts)
        .set({
          status: 'completed',
          verdict: payload.verdict,
          scores: payload.dimensions,
          reasoning: payload.reasoning,
          attempts: 1,
          finishedAt: new Date(),
        })
        .where(eq(aiSubmissionVerdicts.id, verdictRowId))

      // Log the token usage so the workspace's daily budget
      // dashboard can attribute the cost.
      try {
        await logAICall({
          userId: row.annotationUserId,
          feature: 'ai-review-agent',
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          workspaceId: row.workspaceId,
        })
      } catch {
        // Cost-log failure shouldn't roll back the verdict.
      }

      // Verdict routing — advance the topic to its next state. The
      // optimistic guard on status='ai_review' protects against a
      // concurrent admin acting on the topic; if a human moved it
      // first the AI verdict still lands but the routing is a no-op.
      if (payload.verdict === 'pass') {
        await db
          .update(topics)
          .set({
            status: 'reviewing',
            version: sql`${topics.version} + 1`,
          })
          .where(
            and(eq(topics.id, row.topicId), eq(topics.status, 'ai_review')),
          )
        await db.insert(events).values({
          type: 'ai_review.completed',
          workspaceId: row.workspaceId,
          actorId: null,
          payload: {
            annotationId: parsed.annotationId,
            verdictId: verdictRowId,
            verdict: 'pass',
            score: payload.score,
          },
        })
      } else if (payload.verdict === 'send_back') {
        // Snapshot the pre-send-back annotation payload so the
        // history timeline can render the round-trip; reuse the
        // submitter as actorId since AI has no user row.
        await writeRevision({
          annotationId: parsed.annotationId,
          actorId: row.annotationUserId,
          workspaceId: row.workspaceId,
          payload: row.annotationPayload ?? {},
          kind: 'ai_send_back',
        })
        await db
          .update(topics)
          .set({
            status: 'drafting',
            version: sql`${topics.version} + 1`,
          })
          .where(
            and(eq(topics.id, row.topicId), eq(topics.status, 'ai_review')),
          )
        await db.insert(events).values({
          type: 'ai_review.sent_back',
          workspaceId: row.workspaceId,
          actorId: null,
          payload: {
            annotationId: parsed.annotationId,
            verdictId: verdictRowId,
            score: payload.score,
            reason: payload.reasoning,
          },
        })
        // D13 — surface the send-back in the submitter's inbox so
        // they see "AI sent it back" without refreshing the queue.
        await emitNotification({
          userId: row.annotationUserId,
          workspaceId: row.workspaceId,
          type: 'ai_review.sent_back',
          title: 'AI sent your work back for revisions',
          body: payload.reasoning.slice(0, 200),
          linkUrl: `/topics/${row.topicId}/annotate`,
          payload: {
            annotationId: parsed.annotationId,
            verdictId: verdictRowId,
            score: payload.score,
          },
          actorId: null,
        })
      } else {
        // human_review — set status to 'reviewing' but flag priority
        // via a side-channel on the verdict row's scores blob so the
        // Reviewer queue (D11) can sort priority items first.
        await db
          .update(aiSubmissionVerdicts)
          .set({
            scores: {
              ...(payload.dimensions ?? {}),
              __priority: true,
            },
          })
          .where(eq(aiSubmissionVerdicts.id, verdictRowId))
        await db
          .update(topics)
          .set({
            status: 'reviewing',
            version: sql`${topics.version} + 1`,
          })
          .where(
            and(eq(topics.id, row.topicId), eq(topics.status, 'ai_review')),
          )
        await db.insert(events).values({
          type: 'ai_review.completed',
          workspaceId: row.workspaceId,
          actorId: null,
          payload: {
            annotationId: parsed.annotationId,
            verdictId: verdictRowId,
            verdict: 'human_review',
            score: payload.score,
          },
        })
        // D13 — also surface human_review to the submitter so they
        // know their work is being escalated (not just passing
        // silently to QC).
        await emitNotification({
          userId: row.annotationUserId,
          workspaceId: row.workspaceId,
          type: 'ai_review.escalated',
          title: 'AI flagged your submission for human review',
          body: payload.reasoning.slice(0, 200),
          linkUrl: `/topics/${row.topicId}/annotate`,
          payload: {
            annotationId: parsed.annotationId,
            verdictId: verdictRowId,
            score: payload.score,
          },
          actorId: null,
        })
      }
    } catch (e) {
      await db.insert(events).values({
        type: 'ai_review.failed',
        workspaceId: row.workspaceId,
        actorId: null,
        payload: {
          annotationId: parsed.annotationId,
          verdictId: verdictRowId,
          error: e instanceof Error ? e.message : 'unknown',
        },
      })
      // Roll the topic back to 'submitted' so a human reviewer can
      // pick up the work even though the AI couldn't grade it.
      await db
        .update(topics)
        .set({
          status: 'submitted',
          version: sql`${topics.version} + 1`,
        })
        .where(
          and(eq(topics.id, row.topicId), eq(topics.status, 'ai_review')),
        )
      await db
        .update(aiSubmissionVerdicts)
        .set({
          status: 'failed',
          errorText: e instanceof Error ? e.message : 'agent failed',
          attempts: 3,
          finishedAt: new Date(),
        })
        .where(eq(aiSubmissionVerdicts.id, verdictRowId))
    }
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
