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
 * Demo-mode-gated like its peers (no real Supabase Auth yet). When auth
 * lands, swap the admin actor check.
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
import {
  calculatePayoutLineItem,
  type PayoutCalcResult,
} from '@/lib/billing/calculate-payout'
import { economyConfigSchema, type EconomyConfig } from '@/lib/templates/types'
import { ensureActivePeriod } from '@/lib/billing/active-period'

function assertDemoMode(): void {
  if (process.env.LABELHUB_DEMO_MODE !== 'true') {
    throw new AppError(
      'DEMO_MODE_DISABLED',
      'Billing actions require LABELHUB_DEMO_MODE=true while real auth is pending.',
      403,
    )
  }
}

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
  assertDemoMode()
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
    .select({ taskId: topics.taskId })
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
  const pricing = calculatePayoutLineItem({
    economy,
    trustScore,
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
  await db.insert(events).values({
    type: created ? 'payout_line_item.created' : 'payout_line_item.updated',
    workspaceId: taskRow.workspaceId,
    actorId: null,
    payload: {
      payoutLineItemId: lineItemId,
      payoutPeriodId: period.id,
      annotationId: parsed.annotationId,
      userId: annRow.userId,
      totalAmountMinor: pricing.totalAmountMinor,
      currency: pricing.currency,
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
