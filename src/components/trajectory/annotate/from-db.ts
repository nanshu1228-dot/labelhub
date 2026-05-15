/**
 * Adapter — converts the SSR loader's row shapes (Drizzle $inferSelect from
 * `trajectories` + `trajectory_steps`) into the client-side view types
 * (TrajectoryView, StepView).
 *
 * Why an adapter exists:
 *   1. The DB row has `content: jsonb` with kind-discriminated payloads.
 *      The client wants typed fields (`body`, `args`, `output`, `toolName`).
 *      Casting this once at the boundary keeps every downstream component
 *      from doing `(s.content as any).body`.
 *   2. The DB exposes timestamps and FK ids that should not flow to the
 *      client; the view types strip them.
 *   3. The shell uses these types in unit tests / Storybook, so they must
 *      be free of Drizzle/SQL imports.
 *
 * If the canonical event schema changes (new kind, new content shape), this
 * is the one file that updates — the React tree stays still.
 */

import type { trajectories, trajectorySteps } from '@/lib/db/schema'
import type {
  AttachmentRef,
  PeerMark,
  PeerMarksByStep,
  StepMarksByStep,
  StepView,
  TrajectoryView,
  ClaudeHint,
  ClaudeHintsByStep,
  Mark,
} from './types'
import type { StepIAA } from '@/lib/queries/iaa'

type TrajectoryRow = typeof trajectories.$inferSelect
type StepRow = typeof trajectorySteps.$inferSelect
type ToolProvider = { id: string; name: string; kind: string }

export function trajectoryViewFromDb(
  trajectory: TrajectoryRow,
  steps: readonly StepRow[],
  providersById: ReadonlyMap<string, ToolProvider>,
): TrajectoryView {
  const meta = (trajectory.meta ?? {}) as Record<string, unknown>
  const systemPrompt =
    typeof meta.systemPrompt === 'string' ? meta.systemPrompt : null
  const attachments = Array.isArray(meta.attachments)
    ? (meta.attachments as AttachmentRef[])
    : []

  return {
    id: trajectory.id,
    agentName: trajectory.agentName,
    modelName:
      typeof meta.modelName === 'string' ? meta.modelName : null,
    rootPrompt: trajectory.rootPrompt,
    systemPrompt,
    finalResponse: trajectory.finalResponse,
    steps: steps.map((s) => stepViewFromDb(s, providersById)),
    attachments,
  }
}

