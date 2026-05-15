'use server'

/**
 * Trajectory Claude-hint cache.
 *
 * Wraps `reviewTrajectory` in a single Server Action that:
 *   1. Pulls the trajectory + its steps from DB.
 *   2. Calls Claude (Sonnet) to grade every step + the trajectory overall.
 *   3. Maps the 3-bucket {correct, suspicious, wrong} rating onto the
 *      RubricItem the annotator UI expects (likert 5/3/1, on the dominant
 *      rubric for the step's kind).
 *   4. Persists the flattened hint list to `trajectories.claude_hints`.
 *
 * Why caching matters: Sonnet on a 50-step trajectory takes 5-15s and costs
 * real money. The annotator UI shouldn't pay that on every page load.
 * One cached compute per trajectory; the cache is invalidated by setting
 * `claudeHints = null` (admin can re-run on demand).
 *
 * Call shape — either:
 *   - `reviewTrajectoryAndCache({ trajectoryId })` — synchronous, returns
 *     hints once Claude is done. Used from a script (seed) or admin "Re-run".
 *   - `scheduleHintsIfMissing({ trajectoryId })` — fires the cache fill in
 *     the background and returns immediately. Used from /annotate page so
 *     the first visit is fast.
 */

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { trajectories, trajectorySteps, events } from '@/lib/db/schema'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { reviewTrajectory, type TrajectoryReview } from '@/lib/ai/trajectory-reviewer'
import { logAICall } from '@/lib/ai/quota'
import { uuidLike } from '@/lib/validators/uuid'
import { requireWorkspaceMember } from '@/lib/auth/guards'

/**
 * Flattened hint shape — exactly what the annotator UI expects.
 *
 *   stepId    — the trajectory_steps.id (UUID), not the sequence
 *   rubricId  — which rubric item this hint targets (e.g. 'tool_choice')
 *   value     — for likert rubrics, a 1/3/5; matches the RubricItem.scale
 *   reason    — Claude's one-sentence rationale
 */
export interface CachedClaudeHint {
  stepId: string
  rubricId: string
  value: number | string | boolean
  reason: string
}

const inputSchema = z.object({
  trajectoryId: uuidLike,
})

/**
 * Maps Claude's 3-bucket per-step rating to the rubric this annotator UI
 * actually surfaces. The dominant rubric depends on the step's kind:
 *
 *   tool_call / sub_agent_call  → 'tool_choice' (likert)
 *   thinking / sub_agent_response / final_response → 'reasoning_sound'
 *   tool_result                 → no hint (it's an observation, not a decision)
 *   error                       → 'safety' (bool, flagged false)
 */
function mapRatingToRubric(args: {
  stepKind: string
  rating: 'correct' | 'suspicious' | 'wrong'
}): { rubricId: string; value: number | boolean } | null {
  const likertValue =
    args.rating === 'correct' ? 5 : args.rating === 'suspicious' ? 3 : 1

  switch (args.stepKind) {
    case 'tool_call':
    case 'sub_agent_call':
      return { rubricId: 'tool_choice', value: likertValue }
    case 'thinking':
    case 'sub_agent_response':
    case 'final_response':
      return { rubricId: 'reasoning_sound', value: likertValue }
    case 'error':
      return { rubricId: 'safety', value: false }
    case 'tool_result':
    default:
      return null
  }
}

function reviewToCachedHints(
  review: TrajectoryReview,
  steps: ReadonlyArray<{ id: string; sequence: number; kind: string }>,
): CachedClaudeHint[] {
  const bySeq = new Map(steps.map((s) => [s.sequence, s] as const))
  const out: CachedClaudeHint[] = []
  for (const s of review.stepSuggestions) {
    const step = bySeq.get(s.stepSequence)
    if (!step) continue // Claude returned a step we don't have — drop
    const mapping = mapRatingToRubric({
      stepKind: step.kind,
      rating: s.rating,
    })
    if (!mapping) continue
    out.push({
      stepId: step.id,
      rubricId: mapping.rubricId,
      value: mapping.value,
      reason: s.reasoning,
    })
  }
  return out
}

/**
 * Compute + persist hints synchronously. Use from scripts or "Re-run" buttons.
 */
