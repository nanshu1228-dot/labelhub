'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireWorkspaceMember } from '@/lib/auth/guards'
import { ingestTrajectory } from '@/lib/trajectories/ingest'
import { ValidationError } from '@/lib/errors'

/**
 * Session-authed trajectory upload.
 *
 * The proxy + `/api/ingest/trajectories` paths both require a workspace API
 * key. This action gives a signed-in workspace member a no-key, no-code way
 * to drop a single trajectory into the inbox and immediately annotate it —
 * the lowest-friction on-ramp to the "annotate your own trajectory" loop.
 *
 * It reuses the exact ingest pipeline (detect → adapt → persist), so an
 * uploaded run behaves identically to a captured one: same tables, same
 * lazy Inbox-task materialization on first mark, same rubric.
 */
const schema = z.object({
  workspaceId: z.string().uuid(),
  agentName: z.string().trim().min(1).max(120),
  /** Raw trajectory JSON text (canonical / anthropic / openai-assistants). */
  raw: z.string().min(2).max(2_000_000),
})

export async function uploadTrajectory(input: z.infer<typeof schema>) {
  const parsed = schema.parse(input)
  const { user } = await requireWorkspaceMember(parsed.workspaceId)

  let payload: unknown
  try {
    payload = JSON.parse(parsed.raw)
  } catch {
    throw new ValidationError(
      'Not valid JSON — paste a single trajectory object (use "Load sample" to see the expected shape).',
    )
  }

  const result = await ingestTrajectory({
    workspaceId: parsed.workspaceId,
    agentName: parsed.agentName,
    source: 'upload',
    actorId: user.id,
    payload,
  })

  revalidatePath(`/workspaces/${parsed.workspaceId}/trajectories`)
  return { trajectoryId: result.trajectoryId, stepCount: result.stepCount }
}
