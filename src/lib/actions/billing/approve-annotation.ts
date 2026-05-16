'use server'

/**
 * Approve an annotation → emit a payout_line_item.
 *
 * This is the trigger that turns labeled work into accrual. Once the
 * annotation is "approved" (currently means: `annotations.submittedAt`
 * was set AND no admin reject was filed — see flow below), this action:
 *
 *   1. Loads the annotation + its task's reward config
 *   2. Loads the annotator's trust score on that task's template_mode
 *   3. Runs the pure pricing engine to compute the line item amount
 *   4. Finds or creates the active payout_period for the workspace
 *   5. Upserts a payout_line_items row (one per annotation, by uniq index)
 *   6. Emits a `payout_line_item.created` event
 *
 * Workspace-admin only. We resolve the workspaceId from the annotation
 * chain BEFORE the auth check so admin-of-A can't approve work in
 * workspace B.
 *
 * Idempotent: re-running for the same annotation updates the existing
 * line item in place (the annotation_id uniq index makes this safe).
 * That means if trust score changes between calls, the next approval
 * "refresh" recomputes the line. Useful for replaying after a rubric
 * tweak.
 */

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  payoutLineItems,
  tasks,
  topics,
  trustScores,
} from '@/lib/db/schema'
import { AppError, NotFoundError } from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import {
  calculatePayoutLineItem,
  type PayoutCalcResult,
} from '@/lib/billing/calculate-payout'
import { economyConfigSchema, type EconomyConfig } from '@/lib/templates/types'
import { ensureActivePeriod } from '@/lib/billing/active-period'

const inputSchema = z.object({
  annotationId: uuidLike,
  bonusAmountMinor: z.number().int().nonnegative().optional(),
  penaltyAmountMinor: z.number().int().nonnegative().optional(),
})

export interface ApproveAnnotationResult {
  ok: true
  annotationId: string
  payoutLineItemId: string
  /** True when the line was newly inserted; false when updated in place. */
  created: boolean
  /** Pricing engine result for transparency / UI surfacing. */
  pricing: PayoutCalcResult
  /** Active payout-period the line landed in. */
  payoutPeriodId: string
}

