'use server'

/**
 * Dataset-version freeze action (Phase-14).
 *
 *   freezeDatasetVersion({ workspaceId, label?, description? }) →
 *     snapshot every currently-approved annotation in the workspace,
 *     store the manifest, return the new version row.
 *
 * Versions are workspace-scoped and immutable once frozen. Admins can
 * create N versions over time; export reads the labeled manifest so
 * historical state is reproducible even after the live annotations
 * table has been edited/restored/soft-deleted.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  datasetVersions,
  events,
  tasks,
  topics,
  workspaceMembers,
} from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { uuidLike } from '@/lib/validators/uuid'
import { ValidationError } from '@/lib/errors'

const freezeSchema = z.object({
  workspaceId: uuidLike,
  /** Optional explicit label. When omitted, auto-generates "v{n}". */
  label: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z0-9._\-+]+$/, 'Label must be alphanumeric / .-_+')
    .optional(),
  description: z.string().max(2000).optional(),
})

/** Hard cap on items frozen per version. Keeps the manifest jsonb cell
 *  size bounded — at ~5KB per annotation × 5k items = ~25MB row, well
 *  under the Postgres TOAST 1GB cell limit but big enough that any
 *  legitimate "freeze v1 of my dataset" succeeds. */
const MAX_ITEMS_PER_VERSION = 5000

export async function freezeDatasetVersion(
  input: z.infer<typeof freezeSchema>,
): Promise<{
  ok: true
  versionId: string
  label: string
  itemCount: number
  byteSize: number
}> {
  const parsed = freezeSchema.parse(input)
  const { user } = await requireWorkspaceAdmin(parsed.workspaceId)
  const db = getDb()

  // 1. Auto-label resolution. We scan existing labels of the form
  //    "v{n}" and pick the next integer. Admin-chosen labels coexist
  //    fine — we just never auto-collide with their format.
  let label = parsed.label
  if (!label) {
    const rows = await db
      .select({ label: datasetVersions.label })
      .from(datasetVersions)
      .where(eq(datasetVersions.workspaceId, parsed.workspaceId))
    let maxN = 0
    for (const r of rows) {
      const m = /^v(\d+)$/.exec(r.label)
      if (m) {
        const n = parseInt(m[1], 10)
        if (Number.isFinite(n) && n > maxN) maxN = n
      }
    }
    label = `v${maxN + 1}`
  }

  // 2. Defensive: explicit-label collision check. The unique index
  //    will reject anyway, but we'd rather throw a friendly error
  //    than a Postgres constraint name.
  const [existing] = await db
    .select({ id: datasetVersions.id })
    .from(datasetVersions)
    .where(
      and(
        eq(datasetVersions.workspaceId, parsed.workspaceId),
        eq(datasetVersions.label, label),
      ),
    )
    .limit(1)
  if (existing) {
    throw new ValidationError(
      `A version labeled "${label}" already exists in this workspace. Pick a different label.`,
    )
  }

  // 3. Pull every currently-approved annotation in the workspace.
  //    "Approved" = the host topic's status moved to 'approved' (the
  //    admin acceptance terminal state). Mirrors what the trust /
  //    payout pipeline considers an authoritative label.
  const rows = await db
    .select({
      annotationId: annotations.id,
      topicId: annotations.topicId,
      taskId: topics.taskId,
      userId: annotations.userId,
      payload: annotations.payload,
      submittedAt: annotations.submittedAt,
      templateMode: tasks.templateMode,
      topicStatus: topics.status,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .where(
      and(
        eq(tasks.workspaceId, parsed.workspaceId),
        eq(topics.status, 'approved'),
      ),
    )
    .orderBy(asc(annotations.submittedAt))
    .limit(MAX_ITEMS_PER_VERSION + 1)

  if (rows.length === 0) {
    throw new ValidationError(
      'No approved annotations to freeze yet. Approve some submissions first, then come back.',
    )
  }
  if (rows.length > MAX_ITEMS_PER_VERSION) {
    throw new ValidationError(
      `Workspace has more than ${MAX_ITEMS_PER_VERSION} approved annotations. Per-task versioning is on the backlog; for now, contact support to bump the cap.`,
    )
  }

  // 4. Build the manifest. We freeze approvedAt = NOW() because the
  //    schema doesn't record per-annotation acceptance time (the topic
  //    status moves but the annotation row doesn't carry the moment).
  //    Snapshot honesty: it's "approved as of {frozen_at}".
  const now = new Date()
  const manifest = rows.map((r) => ({
    annotationId: r.annotationId,
    topicId: r.topicId,
    taskId: r.taskId,
    userId: r.userId,
    payload: r.payload,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    approvedAtSnapshot: now.toISOString(),
    templateMode: r.templateMode,
  }))
  const serialized = JSON.stringify(manifest)
  const byteSize = Buffer.byteLength(serialized, 'utf8')

  const [inserted] = await db
    .insert(datasetVersions)
    .values({
      workspaceId: parsed.workspaceId,
      label,
      description: parsed.description ?? null,
      itemCount: manifest.length,
      manifest,
      byteSize,
      frozenBy: user.id,
    })
    .returning({ id: datasetVersions.id })

  // 5. Audit event — surfaces in /audit and admin dashboards.
  await db.insert(events).values({
    type: 'dataset.version_frozen',
    workspaceId: parsed.workspaceId,
    actorId: user.id,
    payload: {
      versionId: inserted.id,
      label,
      itemCount: manifest.length,
      byteSize,
    },
  })

  // Silence unused-imports — kept for future per-task filter that
  // checks the requester's membership granularity.
  void workspaceMembers
  void sql

  revalidatePath(`/workspaces/${parsed.workspaceId}/settings`)

  return {
    ok: true,
    versionId: inserted.id,
    label,
    itemCount: manifest.length,
    byteSize,
  }
}
