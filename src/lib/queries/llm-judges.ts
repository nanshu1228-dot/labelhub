import 'server-only'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { judgeRuns, judgeVerdicts, llmJudges, users } from '@/lib/db/schema'

/**
 * Read-side helpers for LLM judge pages. Admin-only at the page layer.
 */

export interface JudgeRow {
  id: string
  name: string
  tier: string
  systemPrompt: string
  createdByDisplayName: string | null
  createdAt: Date
  /** Latest run's overall agreement (null until first run completes). */
  lastAgreement: number | null
  /** Most recent run timestamp; null until first run. */
  lastRunAt: Date | null
  /** Count of completed runs (excludes failed). */
  runCount: number
}

export async function listJudgesForWorkspace(
  workspaceId: string,
): Promise<JudgeRow[]> {
  const db = getDb()
  // 1. Active judges + creator name.
  const judges = await db
    .select({
      id: llmJudges.id,
      name: llmJudges.name,
      tier: llmJudges.tier,
      systemPrompt: llmJudges.systemPrompt,
      createdByDisplayName: users.displayName,
      createdAt: llmJudges.createdAt,
    })
    .from(llmJudges)
    .leftJoin(users, eq(users.id, llmJudges.createdBy))
    .where(
      and(eq(llmJudges.workspaceId, workspaceId), isNull(llmJudges.revokedAt)),
    )
    .orderBy(desc(llmJudges.createdAt))
  if (judges.length === 0) return []

  // 2. Per-judge run summary — single query, bucket in JS.
  const runs = await db
    .select({
      judgeId: judgeRuns.judgeId,
      agreementScore: judgeRuns.agreementScore,
      finishedAt: judgeRuns.finishedAt,
      status: judgeRuns.status,
    })
    .from(judgeRuns)
    .where(eq(judgeRuns.workspaceId, workspaceId))
    .orderBy(desc(judgeRuns.finishedAt))

  const byJudge = new Map<
    string,
    { latest: Date | null; agreement: number | null; runs: number }
  >()
  for (const r of runs) {
    if (r.status !== 'completed') continue
    const slot = byJudge.get(r.judgeId) ?? {
      latest: null,
      agreement: null,
      runs: 0,
    }
    slot.runs += 1
    if (
      r.finishedAt &&
      (!slot.latest || r.finishedAt > slot.latest)
    ) {
      slot.latest = r.finishedAt
      slot.agreement = r.agreementScore
    }
    byJudge.set(r.judgeId, slot)
  }

  return judges.map((j) => ({
    id: j.id,
    name: j.name,
    tier: j.tier,
    systemPrompt: j.systemPrompt,
    createdByDisplayName: j.createdByDisplayName,
    createdAt: j.createdAt,
    lastAgreement: byJudge.get(j.id)?.agreement ?? null,
    lastRunAt: byJudge.get(j.id)?.latest ?? null,
    runCount: byJudge.get(j.id)?.runs ?? 0,
  }))
}

export interface JudgeDetail {
  judge: {
    id: string
    name: string
    tier: string
    systemPrompt: string
    createdAt: Date
  }
  runs: Array<{
    id: string
    status: string
    sampleCount: number
    agreementScore: number | null
    errorText: string | null
    startedAt: Date
    finishedAt: Date | null
  }>
}

export async function getJudgeDetail(
  judgeId: string,
): Promise<JudgeDetail | null> {
  const db = getDb()
  const [judge] = await db
    .select({
      id: llmJudges.id,
      name: llmJudges.name,
      tier: llmJudges.tier,
      systemPrompt: llmJudges.systemPrompt,
      createdAt: llmJudges.createdAt,
      revokedAt: llmJudges.revokedAt,
    })
    .from(llmJudges)
    .where(eq(llmJudges.id, judgeId))
    .limit(1)
  if (!judge || judge.revokedAt) return null

  const runs = await db
    .select({
      id: judgeRuns.id,
      status: judgeRuns.status,
      sampleCount: judgeRuns.sampleCount,
      agreementScore: judgeRuns.agreementScore,
      errorText: judgeRuns.errorText,
      startedAt: judgeRuns.startedAt,
      finishedAt: judgeRuns.finishedAt,
    })
    .from(judgeRuns)
    .where(eq(judgeRuns.judgeId, judgeId))
    .orderBy(desc(judgeRuns.startedAt))
    .limit(50)

  return {
    judge: {
      id: judge.id,
      name: judge.name,
      tier: judge.tier,
      systemPrompt: judge.systemPrompt,
      createdAt: judge.createdAt,
    },
    runs,
  }
}

export interface RunDetail {
  run: {
    id: string
    judgeId: string
    workspaceId: string
    judgeName: string
    judgeTier: string
    status: string
    sampleCount: number
    agreementScore: number | null
    errorText: string | null
    startedAt: Date
    finishedAt: Date | null
  }
  verdicts: Array<{
    id: string
    annotationId: string
    agreementScore: number
    perRubricBreakdown: Record<string, number>
    tokensIn: number
    tokensOut: number
    createdAt: Date
  }>
}

export async function getRunDetail(runId: string): Promise<RunDetail | null> {
  const db = getDb()
  const [run] = await db
    .select({
      id: judgeRuns.id,
      judgeId: judgeRuns.judgeId,
      workspaceId: judgeRuns.workspaceId,
      judgeName: llmJudges.name,
      judgeTier: llmJudges.tier,
      status: judgeRuns.status,
      sampleCount: judgeRuns.sampleCount,
      agreementScore: judgeRuns.agreementScore,
      errorText: judgeRuns.errorText,
      startedAt: judgeRuns.startedAt,
      finishedAt: judgeRuns.finishedAt,
    })
    .from(judgeRuns)
    .innerJoin(llmJudges, eq(llmJudges.id, judgeRuns.judgeId))
    .where(eq(judgeRuns.id, runId))
    .limit(1)
  if (!run) return null

  const verdicts = await db
    .select({
      id: judgeVerdicts.id,
      annotationId: judgeVerdicts.annotationId,
      agreementScore: judgeVerdicts.agreementScore,
      perRubricBreakdown: judgeVerdicts.perRubricBreakdown,
      tokensIn: judgeVerdicts.tokensIn,
      tokensOut: judgeVerdicts.tokensOut,
      createdAt: judgeVerdicts.createdAt,
    })
    .from(judgeVerdicts)
    .where(eq(judgeVerdicts.judgeRunId, runId))
    .orderBy(desc(judgeVerdicts.agreementScore))

  return {
    run,
    verdicts: verdicts.map((v) => ({
      id: v.id,
      annotationId: v.annotationId,
      agreementScore: v.agreementScore,
      perRubricBreakdown:
        (v.perRubricBreakdown ?? {}) as Record<string, number>,
      tokensIn: v.tokensIn,
      tokensOut: v.tokensOut,
      createdAt: v.createdAt,
    })),
  }
}
