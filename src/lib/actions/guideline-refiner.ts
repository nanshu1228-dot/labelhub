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
  annotations,
  events,
  guidelines,
  guidelinePatches,
  tasks,
  topics,
  trajectorySteps,
  trajectories,
  users,
  workspaces,
} from '@/lib/db/schema'
import {
  proposeGuidelinePatch,
  type DisputeCase,
} from '@/lib/ai/guideline-refiner'
import { isAnyProviderConfigured } from '@/lib/ai/client'
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
  // Provider-agnostic — any configured LLM (Doubao, Anthropic, DeepSeek,
  // Moonshot, Qwen, OpenAI) works. Resolved at chat() time.
  if (!isAnyProviderConfigured()) {
    throw new AppError(
      'AI_NOT_CONFIGURED',
      'No LLM provider configured. Set one of DOUBAO_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY (etc.) in env.',
      503,
    )
  }
  const parsed = REFINER_INPUT.parse(input)
  const db = getDb()

  // 1. Resolve workspace + templateMode so we branch to the right
  //    dispute source. agent-trace-eval reads trajectory step disputes;
  //    pair-rubric / arena-gsb reads payload-based disputes.
  const [workspace] = await db
    .select({
      id: workspaces.id,
      templateMode: workspaces.templateMode,
    })
    .from(workspaces)
    .where(eq(workspaces.id, parsed.workspaceId))
    .limit(1)
  if (!workspace) throw new NotFoundError('Workspace')

  let refinerCases: DisputeCase[]
  let targetTask: typeof tasks.$inferSelect
  let latestGuideline: typeof guidelines.$inferSelect

  if (workspace.templateMode === 'pair-rubric' || workspace.templateMode === 'arena-gsb') {
    const pairBuild = await buildPairArenaDisputeContext({
      workspaceId: parsed.workspaceId,
      templateMode: workspace.templateMode,
    })
    refinerCases = pairBuild.cases
    targetTask = pairBuild.task
    latestGuideline = pairBuild.guideline
  } else {
    // agent-trace-eval (default): existing trajectory step-disputes path.
    const disputes = await listTopDisputes({
      workspaceId: parsed.workspaceId,
      limit: 10,
    })
    if (disputes.length === 0) {
      throw new ValidationError(
        'No disputed steps found in this workspace — annotators all agree (or no multi-rater step yet).',
      )
    }

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
    targetTask = inboxTask

    const [existing] = await db
      .select()
      .from(guidelines)
      .where(eq(guidelines.taskId, inboxTask.id))
      .orderBy(desc(guidelines.version))
      .limit(1)
    if (existing) {
      latestGuideline = existing
    } else {
      const seed =
        inboxTask.guidelinesMarkdown ??
        `# Inbox annotation guideline (v1)\n\nRate each step as ✓ correct / ⚠ suspicious / ✗ wrong. Use the reasoning field to record WHY.`
      const [created] = await db
        .insert(guidelines)
        .values({ taskId: inboxTask.id, version: 1, content: seed })
        .returning()
      latestGuideline = created
    }

    // Hydrate disputes with step kind + summary.
    const stepRows = await db
      .select({
        id: trajectorySteps.id,
        kind: trajectorySteps.kind,
        content: trajectorySteps.content,
      })
      .from(trajectorySteps)
      .where(eq(trajectorySteps.trajectoryId, disputes[0].trajectoryId))
    const stepById = new Map(stepRows.map((s) => [s.id, s]))
    refinerCases = disputes.map((d) => {
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
  }

  const inboxTask = targetTask // back-compat alias for the rest of the function

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

// ─────────────────────────────────────────────────────────────────────────
// Pair-rubric / arena-gsb dispute extraction.
//
// For these modes the "disputed unit" is a (topic, rubricId|dimId, side)
// triple rather than a (trajectoryStep). We scan submitted annotations,
// group by topic, and surface topics where at least one rubric/dim
// produced a real disagreement. Each surfaced topic becomes one
// DisputeCase: the prompt + A/B responses are the "step summary", and
// each rater's full payload-per-rubric becomes a synthetic "rater call".

interface PairArenaContext {
  cases: DisputeCase[]
  task: typeof tasks.$inferSelect
  guideline: typeof guidelines.$inferSelect
}

async function buildPairArenaDisputeContext(opts: {
  workspaceId: string
  templateMode: 'pair-rubric' | 'arena-gsb'
}): Promise<PairArenaContext> {
  const db = getDb()

  // 1. Load every submitted annotation in this workspace's pair/arena
  //    tasks — bounded by templateMode + workspaceId.
  type AnnoRow = {
    annotationId: string
    userId: string
    displayName: string | null
    topicId: string
    itemData: unknown
    payload: unknown
    taskId: string
    taskName: string
    templateMode: string
  }
  const rows = (await db
    .select({
      annotationId: annotations.id,
      userId: annotations.userId,
      displayName: users.displayName,
      topicId: annotations.topicId,
      itemData: topics.itemData,
      payload: annotations.payload,
      taskId: tasks.id,
      taskName: tasks.name,
      templateMode: tasks.templateMode,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .innerJoin(users, eq(users.id, annotations.userId))
    .where(
      and(
        eq(tasks.workspaceId, opts.workspaceId),
        eq(tasks.templateMode, opts.templateMode),
      ),
    )) as AnnoRow[]

  // 2. Group by topic; dedupe to one annotation per (topic, user).
  const byTopic = new Map<string, AnnoRow[]>()
  const seenByUser = new Set<string>()
  for (const r of rows) {
    const key = `${r.topicId}|${r.userId}`
    if (seenByUser.has(key)) continue
    seenByUser.add(key)
    const list = byTopic.get(r.topicId) ?? []
    list.push(r)
    byTopic.set(r.topicId, list)
  }

  // 3. For each multi-rater topic, detect whether ANY rubric/dim split.
  const cases: DisputeCase[] = []
  for (const list of byTopic.values()) {
    if (list.length < 2) continue
    const verdictLines: string[] = []
    let hasSplit = false

    if (opts.templateMode === 'pair-rubric') {
      // collect rubric ids and check majority split per (rubric, side)
      const rubricIds = new Set<string>()
      for (const a of list) {
        const ratings = ((a.payload as Record<string, unknown> | null) ?? {})
          .ratings as Record<string, { a?: unknown; b?: unknown }> | undefined
        if (ratings)
          for (const k of Object.keys(ratings)) rubricIds.add(k)
      }
      for (const rubricId of rubricIds) {
        const verdicts = list
          .map((a) => {
            const r = ((a.payload as Record<string, unknown> | null) ?? {})
              .ratings as Record<string, { a?: unknown; b?: unknown }> | undefined
            const v = r?.[rubricId]
            if (!v || typeof v.a !== 'boolean' || typeof v.b !== 'boolean')
              return null
            return { user: a.displayName ?? 'anonymous', a: v.a, b: v.b }
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
        if (verdicts.length < 2) continue
        const allASame = verdicts.every((v) => v.a === verdicts[0].a)
        const allBSame = verdicts.every((v) => v.b === verdicts[0].b)
        if (allASame && allBSame) continue
        hasSplit = true
        verdictLines.push(
          `Rubric "${rubricId}": ` +
            verdicts
              .map((v) => `${v.user}: A=${v.a ? '✓' : '✗'} B=${v.b ? '✓' : '✗'}`)
              .join(' | '),
        )
      }
    } else {
      // arena-gsb: detect spread > 1 on either side per dimension
      const dimIds = new Set<string>()
      for (const a of list) {
        const dims = ((a.payload as Record<string, unknown> | null) ?? {})
          .dimensions as Record<string, { a?: unknown; b?: unknown }> | undefined
        if (dims) for (const k of Object.keys(dims)) dimIds.add(k)
      }
      for (const dimId of dimIds) {
        const scores = list
          .map((a) => {
            const d = ((a.payload as Record<string, unknown> | null) ?? {})
              .dimensions as Record<string, { a?: unknown; b?: unknown }> | undefined
            const v = d?.[dimId]
            if (!v || typeof v.a !== 'number' || typeof v.b !== 'number')
              return null
            return { user: a.displayName ?? 'anonymous', a: v.a, b: v.b }
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
        if (scores.length < 2) continue
        const aSpread = Math.max(...scores.map((s) => s.a)) - Math.min(...scores.map((s) => s.a))
        const bSpread = Math.max(...scores.map((s) => s.b)) - Math.min(...scores.map((s) => s.b))
        if (aSpread <= 1 && bSpread <= 1) continue
        hasSplit = true
        verdictLines.push(
          `Dimension "${dimId}": ` +
            scores.map((s) => `${s.user}: A=${s.a} B=${s.b}`).join(' | '),
        )
      }
    }
    if (!hasSplit) continue

    const item = (list[0].itemData ?? {}) as {
      prompt?: unknown
      responseA?: { content?: unknown }
      responseB?: { content?: unknown }
    }
    const prompt = typeof item.prompt === 'string' ? item.prompt : '(no prompt)'
    const aBody =
      typeof item.responseA?.content === 'string' ? item.responseA.content : '(no A)'
    const bBody =
      typeof item.responseB?.content === 'string' ? item.responseB.content : '(no B)'
    const stepSummary = `PROMPT: ${prompt.slice(0, 240)}\nA: ${aBody.slice(0, 240)}\nB: ${bBody.slice(0, 240)}\nDISAGREEMENTS:\n  ${verdictLines.slice(0, 6).join('\n  ')}`
    cases.push({
      id: list[0].topicId,
      stepKind: opts.templateMode,
      stepSummary,
      // We don't have per-rater reasoning here (the form's `notes` /
      // `reasoning` field is per-annotation, not per-rubric). Pull each
      // annotator's notes if available; else leave the label as the
      // payload summary.
      raterCalls: list.map((a) => {
        const p = (a.payload ?? {}) as Record<string, unknown>
        const reasoning =
          typeof p.notes === 'string'
            ? p.notes
            : typeof p.reasoning === 'string'
              ? p.reasoning
              : '(no notes recorded)'
        const verdict =
          opts.templateMode === 'arena-gsb' && typeof p.overallVerdict === 'string'
            ? p.overallVerdict
            : 'submitted'
        return {
          label: `${a.displayName ?? 'anon'} (${verdict})`,
          reasoning: reasoning.slice(0, 600),
        }
      }),
    })
    if (cases.length >= 8) break // cap input size — Claude doesn't need all
  }

  if (cases.length === 0) {
    throw new ValidationError(
      'No disputed topics yet — annotators all agree (or only one has submitted).',
    )
  }

  // 4. Pick the target task: the one that contributed the most disputed
  //    cases. Its guideline is the one we'll patch.
  const taskCounts = new Map<string, number>()
  for (const list of byTopic.values()) {
    for (const a of list) {
      taskCounts.set(a.taskId, (taskCounts.get(a.taskId) ?? 0) + 1)
    }
  }
  const targetTaskId = [...taskCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!targetTaskId) throw new NotFoundError('Task')
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, targetTaskId))
    .limit(1)
  if (!task) throw new NotFoundError('Task')

  // 5. Resolve / seed the latest guideline for the target task.
  let [guideline] = await db
    .select()
    .from(guidelines)
    .where(eq(guidelines.taskId, task.id))
    .orderBy(desc(guidelines.version))
    .limit(1)
  if (!guideline) {
    const seed =
      task.guidelinesMarkdown ??
      `# ${task.name} — annotation guideline (v1)\n\nFollow the rubric. Be specific in notes.`
    ;[guideline] = await db
      .insert(guidelines)
      .values({ taskId: task.id, version: 1, content: seed })
      .returning()
  }

  return { cases, task, guideline }
}
