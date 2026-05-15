import type { trajectorySteps } from '@/lib/db/schema'

/**
 * Pure-function feature extractor for trajectories.
 *
 * Reads a trajectory + its steps, returns a flat structured features
 * object suitable for storage in `trajectories.features` (jsonb).
 *
 * **Pure** — no DB, no LLM, no network. Same input → same output. Cheap
 * to call at capture time inside Vercel's after() window, or to backfill
 * over thousands of rows in a script.
 *
 * Schema-stable: readers (Quality dashboard, /analyze filters, LLM
 * batch-analyst) all parse this shape with `safeParse`. New fields are
 * ADDED here, never re-typed — old consumers see them as optional.
 */

export interface TrajectoryFeatures {
  /** Total steps in the trajectory. */
  stepCount: number
  /** Counts per step.kind. */
  stepKindHistogram: Record<string, number>
  /** Tool call counts keyed by toolName (only tool_call kinds contribute). */
  toolUsage: Record<string, number>
  /** Distinct tools called at least once. */
  uniqueTools: number
  /** True when any step.kind === 'error'. */
  hasErrors: boolean
  errorCount: number
  /**
   * Heuristic loop detection: true when ≥3 tool_call steps share the same
   * (toolName, stringified args) signature within a 10-step window. Catches
   * the common "agent web-searches the same thing 5 times" failure mode.
   */
  loopDetected: boolean
  /** First step createdAt → last step createdAt, ms. Null when can't compute. */
  durationMs: number | null
  /** chars in the trajectory's final_response (sum across all final_response steps). */
  finalResponseChars: number
  /** chars in any thinking steps, summed. */
  thinkingChars: number
  /** Distinct modelName values across steps (e.g. ['gpt-4', 'gpt-3.5']). */
  models: string[]
  /** True when this trajectory completed cleanly (last step is final_response, no errors). */
  completed: boolean
  /** Outcome bucket — one of 'completed' | 'errored' | 'incomplete'. */
  outcome: 'completed' | 'errored' | 'incomplete'
  /** Schema version of this features object — bump when adding non-additive fields. */
  v: 1
}

type StepRow = typeof trajectorySteps.$inferSelect

/**
 * Extract features from a trajectory's step set. Steps may arrive
 * unordered; we sort by sequence internally.
 */
export function extractFeatures(steps: readonly StepRow[]): TrajectoryFeatures {
  if (steps.length === 0) {
    return {
      stepCount: 0,
      stepKindHistogram: {},
      toolUsage: {},
      uniqueTools: 0,
      hasErrors: false,
      errorCount: 0,
      loopDetected: false,
      durationMs: null,
      finalResponseChars: 0,
      thinkingChars: 0,
      models: [],
      completed: false,
      outcome: 'incomplete',
      v: 1,
    }
  }
  const sorted = [...steps].sort((a, b) => a.sequence - b.sequence)

  // Step kind histogram + error count + final response chars + thinking
  const stepKindHistogram: Record<string, number> = {}
  let errorCount = 0
  let finalResponseChars = 0
  let thinkingChars = 0
  for (const s of sorted) {
    stepKindHistogram[s.kind] = (stepKindHistogram[s.kind] ?? 0) + 1
    if (s.kind === 'error') errorCount++
    const content = (s.content ?? {}) as Record<string, unknown>
    if (s.kind === 'final_response') {
      const text = typeof content.text === 'string' ? content.text : ''
      finalResponseChars += text.length
    }
    if (s.kind === 'thinking') {
      const text = typeof content.text === 'string' ? content.text : ''
      thinkingChars += text.length
    }
  }

  // Tool usage
  const toolUsage: Record<string, number> = {}
  for (const s of sorted) {
    if (s.kind !== 'tool_call' && s.kind !== 'sub_agent_call') continue
    const content = (s.content ?? {}) as Record<string, unknown>
    const name =
      typeof content.toolName === 'string'
        ? content.toolName
        : typeof content.name === 'string'
          ? content.name
          : 'unknown'
    toolUsage[name] = (toolUsage[name] ?? 0) + 1
  }
  const uniqueTools = Object.keys(toolUsage).length

  // Loop detection — sliding 10-step window over tool_call signatures.
  // Loop = same (toolName, JSON.stringify(args)) appears ≥3 times in window.
  let loopDetected = false
  const WINDOW = 10
  const LOOP_THRESHOLD = 3
  const sigs: string[] = []
  for (const s of sorted) {
    if (s.kind !== 'tool_call') {
      sigs.push('')
      continue
    }
    const content = (s.content ?? {}) as Record<string, unknown>
    const name = String(content.toolName ?? content.name ?? '')
    let argsStr = ''
    try {
      argsStr = JSON.stringify(content.args ?? content.arguments ?? null)
    } catch {
      argsStr = ''
    }
    sigs.push(`${name}::${argsStr}`)
  }
  outer: for (let i = 0; i + WINDOW <= sigs.length; i++) {
    const counts = new Map<string, number>()
    for (let j = i; j < i + WINDOW; j++) {
      const sig = sigs[j]
      if (!sig) continue
      const c = (counts.get(sig) ?? 0) + 1
      counts.set(sig, c)
      if (c >= LOOP_THRESHOLD) {
        loopDetected = true
        break outer
      }
    }
  }

  // Duration: first → last step.ts (the per-step timestamp column)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const durationMs =
    first.ts && last.ts
      ? Math.max(0, last.ts.getTime() - first.ts.getTime())
      : null

  // Models
  const modelSet = new Set<string>()
  for (const s of sorted) {
    if (s.modelName) modelSet.add(s.modelName)
  }
  const models = [...modelSet].sort()

  // Outcome
  const lastKind = sorted[sorted.length - 1]?.kind
  const completed = lastKind === 'final_response' && errorCount === 0
  const outcome: TrajectoryFeatures['outcome'] = completed
    ? 'completed'
    : errorCount > 0
      ? 'errored'
      : 'incomplete'

  return {
    stepCount: sorted.length,
    stepKindHistogram,
    toolUsage,
    uniqueTools,
    hasErrors: errorCount > 0,
    errorCount,
    loopDetected,
    durationMs,
    finalResponseChars,
    thinkingChars,
    models,
    completed,
    outcome,
    v: 1,
  }
}
