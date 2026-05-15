import 'server-only'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { annotations, tasks, topics } from '@/lib/db/schema'
import { dimensionGsb } from '@/lib/templates/modes/arena-gsb'

/**
 * Inter-annotator agreement for the topic-payload modes
 * (`pair-rubric` and `arena-gsb`).
 *
 * The trajectory IAA system (`iaa.ts`) keys off `step_annotations.rating`
 * because each rubric there produces one mark per step. The pair modes
 * are different: each rubric/dimension produces TWO marks per topic
 * (one for model A, one for model B), and the data lives in
 * `annotations.payload`, not `step_annotations`.
 *
 * This file mirrors the trajectory IAA shape — agreement rate, per-
 * rubric / per-dimension dispute counts — adapted to the pair payload.
 *
 * Tolerance / disagreement semantics:
 *   - pair-rubric (boolean): annotators DISAGREE if any two raters
 *     gave opposite values for the same (rubricId, side).
 *   - arena-gsb (1-5 likert): same tolerance as trajectory rubrics
 *     (spread > 1 is a dispute).
 *
 * Auth: callers pass `workspaceId` after their own role check.
 */

export interface PairRubricRow {
  rubricId: string
  multiRaterTopics: number
  disputedTopics: number
  /** Fraction (0–1). null when no multi-rater topics exist. */
  agreementRate: number | null
}

export interface ArenaDimensionRow {
  dimensionId: string
  multiRaterTopics: number
  disputedTopics: number
  agreementRate: number | null
}

export interface ArenaOverallRow {
  multiRaterTopics: number
  disputedTopics: number
  /** Per-verdict tallies summed across all multi-rater topics. */
  byVerdict: { a_better: number; tie: number; b_better: number }
}

interface SubmittedAnno {
  id: string
  userId: string
  topicId: string
  payload: Record<string, unknown>
}

/**
 * Load all submitted annotations for tasks in a workspace that use the
 * given templateMode. Groups them by topicId so caller can reduce.
 *
 * Returns Map<topicId, SubmittedAnno[]>. Topics with <2 annotations are
 * not interesting for IAA — caller filters those out.
 */
