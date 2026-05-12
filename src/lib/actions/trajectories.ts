'use server'
import { z } from 'zod'
import { and, eq, isNull, isNotNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events, trajectories } from '@/lib/db/schema'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { ConflictError, NotFoundError } from '@/lib/errors'

/**
 * Trajectory lifecycle Server Actions.
 *
 * Soft delete is the only delete we support — preserves audit trail and
 * lets us restore if mistakes happen. Hard delete is via a separate
 * scheduled cleanup job (post-retention period).
 *
 * Authorization: workspace admin only.
 */

const idSchema = z.object({ trajectoryId: z.string().uuid() })

export async function softDeleteTrajectory(input: z.infer<typeof idSchema>) {
  const parsed = idSchema.parse(input)
  const db = getDb()

  const [traj] = await db
    .select()
    .from(trajectories)
    .where(eq(trajectories.id, parsed.trajectoryId))
    .limit(1)
  if (!traj) throw new NotFoundError('Trajectory')

  const { user } = await requireWorkspaceAdmin(traj.workspaceId)

  if (traj.deletedAt) {
    throw new ConflictError('Trajectory is already deleted.')
  }

  // Soft-delete by setting deletedAt; query layers filter on this.
  await db
    .update(trajectories)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(trajectories.id, parsed.trajectoryId),
        isNull(trajectories.deletedAt),
      ),
    )

  await db.insert(events).values({
    type: 'trajectory.soft_deleted',
    workspaceId: traj.workspaceId,
    actorId: user.id,
    payload: {
      trajectoryId: traj.id,
      agentName: traj.agentName,
      source: traj.source,
    },
  })

  return { ok: true as const }
}

export async function restoreTrajectory(input: z.infer<typeof idSchema>) {
  const parsed = idSchema.parse(input)
  const db = getDb()

  const [traj] = await db
    .select()
    .from(trajectories)
    .where(eq(trajectories.id, parsed.trajectoryId))
    .limit(1)
  if (!traj) throw new NotFoundError('Trajectory')

  const { user } = await requireWorkspaceAdmin(traj.workspaceId)

  if (!traj.deletedAt) {
    throw new ConflictError('Trajectory is not deleted.')
  }

  await db
    .update(trajectories)
    .set({ deletedAt: null })
    .where(
      and(
        eq(trajectories.id, parsed.trajectoryId),
        isNotNull(trajectories.deletedAt),
      ),
    )

  await db.insert(events).values({
    type: 'trajectory.restored',
    workspaceId: traj.workspaceId,
    actorId: user.id,
    payload: { trajectoryId: traj.id },
  })

  return { ok: true as const }
}
