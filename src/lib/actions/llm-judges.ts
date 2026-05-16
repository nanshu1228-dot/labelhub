'use server'

/**
 * LLM-as-Judge server actions.
 *
 *   createJudge   — admin defines a new judge (model + system prompt)
 *   listJudges    — admin lists workspace judges (active)
 *   runJudge      — admin runs the judge against N submitted annotations
 *
 * Run flow (synchronous for now — small samples, max 20):
 *   1. Auth admin
 *   2. Quota check (we'll burn N AI calls)
 *   3. Pick N random submitted annotations in the workspace whose
 *      task uses pair-rubric or arena-gsb (trajectory not yet supported)
 *   4. Insert judge_runs row (status='running')
 *   5. For each picked annotation:
 *        - resolve task + template (need the rubric)
 *        - run the judge model
 *        - diff judge vs human → agreement
 *        - insert judge_verdicts row
 *   6. Compute mean overall agreement → update judge_runs
 *   7. Return the run id for the UI to navigate to
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  judgeRuns,
  judgeVerdicts,
  llmJudges,
  tasks,
  topics,
} from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { uuidLike } from '@/lib/validators/uuid'
import {
  AppError,
  NotFoundError,
  ValidationError,
} from '@/lib/errors'
import { runJudge as runJudgeAI } from '@/lib/ai/judge'
import { compareAnnotations } from '@/lib/quality/judge-agreement'
import {
  assertWithinDailyAIQuota,
  logAICall,
} from '@/lib/ai/quota'
import { getEffectiveTemplate } from '@/lib/templates/effective'
import '@/lib/templates/init'

const createJudgeSchema = z.object({
  workspaceId: uuidLike,
  name: z.string().min(1).max(120),
  tier: z.enum(['fast', 'default', 'premium']),
  systemPrompt: z.string().min(8).max(20_000),
})

export async function createJudge(
  input: z.infer<typeof createJudgeSchema>,
): Promise<{ ok: true; judgeId: string }> {
  const parsed = createJudgeSchema.parse(input)
  const { user } = await requireWorkspaceAdmin(parsed.workspaceId)
  const db = getDb()

  const [row] = await db
    .insert(llmJudges)
    .values({
      workspaceId: parsed.workspaceId,
      name: parsed.name.trim(),
      tier: parsed.tier,
      systemPrompt: parsed.systemPrompt,
      createdBy: user.id,
    })
    .returning({ id: llmJudges.id })

  await db.insert(events).values({
    type: 'llm_judge.created',
    workspaceId: parsed.workspaceId,
    actorId: user.id,
    payload: { judgeId: row.id, name: parsed.name, tier: parsed.tier },
  })

  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}/judges`)
  } catch {
    /* */
  }
  return { ok: true, judgeId: row.id }
}

const runJudgeSchema = z.object({
  judgeId: uuidLike,
  /** How many human-annotated samples to compare against. Hard-capped
   *  at 20 for v1 — synchronous flow, larger sizes should use the
   *  async background variant we'll ship later. */
  sampleSize: z.number().int().min(1).max(20),
})

