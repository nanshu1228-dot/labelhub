'use server'

/**
 * AI Review Agent — owner/admin operations (spec §4.4 / §5 AI Agent 工程化).
 *
 * Two admin-gated actions kept OUT of the per-submission scheduler so the
 * money/state path (`ai-review-submission.ts`) stays minimal:
 *
 *   - previewAiAgentVerdict — a DRY-RUN. Runs the (possibly unsaved) draft
 *     config against a sample submission and returns the verdict WITHOUT
 *     persisting a verdict row or touching topic state. This is the
 *     "试运行 before publish" affordance that makes the rubric a real,
 *     exercised contract instead of a blind text box.
 *   - retryAiReview — manual human-in-the-loop recovery: re-runs a FAILED
 *     verdict (spec §5 失败兜底与人工介入路径).
 */

import { z } from 'zod'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { aiSubmissionVerdicts, annotations, tasks, topics } from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { uuidLike } from '@/lib/validators/uuid'
import { NotFoundError } from '@/lib/errors'
import { aiAgentConfigSchema } from './ai-agent-config-schema'
import {
  runReviewAgent,
  runReviewAgentSelfConsistent,
  extractRubricJudgmentContext,
  type ReviewAgentOutput,
  type VerdictResponse,
} from '@/lib/ai/review-agent'
import { assertWithinDailyAIQuota, logAICall } from '@/lib/ai/quota'
import { scheduleAIReviewIfMissing } from './ai-review-submission'

const previewSchema = z.object({
  taskId: uuidLike,
  config: aiAgentConfigSchema,
  /** Optional pasted submission JSON; falls back to a real task item. */
  sampleSubmission: z.string().max(20_000).optional(),
})

export interface PreviewVerdictResult {
  verdict: VerdictResponse['verdict']
  score: number
  dimensions: VerdictResponse['dimensions']
  reasoning: string
  evidence: string[]
  promptTrace: ReviewAgentOutput['promptTrace']
  usage: ReviewAgentOutput['usage']
  consistency?: ReviewAgentOutput['consistency']
  /** Where the sample submission came from. */
  sampleSource: 'provided' | 'task-item' | 'placeholder'
}

/**
 * Dry-run the AI review agent against one sample submission using a DRAFT
 * config (not necessarily the saved one). Admin-only. Burns real quota but
 * NEVER writes an `ai_submission_verdicts` row or moves topic state — proven
 * by importing none of the verdict/topic writers in the result path.
 */
