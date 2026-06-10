import 'server-only'
import type { CanonicalTrajectory } from '@/lib/trajectories/schema'
import { persistTrajectory } from '@/lib/trajectories/ingest'
import { validateTrajectory } from '@/lib/trajectories/schema'
import { scheduleSummaryIfMissing } from '@/lib/actions/trajectory-summary'
import { uploadAttachmentsToStorage } from './storage'
import type { AttachmentRecord } from './attachment-extractor'
import { getDb } from '@/lib/db/client'
import { events } from '@/lib/db/schema'

/**
 * Marker set on an error after this module has already recorded a
 * `trajectory.capture_failed` event for it. The proxy route's catch
 * blocks check this so a single DB/persist failure isn't double-counted
 * (the proxy emits only for failures that bubble up WITHOUT this flag —
 * e.g. an adapter/validation error thrown before persist runs).
 */
export const CAPTURE_FAILED_EMITTED = '__labelhubCaptureFailedEmitted'

/**
 * Persist a captured trajectory, uploading any base64-inline attachments to
 * Supabase Storage as a pre-step. Used by both proxy routes inside their
 * `after()` blocks — the upload + DB write happen outside the function's
 * client-facing maxDuration.
 *
 * Always strips `_rawData` before persistence, even if storage is down. The
 * trajectories table will never see raw blob bytes.
 */
export async function persistWithStorage(opts: {
  workspaceId: string
  trajectory: CanonicalTrajectory
}): Promise<void> {
  const traj = opts.trajectory
  try {
    const meta = (traj.meta ?? {}) as Record<string, unknown>
    const inAtt =
      (meta.attachments as AttachmentRecord[] | null | undefined) ?? []

    // Always run the uploader — when storage is unconfigured, it returns
    // metadata-only records (with `_rawData` stripped). Mutates a fresh array
    // so the original `traj.meta.attachments` reference is replaced cleanly.
    const outAtt = await uploadAttachmentsToStorage({
      workspaceId: opts.workspaceId,
      attachments: inAtt,
    })

    const cleanedMeta = {
      ...meta,
      attachments: outAtt.length > 0 ? outAtt : null,
    }
    const cleanedTrajectory: CanonicalTrajectory = {
      ...traj,
      meta: cleanedMeta,
    }

    const validated = validateTrajectory(cleanedTrajectory)
    const result = await persistTrajectory({
      workspaceId: opts.workspaceId,
      trajectory: validated,
      actorId: null,
    })

    // Pre-distill into a one-paragraph summary for the /analyze page. Best
    // effort, throw-away result — the action handles its own errors.
    await scheduleSummaryIfMissing({ trajectoryId: result.trajectoryId })
  } catch (err) {
    // Persist/validate/upload failed AFTER the proxy already returned a 200
    // to the client — a silent "captured nothing" we must make observable.
    // Record an append-only event (best-effort, never blocks), mark the
    // error so the proxy's catch doesn't double-count it, then re-throw so
    // the existing console.warn in the proxy still fires.
    try {
      const db = getDb()
      await db.insert(events).values({
        type: 'trajectory.capture_failed',
        workspaceId: opts.workspaceId,
        actorId: null,
        payload: {
          message: err instanceof Error ? err.message : String(err),
          kind: traj.agentName,
          path: traj.source,
        },
      })
    } catch {
      // Even the observability emit failed — the proxy's console.warn
      // (after the re-throw) remains the last-resort signal.
    }
    if (err && typeof err === 'object') {
      ;(err as Record<string, unknown>)[CAPTURE_FAILED_EMITTED] = true
    }
    throw err
  }
}
