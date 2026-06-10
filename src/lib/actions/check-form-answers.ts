'use server'

/**
 * check-form-answers — pre-submission AI sanity check for CUSTOM-DESIGNER
 * tasks. Sibling of draft-feedback.ts (which serves pair/arena modes).
 *
 * Flow mirrors draft-feedback: member-auth → 20s cooldown → daily quota →
 * resolve topic/task server-side → call the checker → log tokens. The
 * field list + values come from the client (that's the whole point —
 * review what's about to be submitted); they're LLM input only, never
 * trusted for a state mutation. Advisory only — never blocks submit.
 */

import { z } from 'zod'
import { and, desc, eq, gt } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { aiCallLog, guidelines, tasks, topics } from '@/lib/db/schema'
import { requireWorkspaceMember } from '@/lib/auth/guards'
import { AppError, NotFoundError, ValidationError } from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'
import { checkFormAnswers, type FormCheck } from '@/lib/ai/form-answer-checker'
import { assertWithinDailyAIQuota, logAICall } from '@/lib/ai/quota'

const Input = z.object({
  topicId: uuidLike,
  fields: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        label: z.string().max(200),
        kind: z.string().max(40),
        required: z.boolean(),
      }),
    )
    .max(64),
  values: z.record(z.string(), z.unknown()),
})

const COOLDOWN_MS = 20 * 1000
const FEATURE = 'form-answer-checker'

export async function getFormAnswerCheck(
  input: z.infer<typeof Input>,
): Promise<{ ok: true; check: FormCheck }> {
  const parsed = Input.parse(input)
  const db = getDb()

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

  if (task.templateMode !== 'custom-designer') {
    throw new ValidationError(
      `AI form check is only for custom-designer tasks (got ${task.templateMode}).`,
    )
  }

  const cooldownStart = new Date(Date.now() - COOLDOWN_MS)
  const [recent] = await db
    .select({ id: aiCallLog.id })
    .from(aiCallLog)
    .where(
      and(
        eq(aiCallLog.userId, user.id),
        eq(aiCallLog.feature, FEATURE),
        gt(aiCallLog.ts, cooldownStart),
      ),
    )
    .limit(1)
  if (recent) {
    throw new AppError(
      'COOLDOWN',
      'Please wait ~20 seconds between AI checks. Burning tokens is sad.',
      429,
    )
  }

  await assertWithinDailyAIQuota(user.id)

  const [latestGuideline] = await db
    .select({ content: guidelines.content })
    .from(guidelines)
    .where(eq(guidelines.taskId, task.id))
    .orderBy(desc(guidelines.version))
    .limit(1)

  const { check, usage } = await checkFormAnswers({
    taskGuidelines: latestGuideline?.content ?? '',
    itemData: topic.itemData ?? {},
    fields: parsed.fields,
    values: parsed.values,
  })

  await logAICall({
    userId: user.id,
    feature: FEATURE,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    workspaceId: task.workspaceId,
  })

  return { ok: true, check }
}
