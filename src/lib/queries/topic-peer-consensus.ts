import 'server-only'
import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { annotations, tasks, topics } from '@/lib/db/schema'

/**
 * Per-topic peer consensus — used in review mode to show "what did the
 * OTHER raters say about this row".
 *
 * For pair-rubric: each (rubricId, side) reports majority booleans + the
 *   counts that produced it.
 * For arena-gsb: each (dimId, side) reports median score + the spread.
 *
 * Caller passes `excludeUserId` to skip the submitter's own row from
 * the aggregation — QC reviewing rater X wants to see X compared to
 * other raters, not X compared to themselves.
 *
 * Empty result is fine — UI hides the "peers" column when nothing came
 * back.
 */

export interface PairPeerCell {
  /** Majority value (true / false), or null when raters tied. */
  majority: boolean | null
  /** Counts of true / false votes from peers (excluding submitter). */
  trueVotes: number
  falseVotes: number
}

export interface ArenaPeerCell {
  /** Median of peers' scores. null when no peers rated. */
  median: number | null
  /** Spread (max - min) — drives the "highly disputed" highlight. */
  spread: number
  /** How many peer scores went into the median. */
  raters: number
}

export interface TopicPeerData {
  mode: 'pair-rubric' | 'arena-gsb' | 'unsupported'
  /** Total number of peer (excluding submitter) submitted annotations. */
  peerCount: number
  /** Per-rubric peer cells, keyed by `${rubricId}|${side}`. */
  pair: Record<string, PairPeerCell>
  /** Per-dim peer cells, keyed by `${dimId}|${side}`. */
  arena: Record<string, ArenaPeerCell>
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export async function getTopicPeerConsensus(opts: {
  topicId: string
  excludeUserId: string
}): Promise<TopicPeerData> {
  const db = getDb()
  // 1. Resolve task / templateMode from the topic.
  const [meta] = await db
    .select({
      taskId: tasks.id,
      templateMode: tasks.templateMode,
    })
    .from(topics)
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .where(eq(topics.id, opts.topicId))
    .limit(1)

  if (!meta) {
    return { mode: 'unsupported', peerCount: 0, pair: {}, arena: {} }
  }
  if (meta.templateMode !== 'pair-rubric' && meta.templateMode !== 'arena-gsb') {
    return { mode: 'unsupported', peerCount: 0, pair: {}, arena: {} }
  }

  // 2. Load all SUBMITTED annotations on this topic, EXCEPT the
  //    submitter under review.
  const rows = await db
    .select({
      payload: annotations.payload,
      userId: annotations.userId,
    })
    .from(annotations)
    .where(
      and(
        eq(annotations.topicId, opts.topicId),
        isNotNull(annotations.submittedAt),
        ne(annotations.userId, opts.excludeUserId),
      ),
    )

  if (rows.length === 0) {
    return {
      mode: meta.templateMode as 'pair-rubric' | 'arena-gsb',
      peerCount: 0,
      pair: {},
      arena: {},
    }
  }

  // 3. Aggregate per-rubric / per-dim.
  if (meta.templateMode === 'pair-rubric') {
    const counts = new Map<string, { t: number; f: number }>()
    for (const r of rows) {
      const ratings = ((r.payload ?? {}) as Record<string, unknown>)
        .ratings as
        | Record<string, { a?: unknown; b?: unknown }>
        | undefined
      if (!ratings) continue
      for (const [rid, v] of Object.entries(ratings)) {
        if (typeof v.a === 'boolean') {
          const key = `${rid}|a`
          const c = counts.get(key) ?? { t: 0, f: 0 }
          if (v.a) c.t++
          else c.f++
          counts.set(key, c)
        }
        if (typeof v.b === 'boolean') {
          const key = `${rid}|b`
          const c = counts.get(key) ?? { t: 0, f: 0 }
          if (v.b) c.t++
          else c.f++
          counts.set(key, c)
        }
      }
    }
    const pair: Record<string, PairPeerCell> = {}
    for (const [key, c] of counts) {
      pair[key] = {
        majority: c.t === c.f ? null : c.t > c.f,
        trueVotes: c.t,
        falseVotes: c.f,
      }
    }
    return {
      mode: 'pair-rubric',
      peerCount: rows.length,
      pair,
      arena: {},
    }
  }

  // arena-gsb
  const scores = new Map<string, number[]>()
  for (const r of rows) {
    const dims = ((r.payload ?? {}) as Record<string, unknown>)
      .dimensions as Record<string, { a?: unknown; b?: unknown }> | undefined
    if (!dims) continue
    for (const [did, v] of Object.entries(dims)) {
      if (typeof v.a === 'number') {
        const key = `${did}|a`
        const arr = scores.get(key) ?? []
        arr.push(v.a)
        scores.set(key, arr)
      }
      if (typeof v.b === 'number') {
        const key = `${did}|b`
        const arr = scores.get(key) ?? []
        arr.push(v.b)
        scores.set(key, arr)
      }
    }
  }
  const arena: Record<string, ArenaPeerCell> = {}
  for (const [key, arr] of scores) {
    arena[key] = {
      median: arr.length === 0 ? null : median(arr),
      spread: arr.length === 0 ? 0 : Math.max(...arr) - Math.min(...arr),
      raters: arr.length,
    }
  }
  return {
    mode: 'arena-gsb',
    peerCount: rows.length,
    pair: {},
    arena,
  }
}