async function loadSubmittedByTopic(opts: {
  workspaceId: string
  templateMode: 'pair-rubric' | 'arena-gsb'
}): Promise<Map<string, SubmittedAnno[]>> {
  const db = getDb()
  const rows = await db
    .select({
      id: annotations.id,
      userId: annotations.userId,
      topicId: annotations.topicId,
      payload: annotations.payload,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .where(
      and(
        eq(tasks.workspaceId, opts.workspaceId),
        eq(tasks.templateMode, opts.templateMode),
        isNotNull(annotations.submittedAt),
      ),
    )

  const byTopic = new Map<string, SubmittedAnno[]>()
  for (const r of rows) {
    const list = byTopic.get(r.topicId) ?? []
    list.push({
      id: r.id,
      userId: r.userId,
      topicId: r.topicId,
      payload: (r.payload ?? {}) as Record<string, unknown>,
    })
    byTopic.set(r.topicId, list)
  }
  return byTopic
}

/**
 * Per-rubric disagreement table for a pair-rubric workspace.
 *
 * For each rubric id that appears in any submitted annotation:
 *   - count topics where ≥2 distinct raters answered both sides
 *   - count topics where any two raters' (a, b) booleans disagreed
 */
export async function getPairRubricIAA(opts: {
  workspaceId: string
}): Promise<PairRubricRow[]> {
  const byTopic = await loadSubmittedByTopic({
    workspaceId: opts.workspaceId,
    templateMode: 'pair-rubric',
  })

  // perRubric[rubricId] = { multi, disputed }
  const perRubric = new Map<
    string,
    { multi: number; disputed: number }
  >()

  for (const annos of byTopic.values()) {
    // Deduplicate by user — a user re-submitting the same topic counts once.
    const uniqByUser = new Map<string, SubmittedAnno>()
    for (const a of annos) uniqByUser.set(a.userId, a)
    if (uniqByUser.size < 2) continue
    const list = Array.from(uniqByUser.values())

    // Gather the union of rubric ids that any rater answered for this topic.
    const allRubricIds = new Set<string>()
    for (const anno of list) {
      const ratings = (anno.payload.ratings ?? {}) as Record<
        string,
        { a?: unknown; b?: unknown }
      >
      for (const k of Object.keys(ratings)) allRubricIds.add(k)
    }

    for (const rubricId of allRubricIds) {
      // Collect each rater's verdict on this rubric for this topic.
      const verdicts: Array<{ a: boolean; b: boolean }> = []
      for (const anno of list) {
        const r =
          ((anno.payload.ratings ?? {}) as Record<
            string,
            { a?: unknown; b?: unknown }
          >)[rubricId]
        if (!r) continue
        if (typeof r.a !== 'boolean' || typeof r.b !== 'boolean') continue
        verdicts.push({ a: r.a, b: r.b })
      }
      if (verdicts.length < 2) continue

      const entry = perRubric.get(rubricId) ?? { multi: 0, disputed: 0 }
      entry.multi += 1

      // Disputed if ANY two raters disagreed on (a, b) — boolean diff.
      const allASame = verdicts.every((v) => v.a === verdicts[0].a)
      const allBSame = verdicts.every((v) => v.b === verdicts[0].b)
      if (!allASame || !allBSame) entry.disputed += 1
      perRubric.set(rubricId, entry)
    }
  }

  const out: PairRubricRow[] = []
  for (const [rubricId, e] of perRubric) {
    out.push({
      rubricId,
      multiRaterTopics: e.multi,
      disputedTopics: e.disputed,
      agreementRate: e.multi > 0 ? 1 - e.disputed / e.multi : null,
    })
  }
  // Sort by disputed-rate descending so the noisiest rubrics surface first.
  out.sort((a, b) => {
    const ra = a.agreementRate ?? 1
    const rb = b.agreementRate ?? 1
    return ra - rb
  })
  return out
}

/**
 * Per-dimension disagreement table for an arena-gsb workspace.
 *
 * Each dimension is a 1-5 score per model. We use the SAME tolerance the
 * trajectory rubric uses (spread > 1 ⇒ dispute) but apply it per (side)
 * separately — a dimension is "disputed" if either side's score spread
 * exceeds tolerance.
 */
export async function getArenaDimensionIAA(opts: {
  workspaceId: string
}): Promise<ArenaDimensionRow[]> {
  const byTopic = await loadSubmittedByTopic({
    workspaceId: opts.workspaceId,
    templateMode: 'arena-gsb',
  })

  const perDim = new Map<string, { multi: number; disputed: number }>()
  const TOLERANCE = 1

  for (const annos of byTopic.values()) {
    const uniqByUser = new Map<string, SubmittedAnno>()
    for (const a of annos) uniqByUser.set(a.userId, a)
    if (uniqByUser.size < 2) continue
    const list = Array.from(uniqByUser.values())

    const allDimIds = new Set<string>()
    for (const anno of list) {
      const dims = (anno.payload.dimensions ?? {}) as Record<string, unknown>
      for (const k of Object.keys(dims)) allDimIds.add(k)
    }

    for (const dimId of allDimIds) {
      const scoresA: number[] = []
      const scoresB: number[] = []
      for (const anno of list) {
        const d = ((anno.payload.dimensions ?? {}) as Record<
          string,
          { a?: unknown; b?: unknown }
        >)[dimId]
        if (!d) continue
        if (typeof d.a === 'number') scoresA.push(d.a)
        if (typeof d.b === 'number') scoresB.push(d.b)
      }
      if (scoresA.length < 2 || scoresB.length < 2) continue

      const entry = perDim.get(dimId) ?? { multi: 0, disputed: 0 }
      entry.multi += 1
      const spreadA = Math.max(...scoresA) - Math.min(...scoresA)
      const spreadB = Math.max(...scoresB) - Math.min(...scoresB)
      if (spreadA > TOLERANCE || spreadB > TOLERANCE) entry.disputed += 1
      perDim.set(dimId, entry)
    }
  }

  const out: ArenaDimensionRow[] = []
  for (const [dimId, e] of perDim) {
    out.push({
      dimensionId: dimId,
      multiRaterTopics: e.multi,
      disputedTopics: e.disputed,
      agreementRate: e.multi > 0 ? 1 - e.disputed / e.multi : null,
    })
  }
  out.sort((a, b) => {
    const ra = a.agreementRate ?? 1
    const rb = b.agreementRate ?? 1
    return ra - rb
  })
  return out
}

/**
 * Overall-verdict agreement for arena-gsb. Counts how often multiple
 * raters on the same topic agree on A_better / tie / B_better. Useful
 * as a sanity check — a workspace with very low overall agreement is
 * either capturing genuine subjectivity (good!) or has rater drift.
 */
export async function getArenaOverallVerdictIAA(opts: {
  workspaceId: string
}): Promise<ArenaOverallRow> {
  const byTopic = await loadSubmittedByTopic({
    workspaceId: opts.workspaceId,
    templateMode: 'arena-gsb',
  })

  let multi = 0
  let disputed = 0
  const byVerdict = { a_better: 0, tie: 0, b_better: 0 }

  for (const annos of byTopic.values()) {
    const uniqByUser = new Map<string, SubmittedAnno>()
    for (const a of annos) uniqByUser.set(a.userId, a)
    if (uniqByUser.size < 2) continue
    const list = Array.from(uniqByUser.values())

    const verdicts = list
      .map((a) => a.payload.overallVerdict)
      .filter(
        (v): v is 'a_better' | 'tie' | 'b_better' =>
          v === 'a_better' || v === 'tie' || v === 'b_better',
      )
    if (verdicts.length < 2) continue
    multi += 1
    const allSame = verdicts.every((v) => v === verdicts[0])
    if (!allSame) disputed += 1
    for (const v of verdicts) byVerdict[v] += 1
  }

  return {
    multiRaterTopics: multi,
    disputedTopics: disputed,
    byVerdict,
  }
}

/**
 * Combined summary for a workspace's quality dashboard. Returns the
 * subset of rows that fit the workspace's templateMode, so the page
 * doesn't have to special-case.
 */
export async function getPairOrArenaIAA(opts: {
  workspaceId: string
  templateMode: 'pair-rubric' | 'arena-gsb' | string
}): Promise<{
  mode: 'pair-rubric' | 'arena-gsb' | 'unsupported'
  pairRubric: PairRubricRow[]
  arenaDimensions: ArenaDimensionRow[]
  arenaOverall: ArenaOverallRow | null
}> {
  if (opts.templateMode === 'pair-rubric') {
    const pair = await getPairRubricIAA({ workspaceId: opts.workspaceId })
    return {
      mode: 'pair-rubric',
      pairRubric: pair,
      arenaDimensions: [],
      arenaOverall: null,
    }
  }
  if (opts.templateMode === 'arena-gsb') {
    const [dim, overall] = await Promise.all([
      getArenaDimensionIAA({ workspaceId: opts.workspaceId }),
      getArenaOverallVerdictIAA({ workspaceId: opts.workspaceId }),
    ])
    return {
      mode: 'arena-gsb',
      pairRubric: [],
      arenaDimensions: dim,
      arenaOverall: overall,
    }
  }
  return {
    mode: 'unsupported',
    pairRubric: [],
    arenaDimensions: [],
    arenaOverall: null,
  }
}

// Surface the GSB derivation so callers in the UI layer don't have to
// re-import from the template mode file directly.
export { dimensionGsb }
