'use server'

/**
 * Draft-feedback Server Action — the bridge between the annotation
 * form and the Claude-backed draft reviewer.
 *
 * Flow:
 *   1. Auth: caller must be a member of the topic's workspace
 *   2. Anti-spam: skip if this user called us within the last 20s
 *      (avoids token spend if someone mashes the button)
 *   3. Quota: assertWithinDailyAIQuota — same per-user daily cap as
 *      every other AI feature
 *   4. Resolve topic + task + template spec server-side. Trust
 *      ourselves, not the client's `rubricSpec` (would be a tampering
 *      vector otherwise)
 *   5. Call the reviewer, log tokens, return warnings
 *
 * The `draft` payload IS taken from the client because that's the
 * whole point — review what the user is about to submit, NOT what's
 * persisted. We treat it as data the LLM looks at, not as something
 * we trust for state mutations.
 */

import { z } from 'zod'
import { and, desc, eq, gt } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  aiCallLog,
  annotations,
  tasks,
  topics,
  guidelines,
} from '@/lib/db/schema'
import { requireWorkspaceMember } from '@/lib/auth/guards'
import {
  AppError,
  NotFoundError,
  ValidationError,
} from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'
import { getEffectiveTemplate } from '@/lib/templates/effective'
import '@/lib/templates/init'
import { reviewDraft, type DraftReview } from '@/lib/ai/draft-reviewer'
import {
  assertWithinDailyAIQuota,
  logAICall,
} from '@/lib/ai/quota'

const DraftFeedbackInput = z.object({
  topicId: uuidLike,
  /** Whatever's currently in the form — pair-rubric or arena-gsb shape. */
  draft: z.record(z.string(), z.unknown()),
})

/** Per-user cooldown between draft-review calls. Avoids the
 *  "user spams the button" cost. 20s is short enough that
 *  iterative drafting still feels live. */
const COOLDOWN_MS = 20 * 1000

export async function getDraftFeedback(
  input: z.infer<typeof DraftFeedbackInput>,
): Promise<{
  ok: true
  review: DraftReview
}> {
  const parsed = DraftFeedbackInput.parse(input)
  const db = getDb()

  // 1. Resolve topic → task → workspace, then auth-gate.
  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.id, parsed.topicId))
    .limit(1)
  if (!topic) throw new NotFoundError('Topic')

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, topic.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  const { user } = await requireWorkspaceMember(task.workspaceId)

  // Trajectory mode has its own AI reviewers (trajectory-reviewer.ts);
  // this surface is for topic-payload modes only.
  if (
    task.templateMode !== 'pair-rubric' &&
    task.templateMode !== 'arena-gsb'
  ) {
    throw new ValidationError(
      `AI draft review is only available for pair-rubric and arena-gsb tasks (got ${task.templateMode}).`,
    )
  }

  // 2. Anti-spam — has this user called draft-reviewer in the last 20s?
  const cooldownStart = new Date(Date.now() - COOLDOWN_MS)
  const [recent] = await db
    .select({ id: aiCallLog.id })
    .from(aiCallLog)
    .where(
      and(
        eq(aiCallLog.userId, user.id),
        eq(aiCallLog.feature, 'draft-reviewer'),
        gt(aiCallLog.ts, cooldownStart),
      ),
    )
    .limit(1)
  if (recent) {
    throw new AppError(
      'COOLDOWN',
      'Please wait ~20 seconds between AI pre-checks. Burning tokens is sad.',
      429,
    )
  }

  // 3. Daily quota — every AI feature shares this; protects against
  //    runaway client loops.
  await assertWithinDailyAIQuota(user.id)

  // 4. Resolve template spec server-side (don't trust client). For
  //    pair-rubric the spec is the checklist; for arena-gsb it's the
  //    dimensions array. Effective template handles per-task overrides.
  const template = getEffectiveTemplate(task.templateMode, task.templateConfig)
  if (!template) {
    throw new ValidationError(
      `Unknown templateMode "${task.templateMode}".`,
    )
  }
  const rubricSpec =
    task.templateMode === 'pair-rubric'
      ? template.pairChecklist ?? []
      : template.arenaDimensions ?? []

  // 5. Pull the latest published guidelines snapshot (if any). Empty
  //    string is fine — Claude handles "no guidelines" gracefully.
  //    We pick the highest version row; for v1 we don't bother with
  //    a published_at gate.
  const [latestGuideline] = await db
    .select({ content: guidelines.content, version: guidelines.version })
    .from(guidelines)
    .where(eq(guidelines.taskId, task.id))
    .orderBy(desc(guidelines.version))
    .limit(1)
  const taskGuidelines = latestGuideline?.content ?? ''

  // 6. Extract prompt + responses from itemData. We're tolerant: if
  //    any of these are missing/non-string the reviewer just sees an
  //    empty string. The form would already be unusable in that case.
  const itemData = (topic.itemData ?? {}) as {
    prompt?: unknown
    responseA?: { content?: unknown }
    responseB?: { content?: unknown }
  }
  const prompt = typeof itemData.prompt === 'string' ? itemData.prompt : ''
  const responseA =
    typeof itemData.responseA?.content === 'string'
      ? itemData.responseA.content
      : ''
  const responseB =
    typeof itemData.responseB?.content === 'string'
      ? itemData.responseB.content
      : ''

  // 7. Call Claude, log, return.
  const { review, usage } = await reviewDraft({
    mode: task.templateMode as 'pair-rubric' | 'arena-gsb',
    taskGuidelines,
    prompt,
    responseA,
    responseB,
    rubricSpec,
    draft: parsed.draft,
    // We deliberately DON'T pass peerConsensus here. The action runs
    // during drafting (before submit); leaking peer values would bias
    // the rater — same reason peerConsensus is review-mode-only on the
    // form itself. Drift detection works in REVIEW-time AI, not
    // pre-submit AI.
  })

  await logAICall({
    userId: user.id,
    feature: 'draft-reviewer',
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    workspaceId: task.workspaceId,
  })

  return { ok: true, review }
}

// Silence unused-imports — `annotations` table import kept for future
// "compare against current saved draft" extension.
void annotations
