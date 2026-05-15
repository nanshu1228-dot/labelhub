import 'server-only'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { trajectories } from '@/lib/db/schema'
import type { TrajectoryFeatures } from '@/lib/trajectories/extract-features'

/**
 * Query helpers for the /analyze page.
 *
 * Everything here operates on the pre-computed `features` jsonb column —
 * no LLM, no per-step joins. The shape is:
 *
 *   1. parseFilter(query string) → AnalyzeFilter
 *   2. listTrajectoriesByFilter(filter) → rows (id + agentName + features)
 *   3. computeAggregates(rows) → {byOutcome, byTool, byAgent, ...}
 *   4. (caller decides: send sample summaries to the LLM)
 *
 * Filter language is a tiny DSL — comma-separated `key:value` pairs:
 *
 *   outcome:errored             → features.outcome === 'errored'
 *   outcome:completed,loop:true → AND-ed
 *   tool:web_search             → toolUsage[web_search] >= 1
 *   tool>web_search:5           → toolUsage[web_search] >= 5
 *   steps>40                    → features.stepCount > 40
 *   agent:research              → agentName ILIKE %research%
 *
 * Unknown keys ignored. Garbage values clamp to "no filter".
 */

export type AnalyzeOutcome = 'completed' | 'errored' | 'incomplete'

export interface AnalyzeFilter {
  outcome?: AnalyzeOutcome
  loopDetected?: boolean
  agentNameLike?: string
  /** `{name: minCount}` — trajectory must have called this tool at least minCount times. */
  toolMinCount?: Record<string, number>
  /** features.stepCount > N */
  stepCountAbove?: number
  /** features.stepCount < N */
  stepCountBelow?: number
}

/**
 * Parse the free-text query string from the filter bar. Tolerant of
 * whitespace + casing; never throws.
 */
export function parseFilter(input: string): AnalyzeFilter {
  const out: AnalyzeFilter = {}
  if (!input) return out
  const tokens = input
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  for (const tok of tokens) {
    // `key>value` form (numeric greater-than)
    const gtMatch = tok.match(/^([a-zA-Z_]+)>(.+)$/)
    if (gtMatch) {
      const [, key, val] = gtMatch
      if (key === 'steps') {
        const n = Number(val)
        if (!isNaN(n)) out.stepCountAbove = n
      } else if (key === 'tool') {
        // `tool>name:count`
        const sub = val.match(/^([a-zA-Z_0-9-]+):(\d+)$/)
        if (sub) {
          out.toolMinCount = out.toolMinCount ?? {}
          out.toolMinCount[sub[1]] = Number(sub[2])
        }
      }
      continue
    }
    const ltMatch = tok.match(/^([a-zA-Z_]+)<(.+)$/)
    if (ltMatch) {
      const [, key, val] = ltMatch
      if (key === 'steps') {
        const n = Number(val)
        if (!isNaN(n)) out.stepCountBelow = n
      }
      continue
    }
    const eqMatch = tok.match(/^([a-zA-Z_]+):(.+)$/)
    if (!eqMatch) continue
    const [, key, val] = eqMatch
    const lowerVal = val.toLowerCase()
    switch (key) {
      case 'outcome':
        if (
          lowerVal === 'completed' ||
          lowerVal === 'errored' ||
          lowerVal === 'incomplete'
        ) {
          out.outcome = lowerVal
        }
        break
      case 'loop':
        out.loopDetected = lowerVal === 'true' || lowerVal === '1'
        break
      case 'agent':
        out.agentNameLike = val
        break
      case 'tool': {
        // `tool:name` — at least 1 usage
        out.toolMinCount = out.toolMinCount ?? {}
        out.toolMinCount[val] = Math.max(out.toolMinCount[val] ?? 0, 1)
        break
      }
    }
  }
  return out
}

/**
 * Stringify a filter back into the DSL — used for shareable URLs.
 */
export function stringifyFilter(filter: AnalyzeFilter): string {
  const parts: string[] = []
  if (filter.outcome) parts.push(`outcome:${filter.outcome}`)
  if (filter.loopDetected) parts.push(`loop:true`)
  if (filter.agentNameLike) parts.push(`agent:${filter.agentNameLike}`)
  if (filter.stepCountAbove != null)
    parts.push(`steps>${filter.stepCountAbove}`)
  if (filter.stepCountBelow != null)
    parts.push(`steps<${filter.stepCountBelow}`)
  if (filter.toolMinCount) {
    for (const [name, count] of Object.entries(filter.toolMinCount)) {
      parts.push(count === 1 ? `tool:${name}` : `tool>${name}:${count}`)
    }
  }
  return parts.join(' ')
}

// ─── Row read ─────────────────────────────────────────────────────────────

export interface AnalyzeRow {
  id: string
  agentName: string
  createdAt: Date
  features: TrajectoryFeatures | null
  summary: string | null
  summaryPattern: string | null
}