export async function runJudgeAction(
  input: z.infer<typeof runJudgeSchema>,
): Promise<{ ok: true; runId: string }> {
  const parsed = runJudgeSchema.parse(input)
  const db = getDb()

  const [judge] = await db
    .select()
    .from(llmJudges)
    .where(eq(llmJudges.id, parsed.judgeId))
    .limit(1)
  if (!judge) throw new NotFoundError('Judge')
  if (judge.revokedAt) {
    throw new ValidationError('This judge has been revoked.')
  }

  const { user } = await requireWorkspaceAdmin(judge.workspaceId)
  await assertWithinDailyAIQuota(user.id)

  // Pick N random submitted annotations in this workspace whose task
  // uses a supported mode. We use postgres random ordering — fine for
  // sample sizes ≤ 20; for larger we'd switch to TABLESAMPLE.
  const candidates = await db
    .select({
      annotationId: annotations.id,
      annotationPayload: annotations.payload,
      topicId: topics.id,
      topicItemData: topics.itemData,
      taskId: tasks.id,
      taskTemplateMode: tasks.templateMode,
      taskTemplateConfig: tasks.templateConfig,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .where(
      and(
        eq(tasks.workspaceId, judge.workspaceId),
        inArray(tasks.templateMode, ['pair-rubric', 'arena-gsb']),
        // Only submitted annotations have a meaningful payload to
        // judge against.
        sql`${annotations.submittedAt} is not null`,
      ),
    )
    .orderBy(sql`random()`)
    .limit(parsed.sampleSize)

  if (candidates.length === 0) {
    throw new ValidationError(
      'No submitted pair-rubric / arena-gsb annotations to judge yet. Submit some first.',
    )
  }

  const [run] = await db
    .insert(judgeRuns)
    .values({
      judgeId: judge.id,
      workspaceId: judge.workspaceId,
      status: 'running',
      sampleCount: candidates.length,
    })
    .returning()

  // Iterate sequentially — we want the per-call quota check to stay
  // honest, and the upstream rate limits forgive serial calls more
  // than parallel ones.
  const verdictAgreements: number[] = []
  let failed = 0
  for (const c of candidates) {
    try {
      const mode = c.taskTemplateMode as 'pair-rubric' | 'arena-gsb'
      const template = getEffectiveTemplate(mode, c.taskTemplateConfig)
      if (!template) {
        failed++
        continue
      }
      const rubric =
        mode === 'pair-rubric'
          ? template.pairChecklist ?? []
          : template.arenaDimensions ?? []
      if (rubric.length === 0) {
        failed++
        continue
      }

      const item = (c.topicItemData ?? {}) as {
        prompt?: unknown
        responseA?: { content?: unknown }
        responseB?: { content?: unknown }
      }
      const prompt = typeof item.prompt === 'string' ? item.prompt : ''
      const responseA =
        typeof item.responseA?.content === 'string'
          ? item.responseA.content
          : ''
      const responseB =
        typeof item.responseB?.content === 'string'
          ? item.responseB.content
          : ''

      const { payload, usage } = await runJudgeAI({
        mode,
        tier: judge.tier as 'fast' | 'default' | 'premium',
        judgeInstructions: judge.systemPrompt,
        prompt,
        responseA,
        responseB,
        rubric,
      })

      const agreement = compareAnnotations(
        mode,
        payload,
        c.annotationPayload,
        rubric,
      )

      await db.insert(judgeVerdicts).values({
        judgeRunId: run.id,
        annotationId: c.annotationId,
        judgePayload: payload,
        agreementScore: agreement.overall,
        perRubricBreakdown: agreement.perRubric,
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
      })

      await logAICall({
        userId: user.id,
        feature: 'llm-judge',
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        workspaceId: judge.workspaceId,
      })

      verdictAgreements.push(agreement.overall)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        '[judge] verdict failed on annotation',
        c.annotationId,
        e instanceof Error ? e.message : e,
      )
      failed++
    }
  }

  const finalScore =
    verdictAgreements.length === 0
      ? null
      : verdictAgreements.reduce((a, b) => a + b, 0) /
        verdictAgreements.length

  await db
    .update(judgeRuns)
    .set({
      status:
        verdictAgreements.length === 0
          ? 'failed'
          : 'completed',
      agreementScore: finalScore,
      finishedAt: new Date(),
      errorText:
        verdictAgreements.length === 0
          ? `every sample failed (n=${candidates.length}, failed=${failed})`
          : null,
    })
    .where(eq(judgeRuns.id, run.id))

  await db.insert(events).values({
    type:
      verdictAgreements.length === 0
        ? 'llm_judge.run_failed'
        : 'llm_judge.run_completed',
    workspaceId: judge.workspaceId,
    actorId: user.id,
    payload: {
      judgeId: judge.id,
      runId: run.id,
      samples: candidates.length,
      succeeded: verdictAgreements.length,
      failed,
      agreementScore: finalScore,
    },
  })

  try {
    revalidatePath(`/workspaces/${judge.workspaceId}/judges/${judge.id}`)
  } catch {
    /* */
  }

  if (verdictAgreements.length === 0) {
    throw new AppError(
      'JUDGE_RUN_FAILED',
      `All ${candidates.length} samples failed. Check the judge prompt + try again.`,
      500,
    )
  }
  return { ok: true, runId: run.id }
}

const revokeJudgeSchema = z.object({ judgeId: uuidLike })

export async function revokeJudge(
  input: z.infer<typeof revokeJudgeSchema>,
): Promise<{ ok: true }> {
  const parsed = revokeJudgeSchema.parse(input)
  const db = getDb()
  const [judge] = await db
    .select({ id: llmJudges.id, workspaceId: llmJudges.workspaceId })
    .from(llmJudges)
    .where(and(eq(llmJudges.id, parsed.judgeId), isNull(llmJudges.revokedAt)))
    .limit(1)
  if (!judge) throw new NotFoundError('Judge')
  const { user } = await requireWorkspaceAdmin(judge.workspaceId)
  await db
    .update(llmJudges)
    .set({ revokedAt: new Date() })
    .where(eq(llmJudges.id, judge.id))
  await db.insert(events).values({
    type: 'llm_judge.revoked',
    workspaceId: judge.workspaceId,
    actorId: user.id,
    payload: { judgeId: judge.id },
  })
  try {
    revalidatePath(`/workspaces/${judge.workspaceId}/judges`)
  } catch {
    /* */
  }
  return { ok: true }
}

void desc // used in queries — keep import warm
