'use server'

/**
 * /analyze page server actions.
 *
 *   askBatchAnalyst({ workspaceId, filterString, question })
 *
 * Resolves the filter, loads matching trajectories (with pre-cached
 * summaries + features), computes aggregates, picks up to 5 sample
 * summaries, and asks the LLM to diagnose.
 *
 * Admin-only — non-admins shouldn't be peeking at cross-workspace
 * patterns or running paid LLM calls.
 */

import { z } from 'zod'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { assertWithinDailyAIQuota, logAICall } from '@/lib/ai/quota'
import {
  computeAggregates,
  listTrajectoriesByFilter,
  parseFilter,
  type AnalyzeAggregates,
  type AnalyzeRow,
} from '@/lib/queries/analyze'
import {
  askBatchAnalyst,
  type BatchAnalystResponse,
} from '@/lib/ai/batch-analyst'
import { uuidLike } from '@/lib/validators/uuid'

const inputSchema = z.object({
  workspaceId: uuidLike,
  filterString: z.string().max(400).default(''),
  question: z.string().min(3).max(2000),
})

export interface AskAnalystResult {
  ok: true
  response: BatchAnalystResponse
  aggregates: AnalyzeAggregates
  /** N of trajectories matching the filter. */
  matched: number
  /** How many we picked as samples for the LLM. */
  sampleCount: number
}

export async function askWorkspaceAnalyst(
  input: z.infer<typeof inputSchema>,
): Promise<AskAnalystResult | { ok: false; error: string }> {
  const parsed = inputSchema.parse(input)
  const { user } = await requireWorkspaceAdmin(parsed.workspaceId)

  const filter = parseFilter(parsed.filterString)
  const rows = await listTrajectoriesByFilter({
    workspaceId: parsed.workspaceId,
    filter,
    limit: 500,
  })
  const aggregates = computeAggregates(rows)

  if (rows.length === 0) {
    return {
      ok: false,
      error: 'No trajectories matched that filter. Loosen and try again.',
    }
  }

  // 3rd security audit (#2): gate Sonnet calls behind the per-user
  // daily AI quota — a looped "Ask" button on /analyze otherwise
  // burns unlimited tokens at premium tier. Throws on quota breach;
  // we map to a friendly { ok: false } response below in the catch.
  try {
    await assertWithinDailyAIQuota(user.id)
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Daily AI quota exceeded.',
    }
  }

  // Pick up to 5 samples: prefer rows WITH a cached summary, sample
  // across outcome buckets so the LLM sees a representative slice.
  const sampleRows = pickSampleRows(rows, 5)

  try {
    const result = await askBatchAnalyst({
      filterString: parsed.filterString,
      aggregates,
      sampleRows,
      question: parsed.question,
    })
    await logAICall({
      userId: user.id,
      feature: 'batch-analyst',
      model: result.usage.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      workspaceId: parsed.workspaceId,
    })
    return {
      ok: true,
      response: result.response,
      aggregates,
      matched: rows.length,
      sampleCount: sampleRows.length,
    }
  } catch (e) {
     
    console.error(
      '[analyze] analyst call failed:',
      e instanceof Error ? e.message : e,
      e instanceof Error ? e.stack : undefined,
    )
    return { ok: false, error: 'analyst call failed' }
  }
}

/**
 * Pick up to N rows for the LLM to inspect, biased toward:
 *   1. rows that have a cached summary (otherwise the LLM gets no detail)
 *   2. coverage across outcome buckets (one of each if possible)
 *
 * Ties broken by recency (already sorted desc by createdAt upstream).
 */
function pickSampleRows(rows: AnalyzeRow[], n: number): AnalyzeRow[] {
  const withSummary = rows.filter((r) => r.summary)
  if (withSummary.length === 0) return rows.slice(0, n)

  // Bucket by outcome.
  const buckets: Record<string, AnalyzeRow[]> = {
    errored: [],
    incomplete: [],
    completed: [],
  }
  for (const r of withSummary) {
    const o = r.features?.outcome ?? 'incomplete'
    if (buckets[o]) buckets[o].push(r)
  }

  // Round-robin: one from errored, one from incomplete, one from completed, repeat.
  const order = ['errored', 'incomplete', 'completed']
  const picked: AnalyzeRow[] = []
  let i = 0
  while (picked.length < n) {
    const b = buckets[order[i % order.length]]
    const next = b.shift()
    if (next) picked.push(next)
    i++
    if (i > order.length * n) break // exhausted
  }
  return picked
}

/**
 * Read-only helper used by the /analyze page server component to load
 * the filtered rows + aggregates without invoking the LLM.
 *
 * Input validation: workspaceId is parsed through `uuidLike` and the
 * filter string is bounded to 400 chars. The auth guard would catch a
 * malformed UUID downstream (workspace lookup fails → notFound), but
 * fail-fast here gives a cleaner error AND prevents arbitrary strings
 * from reaching the filter parser.
 */
export async function loadAnalyzeView(opts: {
  workspaceId: string
  filterString: string
}): Promise<{
  filter: ReturnType<typeof parseFilter>
  rows: AnalyzeRow[]
  aggregates: AnalyzeAggregates
}> {
  const parsed = analyzeViewInputSchema.parse(opts)
  await requireWorkspaceAdmin(parsed.workspaceId)
  const filter = parseFilter(parsed.filterString)
  const rows = await listTrajectoriesByFilter({
    workspaceId: parsed.workspaceId,
    filter,
    limit: 500,
  })
  return {
    filter,
    rows,
    aggregates: computeAggregates(rows),
  }
}

const analyzeViewInputSchema = z.object({
  workspaceId: uuidLike,
  filterString: z.string().max(400),
})
