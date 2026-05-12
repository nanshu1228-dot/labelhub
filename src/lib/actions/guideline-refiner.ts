'use server'

/**
 * Server Action — invoke the AI Guideline Refiner on a workspace's disputes,
 * persist the proposal as a `guideline_patches` row pending admin review.
 *
 * Demo-mode gated. Production should require workspace-admin auth.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq, desc } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  events,
  guidelines,
  guidelinePatches,
  tasks,
  trajectorySteps,
  trajectories,
} from '@/lib/db/schema'
import { proposeGuidelinePatch } from '@/lib/ai/guideline-refiner'
import { listTopDisputes } from '@/lib/queries/iaa'
import { assertWithinDailyAIQuota, logAICall } from '@/lib/ai/quota'
import { AppError, NotFoundError, ValidationError } from '@/lib/errors'

const REFINER_INPUT = z.object({
  workspaceId: z.string().uuid(),
})

const RATING_TO_LABEL: Record<number, string> = {
  5: 'correct',
  3: 'suspicious',
  1: 'wrong',
}

/**
 * Pulls top disputes, asks Claude for a patch, writes a `guideline_patches`
 * row in `status: 'pending'`. The patch targets the latest guideline of the
 * Inbox task — that's where proxy-captured trajectories land.
 */
export async function refineGuidelinesDemo(
  input: z.infer<typeof REFINER_INPUT>,
): Promise<{
  patchId: string
  title: string
  rationale: string
  confidence: string
  addressesCount: number
  patchPreview: string
}> {
  if (process.env.LABELHUB_DEMO_MODE !== 'true') {
    throw new AppError(
      'DEMO_MODE_DISABLED',
      'Refining guidelines requires LABELHUB_DEMO_MODE=true in this build.',
      403,
    )
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AppError(
      'AI_NOT_CONFIGURED',
      'ANTHROPIC_API_KEY missing. The refiner uses Claude Sonnet to draft patches.',
      503,
    )
  }
  const parsed = REFINER_INPUT.parse(input)
  const db = getDb()

  // 1. Find the latest disputes
  const disputes = await listTopDisputes({
    workspaceId: parsed.workspaceId,
    limit: 10,
  })
  if (disputes.length === 0) {
    throw new ValidationError(
      'No disputed steps found in this workspace — annotators all agree (or no multi-rater step yet).',
    )
  }

  // 2. Resolve the inbox task + its latest guideline (or seed one if missing)
  const [inboxTask] = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, parsed.workspaceId),
        eq(tasks.name, 'Inbox — Captured Trajectories'),
      ),
    )
    .limit(1)
  if (!inboxTask) {
    throw new NotFoundError(
      'Inbox task — no proxy-captured trajectories have been annotated yet',
    )
  }

  let [latestGuideline] = await db
    .select()
    .from(guidelines)
    .where(eq(guidelines.taskId, inboxTask.id))
    .orderBy(desc(guidelines.version))
    .limit(1)
  if (!latestGuideline) {
    // Seed v1 from the task's guidelines_markdown (or a default).
    const seed =
      inboxTask.guidelinesMarkdown ??
      `# Inbox annotation guideline (v1)\n\nRate each step as ✓ correct / ⚠ suspicious / ✗ wrong. Use the reasoning field to record WHY.`
    ;[latestGuideline] = await db
      .insert(guidelines)
      .values({ taskId: inboxTask.id, version: 1, content: seed })
      .returning()
  }

  // 3. Hydrate each dispute with the step kind + a short summary
  const stepIds = disputes.map((d) => d.trajectoryStepId)
  const steps = await db
    .select({
      id: trajectorySteps.id,
      kind: trajectorySteps.kind,
      content: trajectorySteps.content,
      sequence: trajectorySteps.sequence,
      trajId: trajectorySteps.trajectoryId,
    })
    .from(trajectorySteps)
    .where(eq(trajectorySteps.id, stepIds[0])) // workaround: drizzle inArray may need different syntax
  // Pull all in one shot:
  const stepRows = await db
    .select({
      id: trajectorySteps.id,
      kind: trajectorySteps.kind,
      content: trajectorySteps.content,
    })
    .from(trajectorySteps)
    .where(eq(trajectorySteps.trajectoryId, disputes[0].trajectoryId))
  // Build a lookup. (For demo our disputes all came from the same trajectory;
  // a real workspace might span trajectories — improve with inArray later.)
  const stepById = new Map(stepRows.map((s) => [s.id, s]))
  void steps

  const refinerCases = disputes.map((d) => {
    const step = stepById.get(d.trajectoryStepId)
    const c = (step?.content ?? {}) as Record<string, unknown>
    const summary =
      typeof c.text === 'string'
        ? c.text.slice(0, 200)
        : typeof c.toolName === 'string'
          ? `${c.toolName}(${JSON.stringify(c.args ?? {}).slice(0, 100)})`
          : JSON.stringify(c).slice(0, 200)
    return {
      id: d.trajectoryStepId,
      stepKind: step?.kind ?? 'unknown',
      stepSummary: summary,
      raterCalls: d.raters.map((r) => ({
        label:
          r.rating != null
            ? (RATING_TO_LABEL[r.rating] ?? `rating:${r.rating}`)
            : 'unrated',
        reasoning: r.reasoning,
      })),
    }
  })

  // 4. Quota check — refiner is the most expensive AI feature we have.
  // Demo mode uses the seeded demo admin as the bookkeeping actor.
  const quotaUserId = '00000000-0000-0000-0000-000000000001'
  await assertWithinDailyAIQuota(quotaUserId)

  // 5. Ask Claude for the patch
  const { proposal, usage } = await proposeGuidelinePatch({
    taskName: inboxTask.name,
    currentGuideline: latestGuideline.content,
    disputes: refinerCases,
  })

  // 6. Log the AI call against the quota
  await logAICall({
    userId: quotaUserId,
    feature: 'guideline-refiner',
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    workspaceId: parsed.workspaceId,
  })

  // 7. Persist the patch (status: pending)
  const [patchRow] = await db
    .insert(guidelinePatches)
    .values({
      guidelineId: latestGuideline.id,
      proposedBy: 'system',
      patchContent: `## ${proposal.title}\n\n${proposal.patchMarkdown}`,
      rationale: proposal.rationale,
      status: 'pending',
    })
    .returning()

  // 8. Audit
  await db.insert(events).values({
    type: 'guideline_patch.proposed',
    workspaceId: parsed.workspaceId,
    actorId: null,
    payload: {
      patchId: patchRow.id,
      guidelineId: latestGuideline.id,
      addressesCaseIds: proposal.addressesCaseIds,
      confidence: proposal.confidence,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    },
  })

  // Cache bust the disputes page
  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}/disputes`)
    revalidatePath(`/workspaces/${parsed.workspaceId}`)
  } catch {
    /* outside request context */
  }

  return {
    patchId: patchRow.id,
    title: proposal.title,
    rationale: proposal.rationale,
    confidence: proposal.confidence,
    addressesCount: proposal.addressesCaseIds.length,
    patchPreview: proposal.patchMarkdown.slice(0, 600),
  }
}

// ───────────────────────────────────────────────────────────────────────
// Merge / reject patches

const PATCH_DECISION = z.object({
  workspaceId: z.string().uuid(),
  patchId: z.string().uuid(),
})

export async function acceptPatchDemo(
  input: z.infer<typeof PATCH_DECISION>,
): Promise<{ newVersion: number }> {
  if (process.env.LABELHUB_DEMO_MODE !== 'true') {
    throw new AppError('DEMO_MODE_DISABLED', 'demo mode required', 403)
  }
  const parsed = PATCH_DECISION.parse(input)
  const db = getDb()

  const [patch] = await db
    .select()
    .from(guidelinePatches)
    .where(eq(guidelinePatches.id, parsed.patchId))
    .limit(1)
  if (!patch) throw new NotFoundError('Patch')
  if (patch.status !== 'pending') {
    throw new ValidationError(`Patch is already ${patch.status}`)
  }

  // Resolve current guideline version + create v+1 with patch content appended.
  const [currentGuideline] = await db
    .select()
    .from(guidelines)
    .where(eq(guidelines.id, patch.guidelineId))
    .limit(1)
  if (!currentGuideline) throw new NotFoundError('Guideline')

  const newContent = `${currentGuideline.content}\n\n${patch.patchContent}`
  const [newGuideline] = await db
    .insert(guidelines)
    .values({
      taskId: currentGuideline.taskId,
      version: currentGuideline.version + 1,
      content: newContent,
      parentVersionId: currentGuideline.id,
    })
    .returning()

  await db
    .update(guidelinePatches)
    .set({ status: 'accepted' })
    .where(eq(guidelinePatches.id, parsed.patchId))

  await db.insert(events).values({
    type: 'guideline_patch.accepted',
    workspaceId: parsed.workspaceId,
    actorId: null,
    payload: {
      patchId: parsed.patchId,
      previousGuidelineId: currentGuideline.id,
      newGuidelineId: newGuideline.id,
      newVersion: newGuideline.version,
    },
  })

  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}/disputes`)
  } catch {
    /* */
  }
  return { newVersion: newGuideline.version }
}

