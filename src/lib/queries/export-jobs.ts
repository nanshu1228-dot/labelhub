import 'server-only'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  events,
  exportJobs,
  users,
  workspaceMembers,
  workspaces,
} from '@/lib/db/schema'

/**
 * Export-history queries — Finals D21-D.
 *
 * Powers `/admin/exports` (the user's export-job history across every
 * workspace they admin) + the per-job polling endpoint
 * `GET /api/export/jobs/[id]`.
 */

export interface ExportJobRow {
  id: string
  workspaceId: string
  workspaceName: string
  format: string
  status: 'pending' | 'running' | 'completed' | 'failed' | string
  rowCount: number | null
  byteSize: number | null
  storagePath: string | null
  errorText: string | null
  createdAt: Date
  finishedAt: Date | null
  /** Submitter info — null when the row was system-created. */
  createdBy: { id: string; email: string } | null
}

/**
 * Cross-workspace list of jobs the user can see. Admin → every job
 * in their workspaces; QC → same (can audit their reviewers' exports);
 * everyone else → empty list.
 */
export async function listMyExportJobs(opts: {
  userId: string
  limit?: number
}): Promise<ExportJobRow[]> {
  const db = getDb()
  const allowed = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, opts.userId))
  const wsIds = allowed
    .filter((r) => r.role === 'admin' || r.role === 'qc')
    .map((r) => r.workspaceId)
  if (wsIds.length === 0) return []

  const rows = await db
    .select({
      id: exportJobs.id,
      workspaceId: exportJobs.workspaceId,
      workspaceName: workspaces.name,
      format: exportJobs.format,
      status: exportJobs.status,
      rowCount: exportJobs.rowCount,
      byteSize: exportJobs.byteSize,
      storagePath: exportJobs.storagePath,
      errorText: exportJobs.errorText,
      createdAt: exportJobs.createdAt,
      finishedAt: exportJobs.finishedAt,
      createdById: exportJobs.createdBy,
      createdByEmail: users.email,
    })
    .from(exportJobs)
    .innerJoin(workspaces, eq(workspaces.id, exportJobs.workspaceId))
    .leftJoin(users, eq(users.id, exportJobs.createdBy))
    .where(inArray(exportJobs.workspaceId, wsIds))
    .orderBy(desc(exportJobs.createdAt))
    .limit(opts.limit ?? 50)

  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    workspaceName: r.workspaceName,
    format: r.format,
    status: r.status as ExportJobRow['status'],
    rowCount: r.rowCount,
    byteSize: r.byteSize,
    storagePath: r.storagePath,
    errorText: r.errorText,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
    createdBy:
      r.createdById && r.createdByEmail
        ? { id: r.createdById, email: r.createdByEmail }
        : null,
  }))
}

/**
 * Polling endpoint shape — single job by id. Auth happens upstream
 * (the route verifies the caller is admin/qc in the job's
 * workspace before returning).
 */
export async function getExportJobById(
  jobId: string,
): Promise<ExportJobRow | null> {
  const db = getDb()
  const [row] = await db
    .select({
      id: exportJobs.id,
      workspaceId: exportJobs.workspaceId,
      workspaceName: workspaces.name,
      format: exportJobs.format,
      status: exportJobs.status,
      rowCount: exportJobs.rowCount,
      byteSize: exportJobs.byteSize,
      storagePath: exportJobs.storagePath,
      errorText: exportJobs.errorText,
      createdAt: exportJobs.createdAt,
      finishedAt: exportJobs.finishedAt,
      createdById: exportJobs.createdBy,
      createdByEmail: users.email,
    })
    .from(exportJobs)
    .innerJoin(workspaces, eq(workspaces.id, exportJobs.workspaceId))
    .leftJoin(users, eq(users.id, exportJobs.createdBy))
    .where(eq(exportJobs.id, jobId))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    format: row.format,
    status: row.status as ExportJobRow['status'],
    rowCount: row.rowCount,
    byteSize: row.byteSize,
    storagePath: row.storagePath,
    errorText: row.errorText,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    createdBy:
      row.createdById && row.createdByEmail
        ? { id: row.createdById, email: row.createdByEmail }
        : null,
  }
}

/**
 * A task's recent export pulls — spec §4.6 "下载历史列表" for task owners.
 *
 * Task-scoped annotation exports stream synchronously from
 * `GET /api/workspaces/:id/tasks/:taskId/export` (they never land in
 * `export_jobs`, which is reserved for the large dataset-version async
 * path keyed by `versionId`). The route's only durable footprint is an
 * `export.created` audit event whose payload carries `{ taskId, format,
 * count, bytes }`. We read that back here so an owner can see their last
 * few pulls from the task page without opening the admin delivery console.
 *
 * Read-only; the route still owns the write side untouched.
 */
export interface TaskExportHistoryRow {
  id: string
  format: string
  rowCount: number | null
  byteSize: number | null
  createdAt: Date
}

export async function listTaskExportJobs(
  taskId: string,
  opts?: { limit?: number },
): Promise<TaskExportHistoryRow[]> {
  const db = getDb()
  const rows = await db
    .select({
      id: events.id,
      payload: events.payload,
      ts: events.ts,
    })
    .from(events)
    .where(
      and(
        eq(events.type, 'export.created'),
        sql`${events.payload} ->> 'taskId' = ${taskId}`,
      ),
    )
    .orderBy(desc(events.ts))
    .limit(opts?.limit ?? 5)

  return rows.map((row) => {
    const payload = (row.payload ?? {}) as {
      format?: unknown
      count?: unknown
      bytes?: unknown
    }
    return {
      id: row.id,
      format: typeof payload.format === 'string' ? payload.format : 'export',
      rowCount: typeof payload.count === 'number' ? payload.count : null,
      byteSize: typeof payload.bytes === 'number' ? payload.bytes : null,
      createdAt: row.ts,
    }
  })
}

/**
 * Suppress unused-import warning on the `and` import — kept for
 * potential composed filters once we add per-workspace narrowing.
 */
void and
