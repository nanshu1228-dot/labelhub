/**
 * Phase-18 demo dressing: ensure the demo workspace has at least
 * a handful of annotations carrying `claude_proposal` so the
 * Teaching-Signal Dataset stat on the landing isn't 0 and the
 * `?format=teaching` export returns rows.
 *
 * Strategy: for each approved annotation in the demo workspace whose
 * `claude_proposal` is NULL, fabricate a *plausible* AI proposal by
 * lightly perturbing the human's accepted payload — flip ~30% of
 * boolean rubric marks, nudge ~20% of arena dimensions by ±1. The
 * "delta_summary" we write describes the difference.
 *
 * This is intentionally synthetic — the demo never had the AI
 * draft-reviewer running on its seeded raters. For a real workspace
 * the claude_proposal flows in naturally from src/lib/ai/judge.ts.
 *
 * Run: npx tsx scripts/debug/seed-teaching-signals.ts
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import postgres from 'postgres'

const DEMO_WORKSPACE_ID = '00000000-0000-0000-0000-000000000010'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error('DATABASE_URL not set')
  process.exit(1)
}

function rng(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

interface PairPayload {
  ratings?: Record<string, { a?: boolean; b?: boolean }>
}
interface ArenaPayload {
  dimensions?: Record<string, { a?: number; b?: number }>
}

function perturbPair(
  payload: PairPayload,
  rand: () => number,
): { proposal: PairPayload; flips: number } {
  const proposal: PairPayload = { ratings: {} }
  let flips = 0
  for (const [k, v] of Object.entries(payload.ratings ?? {})) {
    const cell: { a?: boolean; b?: boolean } = {}
    if (typeof v.a === 'boolean') {
      const flip = rand() < 0.3
      cell.a = flip ? !v.a : v.a
      if (flip) flips++
    }
    if (typeof v.b === 'boolean') {
      const flip = rand() < 0.3
      cell.b = flip ? !v.b : v.b
      if (flip) flips++
    }
    proposal.ratings![k] = cell
  }
  return { proposal, flips }
}

function perturbArena(
  payload: ArenaPayload,
  rand: () => number,
): { proposal: ArenaPayload; nudges: number } {
  const proposal: ArenaPayload = { dimensions: {} }
  let nudges = 0
  for (const [k, v] of Object.entries(payload.dimensions ?? {})) {
    const cell: { a?: number; b?: number } = {}
    if (typeof v.a === 'number') {
      const nudge = rand() < 0.2 ? (rand() < 0.5 ? -1 : 1) : 0
      cell.a = Math.max(1, Math.min(5, v.a + nudge))
      if (nudge !== 0) nudges++
    }
    if (typeof v.b === 'number') {
      const nudge = rand() < 0.2 ? (rand() < 0.5 ? -1 : 1) : 0
      cell.b = Math.max(1, Math.min(5, v.b + nudge))
      if (nudge !== 0) nudges++
    }
    proposal.dimensions![k] = cell
  }
  return { proposal, nudges }
}

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 1, prepare: false })
  const rand = rng(20260518)
  try {
    type Row = {
      id: string
      payload: PairPayload | ArenaPayload
      template_mode: string
    }
    const rows: Row[] = await sql<Row[]>`
      SELECT a.id, a.payload, t.template_mode
      FROM annotations a
      INNER JOIN topics tp ON tp.id = a.topic_id
      INNER JOIN tasks t ON t.id = tp.task_id
      WHERE t.workspace_id = ${DEMO_WORKSPACE_ID}
        AND a.submitted_at IS NOT NULL
        AND a.claude_proposal IS NULL
    `
    // eslint-disable-next-line no-console
    console.log(
      `[seed-teaching] found ${rows.length} annotations without claude_proposal`,
    )

    let updated = 0
    for (const r of rows) {
      let proposal: unknown
      let summary: string
      let payloadOverride: unknown | null = null
      if (r.template_mode === 'pair-rubric') {
        const result = perturbPair(r.payload as PairPayload, rand)
        proposal = result.proposal
        summary = result.flips
          ? `Human disagreed on ${result.flips} boolean cell${result.flips === 1 ? '' : 's'}.`
          : 'Human accepted the AI proposal verbatim.'
      } else if (r.template_mode === 'arena-gsb') {
        const result = perturbArena(r.payload as ArenaPayload, rand)
        proposal = result.proposal
        summary = result.nudges
          ? `Human adjusted ${result.nudges} dimension score${result.nudges === 1 ? '' : 's'} by 1 point.`
          : 'Human accepted the AI scoring verbatim.'
      } else if (r.template_mode === 'agent-trace-eval') {
        // Trajectory marks live in step_annotations, not annotations.
        // Pull this rater's step marks for this trajectory and build
        // a {stepId, rating} list as the "human correction". Then
        // synthesize an AI proposal by nudging some ratings.
        type StepRow = {
          step_id: string
          kind: string
          rating: number | null
        }
        const steps: StepRow[] = await sql<StepRow[]>`
          SELECT trajectory_step_id AS step_id, kind, rating
          FROM step_annotations
          WHERE annotation_id = ${r.id}
        `
        if (steps.length === 0) continue
        const humanMarks = steps.map((s) => ({
          stepId: s.step_id,
          kind: s.kind,
          rating: s.rating,
        }))
        let nudges = 0
        const aiMarks = humanMarks.map((m) => {
          if (m.rating == null || rand() >= 0.3) return m
          const direction = rand() < 0.5 ? -1 : 1
          const next = Math.max(1, Math.min(5, m.rating + direction))
          if (next !== m.rating) nudges++
          return { ...m, rating: next }
        })
        proposal = { stepMarks: aiMarks }
        payloadOverride = { stepMarks: humanMarks }
        summary = nudges
          ? `Human overrode ${nudges} of ${humanMarks.length} step rating${nudges === 1 ? '' : 's'}.`
          : 'Human kept every AI step rating.'
      } else {
        continue
      }

      if (payloadOverride !== null) {
        await sql`
          UPDATE annotations
          SET claude_proposal = ${sql.json(proposal as never)},
              delta_summary = ${summary},
              payload = ${sql.json(payloadOverride as never)}
          WHERE id = ${r.id}
        `
      } else {
        await sql`
          UPDATE annotations
          SET claude_proposal = ${sql.json(proposal as never)},
              delta_summary = ${summary}
          WHERE id = ${r.id}
        `
      }
      updated++
    }

    // eslint-disable-next-line no-console
    console.log(`[seed-teaching] ✓ updated ${updated} annotations`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[seed-teaching] failed:', e)
  process.exit(1)
})
