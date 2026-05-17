import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { datasetVersions, users } from '@/lib/db/schema'

/**
 * Read helpers for dataset-version UI surfaces + export (Phase-14).
 *
 *   listDatasetVersions     — admin sidebar card on /settings
 *   getDatasetVersionById   — export endpoint reads the manifest here
 */

export interface DatasetVersionSummary {
  id: string
  label: string
  description: string | null
  itemCount: number
  byteSize: number
  frozenAt: Date
  frozenByUserId: string | null
  frozenByDisplayName: string | null
  frozenByEmail: string | null
}

export async function listDatasetVersions(
  workspaceId: string,
): Promise<DatasetVersionSummary[]> {
  const db = getDb()
  const rows = await db
    .select({
      id: datasetVersions.id,
      label: datasetVersions.label,
      description: datasetVersions.description,
      itemCount: datasetVersions.itemCount,
      byteSize: datasetVersions.byteSize,
      frozenAt: datasetVersions.frozenAt,
      frozenBy: datasetVersions.frozenBy,
      displayName: users.displayName,
      email: users.email,
    })
    .from(datasetVersions)
    .leftJoin(users, eq(users.id, datasetVersions.frozenBy))
    .where(eq(datasetVersions.workspaceId, workspaceId))
    .orderBy(desc(datasetVersions.frozenAt))
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description,
    itemCount: r.itemCount,
    byteSize: r.byteSize,
    frozenAt: r.frozenAt,
    frozenByUserId: r.frozenBy,
    frozenByDisplayName: r.displayName,
    frozenByEmail: r.email,
  }))
}

export interface DatasetVersionDetail extends DatasetVersionSummary {
  workspaceId: string
  manifest: unknown[]
}

export async function getDatasetVersionById(
  versionId: string,
): Promise<DatasetVersionDetail | null> {
  const db = getDb()
  const [row] = await db
    .select({
      id: datasetVersions.id,
      workspaceId: datasetVersions.workspaceId,
      label: datasetVersions.label,
      description: datasetVersions.description,
      itemCount: datasetVersions.itemCount,
      byteSize: datasetVersions.byteSize,
      frozenAt: datasetVersions.frozenAt,
      frozenBy: datasetVersions.frozenBy,
      manifest: datasetVersions.manifest,
      displayName: users.displayName,
      email: users.email,
    })
    .from(datasetVersions)
    .leftJoin(users, eq(users.id, datasetVersions.frozenBy))
    .where(eq(datasetVersions.id, versionId))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    label: row.label,
    description: row.description,
    itemCount: row.itemCount,
    byteSize: row.byteSize,
    frozenAt: row.frozenAt,
    frozenByUserId: row.frozenBy,
    frozenByDisplayName: row.displayName,
    frozenByEmail: row.email,
    manifest: Array.isArray(row.manifest) ? (row.manifest as unknown[]) : [],
  }
}

/** Helper for the /workspaces/[id]/settings card: list + latest summary. */
export async function getLatestDatasetVersion(
  workspaceId: string,
): Promise<DatasetVersionSummary | null> {
  const db = getDb()
  const [row] = await db
    .select({
      id: datasetVersions.id,
      label: datasetVersions.label,
      description: datasetVersions.description,
      itemCount: datasetVersions.itemCount,
      byteSize: datasetVersions.byteSize,
      frozenAt: datasetVersions.frozenAt,
      frozenBy: datasetVersions.frozenBy,
      displayName: users.displayName,
      email: users.email,
    })
    .from(datasetVersions)
    .leftJoin(users, eq(users.id, datasetVersions.frozenBy))
    .where(eq(datasetVersions.workspaceId, workspaceId))
    .orderBy(desc(datasetVersions.frozenAt))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    itemCount: row.itemCount,
    byteSize: row.byteSize,
    frozenAt: row.frozenAt,
    frozenByUserId: row.frozenBy,
    frozenByDisplayName: row.displayName,
    frozenByEmail: row.email,
  }
}

// silence unused
void and
