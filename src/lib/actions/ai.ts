'use server'
import { z } from 'zod'
import {
  requireWorkspaceAdmin,
  requireWorkspaceMember,
} from '@/lib/auth/guards'
import { assertWithinDailyAIQuota, logAICall } from '@/lib/ai/quota'
import { generateTaskSpec } from '@/lib/ai/spec-generator'
import { generatePairSuggestion } from '@/lib/ai/pair-suggester'
import { reviewTrajectory } from '@/lib/ai/trajectory-reviewer'
import { getTrajectoryWithSteps } from '@/lib/queries/trajectories'
import { NotFoundError, ValidationError } from '@/lib/errors'

/**
 * AI Server Actions.
 *
 * Each one follows the same security pattern:
 *   1. Zod parse input
 *   2. Auth guard (admin for publisher features; member for annotator features)
 *   3. assertWithinDailyAIQuota — refuse runaway calls
 *   4. Invoke AI helper
 *   5. logAICall — record tokens for cost/quota accounting
 *
 * The AI helpers already wrap user text in XML tags + escape — prompt-injection
 * defense lives there, not here.
 */

const specGenSchema = z.object({
  workspaceId: z.string().uuid(),
  intent: z
    .string()
    .trim()
    .min(5, 'Intent must be at least 5 characters.')
    .max(500),
})

/**
 * Publisher-only: generate a complete task spec from a 1-line intent.
 */
export async function generateTaskSpecAction(
  input: z.infer<typeof specGenSchema>,
) {
  const parsed = specGenSchema.parse(input)
  const { user } = await requireWorkspaceAdmin(parsed.workspaceId)

  await assertWithinDailyAIQuota(user.id)

  const { spec, usage } = await generateTaskSpec(parsed.intent)

  await logAICall({
    userId: user.id,
    feature: 'spec-generator',
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    workspaceId: parsed.workspaceId,
  })

  return spec
}

const pairSuggestSchema = z.object({
  workspaceId: z.string().uuid(),
  taskGuidelines: z.string().max(20_000),
  prompt: z.string().min(1).max(8_000),
  context: z.string().max(10_000).optional(),
})

/**
 * Annotator: get Claude's initial proposal for a pair-annotation item.
 */
export async function generatePairSuggestionAction(
  input: z.infer<typeof pairSuggestSchema>,
) {
  const parsed = pairSuggestSchema.parse(input)
  const { user } = await requireWorkspaceMember(parsed.workspaceId)

  await assertWithinDailyAIQuota(user.id)

  const { suggestion, usage } = await generatePairSuggestion({
    taskGuidelines: parsed.taskGuidelines,
    prompt: parsed.prompt,
    context: parsed.context,
  })

  await logAICall({
    userId: user.id,
    feature: 'pair-suggester',
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    workspaceId: parsed.workspaceId,
  })

  return suggestion
}

const reviewTrajSchema = z.object({
  workspaceId: z.string().uuid(),
  trajectoryId: z.string().uuid(),
  taskGuidelines: z.string().max(20_000).optional(),
})

/**
 * Trajectory Reviewer — Claude pre-annotates every step of an agent trajectory.
 * Member-level (annotators can ask AI to pre-review before they work).
 *
 * Returns step-by-step suggestions ready to pre-fill the annotation UI.
 */
export async function reviewTrajectoryAction(
  input: z.infer<typeof reviewTrajSchema>,
) {
  const parsed = reviewTrajSchema.parse(input)
  const { user } = await requireWorkspaceMember(parsed.workspaceId)

  await assertWithinDailyAIQuota(user.id)

  // Fetch trajectory + steps
  const hydrated = await getTrajectoryWithSteps(parsed.trajectoryId)
  if (!hydrated) throw new NotFoundError('Trajectory')
  if (hydrated.trajectory.workspaceId !== parsed.workspaceId) {
    throw new ValidationError(
      "Trajectory does not belong to the specified workspace.",
    )
  }

  // Map DB steps → reviewer input shape; pull tool name from joined provider when available.
  const reviewSteps = hydrated.steps.map((s) => {
    const provider = s.toolProviderId
      ? hydrated.providersById.get(s.toolProviderId)
      : null
    return {
      sequence: s.sequence,
      kind: s.kind,
      content: s.content,
      toolName: provider?.name ?? null,
    }
  })

  const { review, usage } = await reviewTrajectory({
    agentName: hydrated.trajectory.agentName,
    rootPrompt: hydrated.trajectory.rootPrompt,
    taskGuidelines: parsed.taskGuidelines,
    steps: reviewSteps,
  })

  await logAICall({
    userId: user.id,
    feature: 'trajectory-reviewer',
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    workspaceId: parsed.workspaceId,
  })

  // Map stepSequence back to trajectory_step.id for the UI's convenience.
  const stepBySequence = new Map(hydrated.steps.map((s) => [s.sequence, s.id]))
  const stepSuggestionsWithIds = review.stepSuggestions.map((s) => ({
    ...s,
    trajectoryStepId: stepBySequence.get(s.stepSequence) ?? null,
  }))

  return {
    ...review,
    stepSuggestions: stepSuggestionsWithIds,
  }
}
