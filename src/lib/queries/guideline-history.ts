import 'server-only'
import { asc, desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { guidelinePatches, guidelines } from '@/lib/db/schema'

/**
 * Guideline evolution for a single task. Returns:
 *
 *   - every version of the task's guideline (chronological)
 *   - every patch that was proposed against any version, with status
 *
 * The diff between adjacent versions is computed on the page-render
 * side — we keep the storage flat (full content per version) so
 * recomputing the diff is just a string operation.
 */

export interface GuidelineVersion {
  id: string
  version: number
  content: string
  createdAt: Date
  parentVersionId: string | null
}

export interface GuidelinePatch {
  id: string
  guidelineId: string
  proposedBy: string
  patchContent: string
  rationale: string | null
  status: string
  createdAt: Date
}

export interface GuidelineHistory {
  versions: GuidelineVersion[]
  patches: GuidelinePatch[]
}

export async function getGuidelineHistory(opts: {
  taskId: string
}): Promise<GuidelineHistory> {
  const db = getDb()
  const versions = await db
    .select()
    .from(guidelines)
    .where(eq(guidelines.taskId, opts.taskId))
    .orderBy(asc(guidelines.version))

  if (versions.length === 0) {
    return { versions: [], patches: [] }
  }

  const patches = await db
    .select()
    .from(guidelinePatches)
    .where(
      // Patches index against ANY of the task's guideline versions.
      // Drizzle's inArray is the natural fit here.
      // (We could fetch by taskId via an inner join, but a simple
      // two-step is cheaper for the typical few-versions case.)
      eq(
        guidelinePatches.guidelineId,
        versions[versions.length - 1].id,
      ),
    )
    .orderBy(desc(guidelinePatches.createdAt))

  // Also pull patches against PRIOR versions (history view shows them all).
  // Cheap separate query rather than fight inArray on the same .where.
  const allPatches: GuidelinePatch[] = [...patches]
  for (let i = 0; i < versions.length - 1; i++) {
    const more = await db
      .select()
      .from(guidelinePatches)
      .where(eq(guidelinePatches.guidelineId, versions[i].id))
    allPatches.push(...more)
  }
  allPatches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return {
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      content: v.content,
      createdAt: v.createdAt,
      parentVersionId: v.parentVersionId,
    })),
    patches: allPatches,
  }
}

// ─── Tiny unified-diff math (no deps) ─────────────────────────────────

export type DiffLine =
  | { kind: 'equal'; line: string }
  | { kind: 'add'; line: string }
  | { kind: 'del'; line: string }

/**
 * Line-by-line longest-common-subsequence diff. Produces a unified
 * diff stream — { equal, add, del } in document order — that the
 * renderer can flow into a single column.
 *
 * For our use case (guideline markdown, dozens of lines), the O(m*n)
 * LCS table is fine. We don't need patience diff / Myers diff.
 */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')

  // Build LCS lengths table.
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  )
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  // Walk the table, emit diff ops.
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: 'equal', line: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', line: a[i] })
      i++
    } else {
      out.push({ kind: 'add', line: b[j] })
      j++
    }
  }
  while (i < m) out.push({ kind: 'del', line: a[i++] })
  while (j < n) out.push({ kind: 'add', line: b[j++] })

  return out
}