export async function previewAiAgentVerdict(input: {
  taskId: string
  config: z.input<typeof aiAgentConfigSchema>
  sampleSubmission?: string
}): Promise<PreviewVerdictResult> {
  const parsed = previewSchema.parse(input)
  const db = getDb()

  // Resolve the task → workspace BEFORE authorizing (defends against a taskId
  // pointing at another workspace's task).
  const [task] = await db
    .select({ id: tasks.id, workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(eq(tasks.id, parsed.taskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')
  const { user } = await requireWorkspaceAdmin(task.workspaceId)

  // Resolve the sample: explicit paste → a real task item → a placeholder.
  let submissionJson = parsed.sampleSubmission?.trim()
  let contextText: string | undefined
  // Raw item object kept (not just the sliced contextText string) so the
  // rubric_judgment split-out can reconstruct its sections faithfully.
  let topicItemData: unknown
  let sampleSource: PreviewVerdictResult['sampleSource']
  if (submissionJson) {
    sampleSource = 'provided'
  } else {
    const [topic] = await db
      .select({ itemData: topics.itemData })
      .from(topics)
      .where(eq(topics.taskId, parsed.taskId))
      .limit(1)
    if (topic?.itemData != null) {
      submissionJson = JSON.stringify(topic.itemData)
      contextText = JSON.stringify(topic.itemData).slice(0, 6_000)
      topicItemData = topic.itemData
      sampleSource = 'task-item'
    } else {
      submissionJson = JSON.stringify({
        answer: 'Sample answer for dry-run preview.',
      })
      sampleSource = 'placeholder'
    }
  }

  // Quota gate — preview burns real tokens; attribute to the admin.
  await assertWithinDailyAIQuota(user.id)

  const cfg = parsed.config
  // Best-effort parse of the sample (a free-form text paste won't be JSON).
  let parsedSubmission: unknown
  try {
    parsedSubmission = submissionJson ? JSON.parse(submissionJson) : undefined
  } catch {
    parsedSubmission = undefined
  }
  const agentInput = {
    tier: cfg.tier,
    promptTemplate: cfg.promptTemplate,
    dimensions: cfg.dimensions,
    // Forward the configured task shape so the dry-run uses the SAME prompt
    // framing the published scheduler will use (was silently dropping to
    // 'generic' before, so a preview verdict could diverge from production).
    taskKind: cfg.taskKind,
    submissionJson,
    contextText,
    // Mirror the scheduler's rubric_judgment split-out so the preview frames
    // the meta-review identically (see ai-review-submission.ts).
    ...(cfg.taskKind === 'rubric_judgment'
      ? {
          rubricJudgment: extractRubricJudgmentContext(
            parsedSubmission,
            topicItemData,
          ),
          criticalDimension: {
            id: 'judgment_correctness',
            floor: cfg.passAt,
            downgradeTo: 'human_review' as const,
          },
        }
      : {}),
    passAt: cfg.passAt,
    sendBackAt: cfg.sendBackAt,
    feature: 'ai-review-preview',
  }
  const result: ReviewAgentOutput =
    cfg.samples > 1
      ? await runReviewAgentSelfConsistent(agentInput, cfg.samples)
      : await runReviewAgent(agentInput)

  // Attribute cost to the daily budget (best-effort).
  try {
    await logAICall({
      userId: user.id,
      feature: 'ai-review-preview',
      model: result.usage.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      workspaceId: task.workspaceId,
    })
  } catch {
    // Cost-log failure must not fail the preview.
  }

  return {
    verdict: result.payload.verdict,
    score: result.payload.score,
    dimensions: result.payload.dimensions,
    reasoning: result.payload.reasoning,
    evidence: result.payload.evidence,
    promptTrace: result.promptTrace,
    usage: result.usage,
    consistency: result.consistency,
    sampleSource,
  }
}

const retrySchema = z.object({ annotationId: uuidLike })

/**
 * How long a `pending` verdict may sit before it's considered orphaned. A
 * verdict insert promotes the topic to 'ai_review' and then runs the LLM; if
 * the host process is killed in between (e.g. a serverless after() eviction),
 * the row stays 'pending' and the topic is wedged in 'ai_review' with no
 * thrown error to trigger the failure rollback. Anything older than this is
 * safe to reclaim — a live LLM call (incl. self-consistency retries) finishes
 * well within it.
 */
const STALE_PENDING_MS = 5 * 60 * 1000

/**
 * Manual re-run for a stuck AI verdict (human-in-the-loop recovery). Admin
 * only. Recovers a verdict that is either `failed` OR a `pending` row older
 * than STALE_PENDING_MS (an orphaned in-flight review whose process died) —
 * the latter is the only way a topic can otherwise sit in 'ai_review' forever.
 * A FRESH `pending` (a review genuinely in flight) and a `completed` verdict
 * are left untouched. Clears prior verdicts so a fresh idempotency key runs,
 * resets the topic to 'submitted', then reschedules the agent.
 */
export async function retryAiReview(input: {
  annotationId: string
}): Promise<{ ok: boolean; reason?: string }> {
  const parsed = retrySchema.parse(input)
  const db = getDb()

  const [row] = await db
    .select({
      topicId: annotations.topicId,
      workspaceId: tasks.workspaceId,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .where(eq(annotations.id, parsed.annotationId))
    .limit(1)
  if (!row) return { ok: false, reason: 'not_found' }
  await requireWorkspaceAdmin(row.workspaceId)

  const [latest] = await db
    .select({
      id: aiSubmissionVerdicts.id,
      status: aiSubmissionVerdicts.status,
      startedAt: aiSubmissionVerdicts.startedAt,
    })
    .from(aiSubmissionVerdicts)
    .where(eq(aiSubmissionVerdicts.annotationId, parsed.annotationId))
    .orderBy(desc(aiSubmissionVerdicts.startedAt))
    .limit(1)
  const isStalePending =
    latest?.status === 'pending' &&
    latest.startedAt != null &&
    Date.now() - latest.startedAt.getTime() > STALE_PENDING_MS
  if (!latest || (latest.status !== 'failed' && !isStalePending)) {
    // A fresh pending review is genuinely in flight — don't disturb it.
    return {
      ok: false,
      reason: latest?.status === 'pending' ? 'pending_in_flight' : 'not_failed',
    }
  }

  await db
    .delete(aiSubmissionVerdicts)
    .where(eq(aiSubmissionVerdicts.annotationId, parsed.annotationId))
  // Reset the topic so the scheduler re-runs from a clean 'submitted' state.
  await db
    .update(topics)
    .set({ status: 'submitted', version: sql`${topics.version} + 1` })
    .where(
      and(
        eq(topics.id, row.topicId),
        inArray(topics.status, ['ai_review', 'submitted']),
      ),
    )
  await scheduleAIReviewIfMissing({ annotationId: parsed.annotationId })
  return { ok: true }
}
