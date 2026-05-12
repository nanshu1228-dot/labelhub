import 'server-only'
import type { CanonicalTrajectory } from '@/lib/trajectories/schema'
import { persistTrajectory } from '@/lib/trajectories/ingest'
import { validateTrajectory } from '@/lib/trajectories/schema'
import { uploadAttachmentsToStorage } from './storage'
import type { AttachmentRecord } from './attachment-extractor'

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
  const meta = (traj.meta ?? {}) as Record<string, unknown>
  const inAtt = (meta.attachments as AttachmentRecord[] | null | undefined) ?? []

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
  await persistTrajectory({
    workspaceId: opts.workspaceId,
    trajectory: validated,
    actorId: null,
  })
}