export async function listTrajectoriesByFilter(opts: {
  workspaceId: string
  filter: AnalyzeFilter
  /** Cap on rows returned. Aggregates use up to 500; LLM samples uses 3-5. */
  limit?: number
}): Promise<AnalyzeRow[]> {
  const db = getDb()
  const limit = Math.min(opts.limit ?? 200, 500)

  // Base condition: workspace + not deleted.
  const conditions = [
    eq(trajectories.workspaceId, opts.workspaceId),
    isNull(trajectories.deletedAt),
  ]

  // Jsonb path conditions — Drizzle's sql template builder.
  if (opts.filter.outcome) {
    conditions.push(
      sql`(${trajectories.features}->>'outcome') = ${opts.filter.outcome}`,
    )
  }
  if (opts.filter.loopDetected) {
    conditions.push(
      sql`(${trajectories.features}->>'loopDetected')::boolean = true`,
    )
  }
  if (opts.filter.agentNameLike) {
    conditions.push(
      sql`${trajectories.agentName} ilike ${'%' + opts.filter.agentNameLike + '%'}`,
    )
  }
  if (opts.filter.stepCountAbove != null) {
    conditions.push(
      sql`((${trajectories.features}->>'stepCount')::int) > ${opts.filter.stepCountAbove}`,
    )
  }
  if (opts.filter.stepCountBelow != null) {
    conditions.push(
      sql`((${trajectories.features}->>'stepCount')::int) < ${opts.filter.stepCountBelow}`,
    )
  }
  if (opts.filter.toolMinCount) {
    for (const [name, count] of Object.entries(opts.filter.toolMinCount)) {
      conditions.push(
        sql`coalesce((${trajectories.features}->'toolUsage'->>${name})::int, 0) >= ${count}`,
      )
    }
  }

  const rows = await db
    .select({
      id: trajectories.id,
      agentName: trajectories.agentName,
      createdAt: trajectories.createdAt,
      features: trajectories.features,
      summary: trajectories.summary,
    })
    .from(trajectories)
    .where(and(...conditions))
    .orderBy(sql`${trajectories.createdAt} desc`)
    .limit(limit)

  return rows.map((r) => {
    let summaryParagraph: string | null = null
    let pattern: string | null = null
    if (r.summary) {
      if (r.summary.startsWith('{')) {
        try {
          const p = JSON.parse(r.summary)
          summaryParagraph = typeof p.summary === 'string' ? p.summary : null
          pattern = typeof p.pattern === 'string' ? p.pattern : null
        } catch {
          summaryParagraph = r.summary
        }
      } else {
        summaryParagraph = r.summary
      }
    }
    return {
      id: r.id,
      agentName: r.agentName,
      createdAt: r.createdAt,
      features: r.features as TrajectoryFeatures | null,
      summary: summaryParagraph,
      summaryPattern: pattern,
    }
  })
}

// ─── Aggregates over a filtered set ──────────────────────────────────────

export interface AnalyzeAggregates {
  total: number
  byOutcome: Record<AnalyzeOutcome, number>
  byAgent: Array<{ agentName: string; count: number }>
  byPattern: Record<string, number>
  toolFrequency: Array<{ tool: string; count: number; trajectoriesUsing: number }>
  stepCount: {
    min: number
    max: number
    median: number
    mean: number
  } | null
  loopRate: number // 0..1
  errorRate: number // 0..1
}

export function computeAggregates(rows: AnalyzeRow[]): AnalyzeAggregates {
  const total = rows.length
  const byOutcome: Record<AnalyzeOutcome, number> = {
    completed: 0,
    errored: 0,
    incomplete: 0,
  }
  const byAgentMap = new Map<string, number>()
  const byPattern: Record<string, number> = {}
  const toolCounts = new Map<string, { count: number; usingSet: Set<string> }>()
  const stepCounts: number[] = []
  let loops = 0
  let errors = 0

  for (const r of rows) {
    const f = r.features
    if (!f) continue
    const outcome = (f.outcome ?? 'incomplete') as AnalyzeOutcome
    byOutcome[outcome]++
    byAgentMap.set(r.agentName, (byAgentMap.get(r.agentName) ?? 0) + 1)
    if (r.summaryPattern) {
      byPattern[r.summaryPattern] = (byPattern[r.summaryPattern] ?? 0) + 1
    }
    if (typeof f.stepCount === 'number') stepCounts.push(f.stepCount)
    if (f.loopDetected) loops++
    if (f.hasErrors) errors++
    if (f.toolUsage) {
      for (const [name, c] of Object.entries(f.toolUsage)) {
        const slot = toolCounts.get(name) ?? {
          count: 0,
          usingSet: new Set<string>(),
        }
        slot.count += c
        slot.usingSet.add(r.id)
        toolCounts.set(name, slot)
      }
    }
  }

  const byAgent = [...byAgentMap.entries()]
    .map(([agentName, count]) => ({ agentName, count }))
    .sort((a, b) => b.count - a.count)

  const toolFrequency = [...toolCounts.entries()]
    .map(([tool, slot]) => ({
      tool,
      count: slot.count,
      trajectoriesUsing: slot.usingSet.size,
    }))
    .sort((a, b) => b.count - a.count)

  let stepStats: AnalyzeAggregates['stepCount'] = null
  if (stepCounts.length > 0) {
    const sorted = [...stepCounts].sort((a, b) => a - b)
    const sum = sorted.reduce((a, b) => a + b, 0)
    stepStats = {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      median:
        sorted.length % 2 === 0
          ? Math.round(
              (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
            )
          : sorted[Math.floor(sorted.length / 2)],
      mean: Math.round(sum / sorted.length),
    }
  }

  return {
    total,
    byOutcome,
    byAgent,
    byPattern,
    toolFrequency,
    stepCount: stepStats,
    loopRate: total > 0 ? loops / total : 0,
    errorRate: total > 0 ? errors / total : 0,
  }
}