function stepViewFromDb(
  s: StepRow,
  providersById: ReadonlyMap<string, ToolProvider>,
): StepView {
  const c = (s.content ?? {}) as Record<string, unknown>
  const provider = s.toolProviderId
    ? providersById.get(s.toolProviderId) ?? null
    : null
  const providerView = provider
    ? { name: provider.name, kind: provider.kind }
    : null

  const base = {
    id: s.id,
    sequence: s.sequence,
    latencyMs: s.latencyMs,
    tokensIn: s.tokensIn,
    tokensOut: s.tokensOut,
    modelName: s.modelName,
  } as const

  switch (s.kind) {
    case 'tool_call':
    case 'sub_agent_call':
      return {
        ...base,
        kind: s.kind,
        toolName:
          typeof c.toolName === 'string'
            ? c.toolName
            : typeof c.name === 'string'
              ? c.name
              : 'unknown_tool',
        args: c.args ?? c.input ?? {},
        toolCallId: s.toolCallId,
        toolProvider: providerView,
      }
    case 'tool_result':
      return {
        ...base,
        kind: 'tool_result',
        toolName:
          typeof c.toolName === 'string'
            ? c.toolName
            : typeof c.name === 'string'
              ? c.name
              : 'unknown_tool',
        output: c.output ?? c.result ?? c.content ?? {},
        toolCallId: s.toolCallId,
        toolProvider: providerView,
      }
    case 'thinking':
    case 'sub_agent_response':
    case 'final_response':
    case 'error':
      return {
        ...base,
        kind: s.kind,
        body:
          typeof c.body === 'string'
            ? c.body
            : typeof c.text === 'string'
              ? c.text
              : typeof c.message === 'string'
                ? c.message
                : safeStringify(c),
      }
    default:
      // Unknown kind — degrade to a "thinking"-shaped view rather than crash.
      // We still show the row in the timeline so the annotator can see it
      // and we can patch the renderer afterwards.
      return {
        ...base,
        kind: 'thinking',
        body: safeStringify(c),
      }
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

// ─── Marks ──────────────────────────────────────────────────────────────────

/**
 * Convert SSR-fetched `myMarks` (the user's own step_annotations rows, keyed
 * by stepId) into the nested {stepId → {rubricId → Mark}} shape the UI uses.
 *
 * Storage shape (current schema, see `stepAnnotations` in db/schema.ts):
 *   - one row per (step, kind, userId)
 *   - `kind` IS the rubric id (e.g. 'tool_choice', 'safety')
 *   - `rating` int holds likert values
 *   - `reasoning` text holds the reason
 *   - `payload` jsonb is reserved for non-likert payloads (bool / enum /
 *     text) — added in Step 3 when the schema gets a proper `payload` column
 *
 * For Step 2 we round-trip likert marks only. Non-likert marks are stored on
 * the in-memory Mark store and persisted via a new `payload` column added
 * in Step 3 — see actions/step-marks.ts (forthcoming).
 *
 * NOTE: the SSR loader currently produces `Record<stepId, oneRow>` because
 * listMyStepMarksInline() flattens to a single row per step. The future
 * format will be `Record<stepId, oneRow[]>` (one per rubric). The adapter
 * tolerates both — single-row input is treated as "the legacy `step_quality`
 * rubric" and surfaced under rubric id `step_quality` so old data stays
 * visible.
 */
export function stepMarksFromDb<
  Row extends {
    trajectoryStepId: string
    kind: string
    rating: number | null
    reasoning: string | null
    payload?: unknown
  },
>(
  rows: Readonly<Record<string, Row | Row[]>>,
): StepMarksByStep {
  const out: Record<string, Record<string, Mark>> = {}
  for (const [stepId, value] of Object.entries(rows)) {
    const list = Array.isArray(value) ? value : [value]
    const stepMarks: Record<string, Mark> = {}
    for (const row of list) {
      const mark = rowToMark(row)
      if (mark) stepMarks[row.kind] = mark
    }
    out[stepId] = stepMarks
  }
  return out
}

function rowToMark(row: {
  rating: number | null
  reasoning: string | null
  payload?: unknown
}): Mark | null {
  // Future: `payload` jsonb may hold the full discriminated Mark for
  // bool / enum / text. Detect & return it as-is when it looks like one.
  if (row.payload && typeof row.payload === 'object') {
    const obj = row.payload as Record<string, unknown>
    if (
      'scale' in obj &&
      (obj.scale === 'likert' ||
        obj.scale === 'bool' ||
        obj.scale === 'enum' ||
        obj.scale === 'text')
    ) {
      return obj as Mark
    }
  }
  // Fall back to legacy {rating, reasoning} likert shape.
  if (row.rating === 1 || row.rating === 3 || row.rating === 5) {
    return {
      scale: 'likert',
      value: row.rating,
      reason: row.reasoning ?? undefined,
    }
  }
  return null
}

/**
 * Convert IAA results (`StepIAA[]`) into per-rubric peer-mark groups.
 *
 * Current StepIAA shape (see lib/queries/iaa.ts):
 *   - one StepIAA per step
 *   - `raters: { userId, displayName, rating, reasoning, kind }[]`
 *   - `kind` is the rubric id; `rating` is the likert value (null for non-
 *     likert kinds until the schema extension lands in Step 3)
 *
 * We filter out the current user (so peer dots don't render the user's own
 * mark on top of their own input) and assign each rater a stable color +
 * initials derived from displayName when available, falling back to userId
 * if the join didn't pick up a name.
 */
const PALETTE = [
  'oklch(0.5 0.13 150)', // success
  'oklch(0.7 0.13 80)', // warn
  'oklch(0.6 0.18 280)', // accent
  'oklch(0.6 0.2 25)', // danger
  'oklch(0.55 0.12 220)', // teal
]

export function peerMarksFromIaa(
  iaa: readonly StepIAA[],
  myUserId: string | null,
): PeerMarksByStep {
  const out: Record<string, Record<string, PeerMark[]>> = {}
  for (const s of iaa) {
    const stepBucket: Record<string, PeerMark[]> = out[s.trajectoryStepId] ?? {}
    for (const r of s.raters) {
      if (r.userId === myUserId) continue
      // Only surface peer marks that have a value — null ratings on
      // bool/enum/text marks (pre-schema extension) are skipped.
      if (r.rating == null) continue
      const color = PALETTE[hashStr(r.userId) % PALETTE.length]
      const initials = initialsFromDisplay(r.displayName, r.userId)
      const rubricId = r.kind
      const rubricBucket = stepBucket[rubricId] ?? []
      rubricBucket.push({
        peerId: r.userId,
        peerInitials: initials,
        color,
        rubricId,
        value: r.rating,
      })
      stepBucket[rubricId] = rubricBucket
    }
    out[s.trajectoryStepId] = stepBucket
  }
  return out
}

function initialsFromDisplay(
  displayName: string | null,
  userId: string,
): string {
  if (displayName) {
    const parts = displayName.trim().split(/\s+/)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    return parts[0].slice(0, 2).toUpperCase()
  }
  return initialsFromId(userId)
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function initialsFromId(id: string): string {
  // Take the first 2 alphanumeric chars uppercased — gives a stable, anonymous
  // identifier for raters until we wire real names through.
  const clean = id.replace(/[^A-Za-z0-9]/g, '')
  return (clean.slice(0, 2) || '??').toUpperCase()
}

// ─── Claude hints ───────────────────────────────────────────────────────────

/**
 * Group a flat array of Claude hints by step ID. The trajectory-reviewer
 * server module emits `{ stepId, rubricId, value, reason }[]`; the UI wants
 * `{ stepId → hints[] }`.
 */
export function claudeHintsByStepFromList(
  hints: ReadonlyArray<{
    stepId: string
    rubricId: string
    value: number | string | boolean
    reason: string
  }>,
): ClaudeHintsByStep {
  const out: Record<string, ClaudeHint[]> = {}
  for (const h of hints) {
    const bucket = out[h.stepId] ?? []
    bucket.push({ rubricId: h.rubricId, value: h.value, reason: h.reason })
    out[h.stepId] = bucket
  }
  return out
}
