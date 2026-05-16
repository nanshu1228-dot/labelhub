'use server'

/**
 * Server action — generate a rubric from a natural-language description.
 *
 * Auth: workspace admin only (template_config is admin-managed; this is
 * the same role that can edit the rubric by hand). Quota: standard
 * per-user daily AI cap. Cooldown: 15 s/user to keep cost predictable
 * if an admin mashes the button.
 *
 * Returns the parsed `GeneratedTemplate` for the admin to review +
 * accept. NO writes happen here — the form sends a separate `createTask`
 * call when the admin clicks Save.
 */

import { z } from 'zod'
import { and, eq, gt } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { aiCallLog } from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import {
  generateTemplate,
  generateTrajectoryRubric,
  toRubricSpec,
  type GeneratedTemplate,
  type GeneratedTrajectoryRubric,
} from '@/lib/ai/template-generator'
import {
  assertWithinDailyAIQuota,
  logAICall,
} from '@/lib/ai/quota'
import type { RubricSpec } from '@/lib/templates/rubric'
import { uuidLike } from '@/lib/validators/uuid'
import { AppError } from '@/lib/errors'

const GenerateInput = z.object({
  workspaceId: uuidLike,
  mode: z.enum(['pair-rubric', 'arena-gsb']),
  description: z.string().min(8).max(4000),
})

/** Per-user cooldown — keeps an admin's button-mashing from racking up
 *  Claude bills on long descriptions. */
const COOLDOWN_MS = 15 * 1000

/**
 * Run shared cooldown + quota checks across both generator variants.
 * `feature` differentiates them in ai_call_log so the cooldown is
 * scoped to the variant (admin can hit "pair-rubric → 🪄" then
 * immediately switch to "agent-trace-eval → 🪄" without waiting).
 */
async function gateAdmin(opts: {
  workspaceId: string
  feature: 'template-generator' | 'template-generator-traj'
}): Promise<{ userId: string }> {
  const { user } = await requireWorkspaceAdmin(opts.workspaceId)
  const db = getDb()
  const since = new Date(Date.now() - COOLDOWN_MS)
  const [recent] = await db
    .select({ id: aiCallLog.id })
    .from(aiCallLog)
    .where(
      and(
        eq(aiCallLog.userId, user.id),
        eq(aiCallLog.feature, opts.feature),
        gt(aiCallLog.ts, since),
      ),
    )
    .limit(1)
  if (recent) {
    throw new AppError(
      'COOLDOWN',
      'Please wait ~15 seconds between template generations.',
      429,
    )
  }
  await assertWithinDailyAIQuota(user.id)
  return { userId: user.id }
}

export async function generateTemplateFromDescription(
  input: z.infer<typeof GenerateInput>,
): Promise<{ ok: true; template: GeneratedTemplate }> {
  const parsed = GenerateInput.parse(input)
  const { userId } = await gateAdmin({
    workspaceId: parsed.workspaceId,
    feature: 'template-generator',
  })

  const { result, usage } = await generateTemplate({
    mode: parsed.mode,
    description: parsed.description,
  })

  await logAICall({
    userId,
    feature: 'template-generator',
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    workspaceId: parsed.workspaceId,
  })

  return { ok: true, template: result }
}

// ─── Agent-trace-eval (trajectory) ─────────────────────────────────────

const GenerateTrajectoryInput = z.object({
  workspaceId: uuidLike,
  description: z.string().min(8).max(4000),
})

/**
 * Same flow as generateTemplateFromDescription but produces a full
 * RubricSpec (perStep + perTrajectory) for agent-trace-eval mode. We
 * return BOTH the raw generated form (so the form UI can show Claude's
 * one-line summary) AND the canonical RubricSpec shape ready to drop
 * into templateConfig.rubric.
 */
export async function generateTrajectoryRubricFromDescription(
  input: z.infer<typeof GenerateTrajectoryInput>,
): Promise<{
  ok: true
  generated: GeneratedTrajectoryRubric
  rubric: RubricSpec
}> {
  const parsed = GenerateTrajectoryInput.parse(input)
  const { userId } = await gateAdmin({
    workspaceId: parsed.workspaceId,
    feature: 'template-generator-traj',
  })

  const { result, usage } = await generateTrajectoryRubric({
    description: parsed.description,
  })

  await logAICall({
    userId,
    feature: 'template-generator-traj',
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    workspaceId: parsed.workspaceId,
  })

  return { ok: true, generated: result, rubric: toRubricSpec(result) }
}
