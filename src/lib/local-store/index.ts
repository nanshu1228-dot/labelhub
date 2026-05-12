import Dexie, { type Table } from 'dexie'

/**
 * Local-First Store — Pillar 1.
 *
 * All writes hit IndexedDB first; a background loop syncs to the server.
 * Survives network drops, browser refreshes, tab restarts.
 */

export interface DraftAnnotation {
  id: string
  topicId: string
  taskId: string
  payload: unknown
  /** ms epoch — set on every edit, cleared (kept as null) when synced */
  dirtyAt: number
  syncedAt: number | null
}

export class LabelHubLocalDB extends Dexie {
  drafts!: Table<DraftAnnotation, string>

  constructor() {
    super('labelhub')
    this.version(1).stores({
      drafts: 'id, topicId, taskId, dirtyAt, syncedAt',
    })
  }
}

let _db: LabelHubLocalDB | null = null

/** Lazy singleton — only instantiated in the browser. */
export function getLocalDb(): LabelHubLocalDB {
  if (typeof window === 'undefined') {
    throw new Error('LocalDB is browser-only; do not call from server code.')
  }
  if (!_db) _db = new LabelHubLocalDB()
  return _db
}
