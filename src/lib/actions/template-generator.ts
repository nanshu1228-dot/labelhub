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
  type GeneratedTemplate,
} from '@/lib/ai/template-generator'
import {
  assertWithinDailyAIQuota,
  logAICall,
} from '@/lib/ai/quota'
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

export async function generateTemplateFromDescription(
  input: z.infer<typeof GenerateInput>,
): Promise<{ ok: true; template: GeneratedTemplate }> {
  const parsed = GenerateInput.parse(input)

  // 1. Admin gate — only admins can edit template_config, so only
  //    admins should be able to seed it via AI.
  const { user } = await requireWorkspaceAdmin(parsed.workspaceId)

  // 2. Cooldown — last template-generator call within COOLDOWN_MS?
  const db = getDb()
  const since = new Date(Date.now() - COOLDOWN_MS)
  const [recent] = await db
    .select({ id: aiCallLog.id })
    .from(aiCallLog)
    .where(
      and(
        eq(aiCallLog.userId, user.id),
        eq(aiCallLog.feature, 'template-generator'),
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

  // 3. Daily AI quota — same global cap every AI feature respects.
  await assertWithinDailyAIQuota(user.id)

  // 4. Generate + log.
  const { result, usage } = await generateTemplate({
    mode: parsed.mode,
    description: parsed.description,
  })

  await logAICall({
    userId: user.id,
    feature: 'template-generator',
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    workspaceId: parsed.workspaceId,
  })

  return { ok: true, template: result }
}