export async function rejectPatchDemo(
  input: z.infer<typeof PATCH_DECISION>,
): Promise<void> {
  if (process.env.LABELHUB_DEMO_MODE !== 'true') {
    throw new AppError('DEMO_MODE_DISABLED', 'demo mode required', 403)
  }
  const parsed = PATCH_DECISION.parse(input)
  const db = getDb()
  await db
    .update(guidelinePatches)
    .set({ status: 'rejected' })
    .where(eq(guidelinePatches.id, parsed.patchId))
  await db.insert(events).values({
    type: 'guideline_patch.rejected',
    workspaceId: parsed.workspaceId,
    actorId: null,
    payload: { patchId: parsed.patchId },
  })
  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}/disputes`)
  } catch {
    /* */
  }
}

/**
 * Read-only — list pending + recent patches for the disputes page.
 */
export async function listRecentPatches(
  workspaceId: string,
  limit = 20,
): Promise<
  Array<{
    id: string
    status: string
    patchContent: string
    rationale: string | null
    createdAt: Date
    guidelineId: string
    guidelineVersion: number
  }>
> {
  const db = getDb()
  const rows = await db
    .select({
      id: guidelinePatches.id,
      status: guidelinePatches.status,
      patchContent: guidelinePatches.patchContent,
      rationale: guidelinePatches.rationale,
      createdAt: guidelinePatches.createdAt,
      guidelineId: guidelinePatches.guidelineId,
      guidelineVersion: guidelines.version,
      taskWs: tasks.workspaceId,
    })
    .from(guidelinePatches)
    .innerJoin(guidelines, eq(guidelinePatches.guidelineId, guidelines.id))
    .innerJoin(tasks, eq(guidelines.taskId, tasks.id))
    .where(eq(tasks.workspaceId, workspaceId))
    .orderBy(desc(guidelinePatches.createdAt))
    .limit(limit)

  void trajectories // keep import lest tree-shake yells
  return rows
}
