/**
 * Judge ↔ human agreement math — pure functions.
 *
 * Compare two annotation payloads on the SAME topic (one from a human
 * rater, one from an LLM judge) and produce:
 *   - overall agreement in 0..1
 *   - per-rubric breakdown: { [rubricId]: 0..1 }
 *
 * Pure / no side effects: makes this trivial to unit-test and lets us
 * reuse the diff for "judge vs judge" comparisons without coupling to
 * a specific human row.
 *
 * Tolerance rules:
 *   pair-rubric (booleans): exact match on each (item, side). The
 *       per-item score is the average of A-agreement and B-agreement.
 *   arena-gsb (1-5 scores): within ±1 = agree (same tolerance the
 *       existing IAA / calibration math uses). Plus the overall
 *       verdict counts as one extra "item" that must match exactly.
 */

import type { PairChecklistItem } from '@/lib/templates/types'

export interface AgreementResult {
  /** Mean agreement across every item (and overallVerdict for arena). */
  overall: number
  /** Per-rubric-id agreement in 0..1. */
  perRubric: Record<string, number>
}

// ─── Pair-rubric ─────────────────────────────────────────────────────

interface PairPayload {
  ratings?: Record<string, { a?: boolean; b?: boolean }>
}

export function comparePairRubric(
  judge: PairPayload,
  human: PairPayload,
  rubric: readonly PairChecklistItem[],
): AgreementResult {
  const perRubric: Record<string, number> = {}
  let total = 0
  let sum = 0
  for (const item of rubric) {
    const j = judge.ratings?.[item.id]
    const h = human.ratings?.[item.id]
    if (!j || !h) {
      // Missing either side → can't measure on this item; skip.
      continue
    }
    let itemScore = 0
    let itemTotal = 0
    if (typeof j.a === 'boolean' && typeof h.a === 'boolean') {
      itemScore += j.a === h.a ? 1 : 0
      itemTotal += 1
    }
    if (typeof j.b === 'boolean' && typeof h.b === 'boolean') {
      itemScore += j.b === h.b ? 1 : 0
      itemTotal += 1
    }
    if (itemTotal > 0) {
      const itemRate = itemScore / itemTotal
      perRubric[item.id] = itemRate
      sum += itemRate
      total += 1
    }
  }
  return {
    overall: total === 0 ? 0 : sum / total,
    perRubric,
  }
}

// ─── Arena-GSB ───────────────────────────────────────────────────────

interface ArenaPayload {
  dimensions?: Record<string, { a?: number; b?: number }>
  overallVerdict?: 'a_better' | 'tie' | 'b_better'
}

/** Within-1 tolerance — matches the IAA dispute threshold. */
const ARENA_TOLERANCE = 1

export function compareArenaGsb(
  judge: ArenaPayload,
  human: ArenaPayload,
  rubric: readonly PairChecklistItem[],
): AgreementResult {
  const perRubric: Record<string, number> = {}
  let total = 0
  let sum = 0
  for (const dim of rubric) {
    const j = judge.dimensions?.[dim.id]
    const h = human.dimensions?.[dim.id]
    if (!j || !h) continue
    let agree = 0
    let count = 0
    if (typeof j.a === 'number' && typeof h.a === 'number') {
      agree += Math.abs(j.a - h.a) <= ARENA_TOLERANCE ? 1 : 0
      count += 1
    }
    if (typeof j.b === 'number' && typeof h.b === 'number') {
      agree += Math.abs(j.b - h.b) <= ARENA_TOLERANCE ? 1 : 0
      count += 1
    }
    if (count > 0) {
      const rate = agree / count
      perRubric[dim.id] = rate
      sum += rate
      total += 1
    }
  }
  // Add the overall verdict as a synthetic "item" so the judge gets
  // graded on it too. Stored under a reserved key __overall_verdict
  // so it doesn't collide with any user-defined dim id (snake_case,
  // ids can't start with double-underscore in our regex).
  if (judge.overallVerdict && human.overallVerdict) {
    const match = judge.overallVerdict === human.overallVerdict ? 1 : 0
    perRubric.__overall_verdict = match
    sum += match
    total += 1
  }
  return {
    overall: total === 0 ? 0 : sum / total,
    perRubric,
  }
}

// ─── Dispatcher ──────────────────────────────────────────────────────

/**
 * Mode-aware entry point. The caller knows which mode the topic is in
 * (workspace's templateMode) and which rubric to use; we just pick the
 * right comparison function.
 */
export function compareAnnotations(
  mode: 'pair-rubric' | 'arena-gsb',
  judge: unknown,
  human: unknown,
  rubric: readonly PairChecklistItem[],
): AgreementResult {
  if (mode === 'pair-rubric') {
    return comparePairRubric(
      (judge ?? {}) as PairPayload,
      (human ?? {}) as PairPayload,
      rubric,
    )
  }
  return compareArenaGsb(
    (judge ?? {}) as ArenaPayload,
    (human ?? {}) as ArenaPayload,
    rubric,
  )
}
