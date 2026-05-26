import 'server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
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
 * Suppress unused-import warning on the `and` import — kept for
 * potential composed filters once we add per-workspace narrowing.
 */
void and
