import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { annotationRevisions } from '@/lib/db/schema'

/**
 * Phase-10 revision helpers — append-only history for one annotation.
 *
 * `writeRevision()` is the single entry point used by every save-side
 * path (autosave, manual checkpoint, submit, restore). It:
 *   1. Inserts the snapshot row
 *   2. Prunes oldest 'autosave' rows above the cap (others never
 *      pruned — those are the memory points admins want to keep)
 *
 * Failures NEVER bubble out of the caller — annotation save is the
 * source of truth, revision tracking is the safety net. Worst-case:
 * a stale revision history, never a lost annotation.
 */

export type RevisionKind =
  | 'autosave'
  | 'manual'
  | 'submit'
  | 'restore'
  /**
   * Finals P2 D9 — the AI Review Agent decided 'send_back' and the
   * topic returned to drafting. `payload` snapshots the same content
   * the submitter had at the time so the audit log can render the
   * pre-AI-review state. The `actorId` is the submitter (the AI
   * agent has no user row); the timeline distinguishes by `kind`.
   */
  | 'ai_send_back'

/** Max kept 'autosave' rows per annotation. Submit / manual / restore
 *  rows are immune from pruning — those are the user-meaningful
 *  moments admins might restore from. */
const AUTOSAVE_KEEP_CAP = 20

export interface WriteRevisionInput {
  annotationId: string
  actorId: string
  workspaceId: string
  payload: unknown
  kind: RevisionKind
  prevRevisionId?: string | null
}

export async function writeRevision(
  input: WriteRevisionInput,
): Promise<{ revisionId: string } | null> {
  try {
    const db = getDb()
    // Snapshot byte size — cheap proxy to alert if a template's payload
    // accidentally grows past expected bounds.
    let byteSize = 0
    try {
      byteSize = new TextEncoder().encode(
        JSON.stringify(input.payload),
      ).length
    } catch {
      byteSize = 0
    }
    const [row] = await db
      .insert(annotationRevisions)
      .values({
        annotationId: input.annotationId,
        actorId: input.actorId,
        workspaceId: input.workspaceId,
        payload: input.payload as object,
        kind: input.kind,
        prevRevisionId: input.prevRevisionId ?? null,
        byteSize,
      })
      .returning({ id: annotationRevisions.id })

    // Cap autosave rows. Only autosaves are subject to pruning;
    // 'manual', 'submit', 'restore' are kept forever.
    if (input.kind === 'autosave') {
      // We over-fetch the autosaves rather than do a single DELETE
      // with OFFSET — postgres doesn't have a portable DELETE LIMIT
      // and the per-annotation autosave count is bounded, so the
      // round-trip cost is fine.
      const autosaves = await db
        .select({ id: annotationRevisions.id })
        .from(annotationRevisions)
        .where(
          and(
            eq(annotationRevisions.annotationId, input.annotationId),
            eq(annotationRevisions.kind, 'autosave'),
          ),
        )
        .orderBy(asc(annotationRevisions.ts))
      const excess = autosaves.length - AUTOSAVE_KEEP_CAP
      if (excess > 0) {
        const idsToDelete = autosaves.slice(0, excess).map((r) => r.id)
        // Delete one at a time — sufficient for ≤ a few excess rows;
        // bulk delete with IN would also work but adds an import.
        for (const id of idsToDelete) {
          await db
            .delete(annotationRevisions)
            .where(eq(annotationRevisions.id, id))
        }
      }
    }

    return { revisionId: row.id }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[revisions] writeRevision failed (non-fatal):',
      e instanceof Error ? e.message : e,
    )
    return null
  }
}