export async function reviewTrajectoryAndCache(
  input: z.infer<typeof inputSchema>,
): Promise<{ ok: true; hints: CachedClaudeHint[] } | { ok: false; error: string }> {
  const parsed = inputSchema.parse(input)
  const db = getDb()

  const [traj] = await db
    .select({
      id: trajectories.id,
      workspaceId: trajectories.workspaceId,
      agentName: trajectories.agentName,
      rootPrompt: trajectories.rootPrompt,
    })
    .from(trajectories)
    .where(
      and(
        eq(trajectories.id, parsed.trajectoryId),
        // We tolerate soft-deleted trajectories here so admins can re-review.
      ),
    )
    .limit(1)
  if (!traj) throw new NotFoundError('Trajectory')
  // Defense-in-depth: even though /api/admin/compute-hints route gates
  // this call with ADMIN_DIAG_TOKEN, the function is also exported as a
  // Server Action ('use server' at top of file). Any authed client could
  // hit it directly and burn LLM quota — bounce non-members here.
  try {
    await requireWorkspaceMember(traj.workspaceId)
  } catch {
    throw new ForbiddenError('Not a member of this workspace.')
  }

  const stepRows = await db
    .select({
      id: trajectorySteps.id,
      sequence: trajectorySteps.sequence,
      kind: trajectorySteps.kind,
      content: trajectorySteps.content,
      toolProviderId: trajectorySteps.toolProviderId,
    })
    .from(trajectorySteps)
    .where(eq(trajectorySteps.trajectoryId, parsed.trajectoryId))
    .orderBy(trajectorySteps.sequence)

  if (stepRows.length === 0) {
    return { ok: false, error: 'trajectory has no steps' }
  }

  let review: TrajectoryReview
  let model: string
  let inputTokens: number
  let outputTokens: number
  try {
    const result = await reviewTrajectory({
      agentName: traj.agentName,
      rootPrompt: traj.rootPrompt,
      steps: stepRows.map((s) => ({
        sequence: s.sequence,
        kind: s.kind,
        content: s.content,
      })),
    })
    review = result.review
    model = result.usage.model
    inputTokens = result.usage.inputTokens
    outputTokens = result.usage.outputTokens
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'review failed',
    }
  }

  const hints = reviewToCachedHints(review, stepRows)

  await db
    .update(trajectories)
    .set({
      claudeHints: hints,
      claudeHintsAt: new Date(),
      claudeHintsModel: model,
    })
    .where(eq(trajectories.id, parsed.trajectoryId))

  await logAICall({
    userId: '00000000-0000-0000-0000-000000000001', // demo system actor
    feature: 'trajectory-hints',
    model,
    inputTokens,
    outputTokens,
    workspaceId: traj.workspaceId,
  })

  await db.insert(events).values({
    type: 'trajectory_hints.computed',
    workspaceId: traj.workspaceId,
    actorId: null,
    payload: {
      trajectoryId: traj.id,
      stepCount: stepRows.length,
      hintCount: hints.length,
      model,
      overallRating: review.overallRating,
    },
  })

  return { ok: true, hints }
}

/**
 * Fire-and-forget version. Returns immediately. If hints already exist (and
 * not stale), returns them; otherwise schedules background compute.
 *
 * Wired into /annotate page via `after()` so the first visit doesn't wait
 * for Claude.
 */
export async function scheduleHintsIfMissing(input: {
  trajectoryId: string
}): Promise<void> {
  const parsed = inputSchema.parse(input)
  const db = getDb()
  const [traj] = await db
    .select({
      id: trajectories.id,
      claudeHints: trajectories.claudeHints,
    })
    .from(trajectories)
    .where(eq(trajectories.id, parsed.trajectoryId))
    .limit(1)
  if (!traj) return
  if (traj.claudeHints != null) return // already cached
  // Don't await — fire and forget. The caller is using `after()` already,
  // so this gets serviced post-response in Vercel's after-window.
  await reviewTrajectoryAndCache(parsed).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn(
      `scheduleHintsIfMissing failed for trajectory ${parsed.trajectoryId}:`,
      e instanceof Error ? e.message : e,
    )
  })
}
