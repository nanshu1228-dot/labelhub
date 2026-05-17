'use server'

/**
 * Dawid-Skene EM truth-inference — admin trigger.
 *
 * Phase-11. The pair-rubric and arena-gsb modes already produce per-cell
 * votes (rubric × side, or dimension × side); when raters disagree we
 * fall back to majority/median which is fragile. This action runs the
 * DS EM algorithm to jointly estimate (latent truth, per-rater
 * confusion matrix) and persists the result so the UI can read it
 * cheaply.
 *
 * Flow:
 *   1. Admin auth + workspace mode check (pair-rubric / arena-gsb).
 *   2. Load all submitted annotations in the workspace.
 *   3. Bucket votes into DS cells (one cell per (topicId, rubric|dim, side)).
 *   4. Run EM (pure function in lib/quality/dawid-skene.ts).
 *   5. Persist run + inferred labels + per-rater confusion matrices.
 *   6. Emit ds.run_completed event for the audit log.
 *   7. Return run id so the UI can fetch + render.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  dsConsensusRuns,
  dsInferredLabels,
  dsRaterConfusion,
  events,
  tasks,
  topics,
  workspaces,
} from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { uuidLike } from '@/lib/validators/uuid'
import { NotFoundError, ValidationError } from '@/lib/errors'
import {
  runDawidSkene,
  type DSCell,
  type DSResult,
} from '@/lib/quality/dawid-skene'

const runSchema = z.object({
  workspaceId: uuidLike,
})

/**
 * Class numbering:
 *   pair-rubric → K=2, class 0 = false, class 1 = true
 *   arena-gsb   → K=5, class 0 = score 1, class 4 = score 5
 */
function clampScore(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  const rounded = Math.round(n)
  if (rounded < 1 || rounded > 5) return null
  return rounded - 1
}

/**
 * Restrict cell-key iteration to *real* plain-object payload shapes.
 *
 * Phase-12 audit fix #3: if `payload.ratings` is an array, Object.entries
 * yields ["0", v] pairs, letting a rater forge cell keys that inflate the
 * run's cellCount or collide with real rubric ids. We refuse anything
 * that's not a non-array object.
 */
function isPlainObject(x: unknown): x is Record<string, unknown> {
  return (
    typeof x === 'object' && x !== null && !Array.isArray(x)
  )
}

/**
 * Extract DS cells from submitted pair-rubric annotations.
 * Cell key encodes (rubricId, side) so the run can be joined back to
 * topic+rubric metadata in the UI. K=2 (boolean).
 */
function buildPairCells(
  annoRows: Array<{ topicId: string; userId: string; payload: Record<string, unknown> }>,
): DSCell[] {
  // Map<topicId|cellSubKey, Map<userId, classIdx>>
  const buckets = new Map<string, Map<string, number>>()
  for (const r of annoRows) {
    if (!isPlainObject(r.payload.ratings)) continue
    const ratings = r.payload.ratings as Record<string, unknown>
    for (const [rubricId, raw] of Object.entries(ratings)) {
      if (!isPlainObject(raw)) continue
      const v = raw as { a?: unknown; b?: unknown }
      for (const side of ['a', 'b'] as const) {
        const obs = v?.[side]
        if (typeof obs !== 'boolean') continue
        const key = `${r.topicId}::pair:${rubricId}:${side}`
        const inner = buckets.get(key) ?? new Map<string, number>()
        // Latest write wins per (topic, user) — submitted annotations
        // are immutable but a user might appear twice across reruns.
        inner.set(r.userId, obs ? 1 : 0)
        buckets.set(key, inner)
      }
    }
  }
  return Array.from(buckets.entries()).map(([key, votes]) => ({
    key,
    votes,
  }))
}

/**
 * Extract DS cells from submitted arena-gsb annotations. K=5 (1..5).
 */
function buildArenaCells(
  annoRows: Array<{ topicId: string; userId: string; payload: Record<string, unknown> }>,
): DSCell[] {
  const buckets = new Map<string, Map<string, number>>()
  for (const r of annoRows) {
    if (!isPlainObject(r.payload.dimensions)) continue
    const dims = r.payload.dimensions as Record<string, unknown>
    for (const [dimId, raw] of Object.entries(dims)) {
      if (!isPlainObject(raw)) continue
      const v = raw as { a?: unknown; b?: unknown }
      for (const side of ['a', 'b'] as const) {
        const cls = clampScore(v?.[side])
        if (cls === null) continue
        const key = `${r.topicId}::arena:${dimId}:${side}`
        const inner = buckets.get(key) ?? new Map<string, number>()
        inner.set(r.userId, cls)
        buckets.set(key, inner)
      }
    }
  }
  return Array.from(buckets.entries()).map(([key, votes]) => ({
    key,
    votes,
  }))
}

function decodeCellKey(key: string): {
  topicId: string
  cellKey: string
} {
  const sep = key.indexOf('::')
  if (sep < 0) return { topicId: '', cellKey: key }
  return { topicId: key.slice(0, sep), cellKey: key.slice(sep + 2) }
}

export interface RunDsResult {
  ok: true
  runId: string
  cellCount: number
  raterCount: number
  iterations: number
  converged: boolean
}