export async function approveAnnotation(
  input: z.infer<typeof inputSchema>,
): Promise<ApproveAnnotationResult> {
  const parsed = inputSchema.parse(input)
  const db = getDb()

  // ── 1. Resolve annotation → topic → task → workspace ──────────────
  const [annRow] = await db
    .select({
      id: annotations.id,
      userId: annotations.userId,
      topicId: annotations.topicId,
      submittedAt: annotations.submittedAt,
    })
    .from(annotations)
    .where(eq(annotations.id, parsed.annotationId))
    .limit(1)
  if (!annRow) throw new NotFoundError('Annotation')
  if (!annRow.submittedAt) {
    throw new AppError(
      'NOT_SUBMITTED',
      'Annotation must be submitted before it can be approved.',
      400,
    )
  }

  const [topicRow] = await db
    .select({
      taskId: topics.taskId,
      // Phase-8 follow-up: pull the AI-estimated difficulty so the
      // pricing engine can apply the per-topic multiplier on top of
      // the rater's trust score. Null = topic wasn't auto-estimated
      // and the pricing engine treats it as 1.00× (no adjustment).
      difficulty: topics.difficulty,
    })
    .from(topics)
    .where(eq(topics.id, annRow.topicId))
    .limit(1)
  if (!topicRow) throw new NotFoundError('Topic')

  const [taskRow] = await db
    .select({
      id: tasks.id,
      workspaceId: tasks.workspaceId,
      templateMode: tasks.templateMode,
      rewardConfig: tasks.rewardConfig,
    })
    .from(tasks)
    .where(eq(tasks.id, topicRow.taskId))
    .limit(1)
  if (!taskRow) throw new NotFoundError('Task')

  // Approving annotations is admin-only. We resolve workspaceId from the
  // annotation chain first (above) so we can authorize against the correct
  // workspace — admin-of-A can't approve work in workspace B.
  const { user: actor } = await requireWorkspaceAdmin(taskRow.workspaceId)

  // ── 2. Parse the task's economy config ────────────────────────────
  const economyParse = economyConfigSchema.safeParse(taskRow.rewardConfig)
  if (!economyParse.success) {
    throw new AppError(
      'BAD_REWARD_CONFIG',
      `Task ${taskRow.id} has an invalid rewardConfig: ${economyParse.error.issues.map((i) => i.message).join('; ')}`,
      500,
    )
  }
  const economy: EconomyConfig = economyParse.data

  // ── 3. Trust score on this task's template mode ───────────────────
  // Default 0.5 (mid) when the annotator has no history yet — fair entry
  // point, matches the trust_scores default seeded in the table.
  const [trustRow] = await db
    .select({ score: trustScores.score })
    .from(trustScores)
    .where(
      and(
        eq(trustScores.userId, annRow.userId),
        eq(trustScores.taskType, taskRow.templateMode),
      ),
    )
    .limit(1)
  const trustScore = trustRow?.score ?? 0.5

  // ── 4. Compute the line via pure pricing engine ───────────────────
  // `difficulty` from the topic flows in here — without it the engine
  // would silently fall back to the 1.00× multiplier and the whole
  // adaptive-pricing feature would be inert. Pre-Phase-8 topics have
  // null difficulty (still 1.00×, no surprise).
  const pricing = calculatePayoutLineItem({
    economy,
    trustScore,
    difficulty: topicRow.difficulty,
    bonusAmountMinor: parsed.bonusAmountMinor,
    penaltyAmountMinor: parsed.penaltyAmountMinor,
  })

  // ── 5. Resolve active payout-period (lazy create) ─────────────────
  const period = await ensureActivePeriod(taskRow.workspaceId)

  // ── 6. Upsert by annotation_id ───────────────────────────────────
  const [existing] = await db
    .select({ id: payoutLineItems.id })
    .from(payoutLineItems)
    .where(eq(payoutLineItems.annotationId, parsed.annotationId))
    .limit(1)

  let lineItemId: string
  let created: boolean
  if (existing) {
    await db
      .update(payoutLineItems)
      .set({
        payoutPeriodId: period.id,
        userId: annRow.userId,
        economyType: pricing.economyType,
        currency: pricing.currency,
        baseAmountMinor: pricing.baseAmountMinor,
        qualityMultiplierBp: pricing.qualityMultiplierBp,
        bonusAmountMinor: pricing.bonusAmountMinor,
        penaltyAmountMinor: pricing.penaltyAmountMinor,
        totalAmountMinor: pricing.totalAmountMinor,
        status: pricing.isBillable ? 'approved' : 'rejected',
      })
      .where(eq(payoutLineItems.id, existing.id))
    lineItemId = existing.id
    created = false
  } else {
    const [inserted] = await db
      .insert(payoutLineItems)
      .values({
        payoutPeriodId: period.id,
        userId: annRow.userId,
        annotationId: parsed.annotationId,
        economyType: pricing.economyType,
        currency: pricing.currency,
        baseAmountMinor: pricing.baseAmountMinor,
        qualityMultiplierBp: pricing.qualityMultiplierBp,
        bonusAmountMinor: pricing.bonusAmountMinor,
        penaltyAmountMinor: pricing.penaltyAmountMinor,
        totalAmountMinor: pricing.totalAmountMinor,
        status: pricing.isBillable ? 'approved' : 'rejected',
      })
      .returning({ id: payoutLineItems.id })
    lineItemId = inserted.id
    created = true
  }

  // ── 7. Emit event ─────────────────────────────────────────────────
  // Audit the full multiplier stack so the "why this amount" UI can
  // reconstruct it without re-running the pricing engine: quality
  // (trust-based) × difficulty (AI-estimated) × base.
  await db.insert(events).values({
    type: created ? 'payout_line_item.created' : 'payout_line_item.updated',
    workspaceId: taskRow.workspaceId,
    actorId: actor.id,
    payload: {
      payoutLineItemId: lineItemId,
      payoutPeriodId: period.id,
      annotationId: parsed.annotationId,
      userId: annRow.userId,
      totalAmountMinor: pricing.totalAmountMinor,
      currency: pricing.currency,
      qualityMultiplierBp: pricing.qualityMultiplierBp,
      difficultyMultiplierBp: pricing.difficultyMultiplierBp,
      topicDifficulty: topicRow.difficulty ?? null,
      isBillable: pricing.isBillable,
    },
  })

  try {
    revalidatePath(`/workspaces/${taskRow.workspaceId}/billing`)
    revalidatePath(`/my/earnings`)
  } catch {
    /* outside request context */
  }

  return {
    ok: true,
    annotationId: parsed.annotationId,
    payoutLineItemId: lineItemId,
    created,
    pricing,
    payoutPeriodId: period.id,
  }
}
