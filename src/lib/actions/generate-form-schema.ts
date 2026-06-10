'use server'

/**
 * Server action — generate a custom-designer FormSchema from a natural-
 * language description.
 *
 * Auth: workspace admin only (form schemas are admin-managed). Quota:
 * standard per-user daily AI cap. Cooldown: 15 s/user so button-mashing
 * doesn't rack up cost. NO writes happen here — the Designer seeds the
 * returned schema into the canvas; the admin reviews + saves separately.
 */

import { z } from 'zod'
import { and, eq, gt } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { aiCallLog } from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { generateFormSchema } from '@/lib/ai/form-schema-generator'
import { assertWithinDailyAIQuota, logAICall } from '@/lib/ai/quota'
import { uuidLike } from '@/lib/validators/uuid'
import { AppError } from '@/lib/errors'
import type { FormSchema } from '@/lib/form-designer/schema'

const GenerateInput = z.object({
  workspaceId: uuidLike,
  description: z.string().min(8).max(4000),
})

const COOLDOWN_MS = 15 * 1000
const FEATURE = 'form-schema-generator'

export async function generateFormSchemaFromDescription(
  input: z.infer<typeof GenerateInput>,
): Promise<{ ok: true; schema: FormSchema; summary: string }> {
  const parsed = GenerateInput.parse(input)
  const { user } = await requireWorkspaceAdmin(parsed.workspaceId)

  const db = getDb()
  const since = new Date(Date.now() - COOLDOWN_MS)
  const [recent] = await db
    .select({ id: aiCallLog.id })
    .from(aiCallLog)
    .where(
      and(
        eq(aiCallLog.userId, user.id),
        eq(aiCallLog.feature, FEATURE),
        gt(aiCallLog.ts, since),
      ),
    )
    .limit(1)
  if (recent) {
    throw new AppError(
      'COOLDOWN',
      'Please wait ~15 seconds between AI form generations.',
      429,
    )
  }
  await assertWithinDailyAIQuota(user.id)

  const { result, usage } = await generateFormSchema({
    description: parsed.description,
  })

  await logAICall({
    userId: user.id,
    feature: FEATURE,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    workspaceId: parsed.workspaceId,
  })

  return { ok: true, schema: result.schema, summary: result.summary }
}