/**
 * Run Dawid-Skene EM on all submitted annotations in the workspace.
 * Returns the new run id. Idempotent in spirit but appends a new row
 * per call so admins can compare runs over time.
 */
export async function runWorkspaceDawidSkene(
  input: z.infer<typeof runSchema>,
): Promise<RunDsResult> {
  const parsed = runSchema.parse(input)
  const { user } = await requireWorkspaceAdmin(parsed.workspaceId)
  const db = getDb()

  const [ws] = await db
    .select({ templateMode: workspaces.templateMode })
    .from(workspaces)
    .where(eq(workspaces.id, parsed.workspaceId))
    .limit(1)
  if (!ws) throw new NotFoundError('Workspace')

  // DS lives on the payload modes — agent-trace-eval has per-step ratings
  // in step_annotations, which need a separate codepath. Surface a clear
  // error rather than silently producing an empty run.
  if (ws.templateMode !== 'pair-rubric' && ws.templateMode !== 'arena-gsb') {
    throw new ValidationError(
      `Dawid-Skene runs on pair-rubric and arena-gsb workspaces today (got ${ws.templateMode}). Trajectory DS is on the backlog.`,
    )
  }
  const mode = ws.templateMode as 'pair-rubric' | 'arena-gsb'

  // Load every submitted annotation for the workspace's tasks of this mode.
  const rows = await db
    .select({
      topicId: annotations.topicId,
      userId: annotations.userId,
      payload: annotations.payload,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .where(
      and(
        eq(tasks.workspaceId, parsed.workspaceId),
        eq(tasks.templateMode, mode),
        isNotNull(annotations.submittedAt),
      ),
    )

  const typedRows = rows.map((r) => ({
    topicId: r.topicId,
    userId: r.userId,
    payload: (r.payload ?? {}) as Record<string, unknown>,
  }))

  const cells = mode === 'pair-rubric' ? buildPairCells(typedRows) : buildArenaCells(typedRows)
  const K = mode === 'pair-rubric' ? 2 : 5

  if (cells.length === 0) {
    throw new ValidationError(
      'No submitted annotations to infer truth from. Wait until raters submit work.',
    )
  }

  // Memory guard (Phase-12 audit fix #4): EM allocates R*K*K floats and
  // iterates over cells*votes*K per E/M step. At workspace scale this is
  // cheap, but a pathological workspace (100k+ cells × many raters)
  // could OOM the Node process. We cap at 50k cells per run — admins
  // hitting this should split their workspace into smaller scopes.
  // This is intentionally generous (50k cells = ~10k topics × 5
  // rubrics × 2 sides) so legitimate runs never trip it.
  const CELL_CAP = 50_000
  if (cells.length > CELL_CAP) {
    throw new ValidationError(
      `DS run would touch ${cells.length} cells, exceeding the safety cap of ${CELL_CAP}. Split the workspace into smaller scopes (per-task runs are on the backlog).`,
    )
  }

  const result: DSResult = runDawidSkene({ K, cells })

  // Persist: runs row → labels + confusion rows.
  const [run] = await db
    .insert(dsConsensusRuns)
    .values({
      workspaceId: parsed.workspaceId,
      templateMode: mode,
      numClasses: K,
      cellCount: result.cells.length,
      raterCount: result.raters.length,
      iterations: result.iterations,
      converged: result.converged,
      logLikelihood: result.logLikelihood,
      triggeredBy: user.id,
    })
    .returning({ id: dsConsensusRuns.id })

  // Persist labels — chunked to stay within parameter limits.
  if (result.cells.length > 0) {
    const labelRows = result.cells.map((c) => {
      const { topicId, cellKey } = decodeCellKey(c.key)
      const posteriorMap: Record<string, number> = {}
      c.posterior.forEach((p, k) => (posteriorMap[String(k)] = p))
      return {
        runId: run.id,
        topicId,
        cellKey,
        inferredClass: c.inferredClass,
        confidence: c.confidence,
        posterior: posteriorMap,
        voteCount: c.voteCount,
      }
    })
    // Chunk 500 at a time (postgres-js has ~2^15 parameter cap; each row
    // here is 7 params, so 500 = 3500 params — well under).
    for (let i = 0; i < labelRows.length; i += 500) {
      await db.insert(dsInferredLabels).values(labelRows.slice(i, i + 500))
    }
  }

  if (result.raters.length > 0) {
    const confusionRows = result.raters.map((r) => ({
      runId: run.id,
      userId: r.raterId,
      confusion: r.confusion,
      nObservations: r.nObservations,
      accuracy: r.accuracy,
      biasSummary: r.biasSummary,
    }))
    await db.insert(dsRaterConfusion).values(confusionRows)
  }

  await db.insert(events).values({
    type: 'ds.run_completed',
    workspaceId: parsed.workspaceId,
    actorId: user.id,
    payload: {
      runId: run.id,
      mode,
      cellCount: result.cells.length,
      raterCount: result.raters.length,
      iterations: result.iterations,
      converged: result.converged,
    },
  })

  revalidatePath(`/workspaces/${parsed.workspaceId}/quality`)

  return {
    ok: true,
    runId: run.id,
    cellCount: result.cells.length,
    raterCount: result.raters.length,
    iterations: result.iterations,
    converged: result.converged,
  }
}
