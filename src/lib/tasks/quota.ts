import 'server-only'
import { and, count, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { topics } from '@/lib/db/schema'
import { ConflictError } from '@/lib/errors'
import { readTaskOperationalSettings } from './settings'

/**
 * Enforce the per-annotator claim quota for the `quota-by-annotator`
 * ("Quota pool") distribution strategy (spec §4.1 配额抢单 / 任务配额).
 *
 * Only this strategy caps how many topics a single annotator may hold in a
 * task; `open-queue` / `round-robin` / `random` have no per-annotator cap, so
 * this is a no-op for them (and a no-op when no quotaTotal is configured).
 *
 * Soft cap: it counts the topics the user already holds in the task and
 * rejects a claim at/over quota. A tiny over-claim race is possible if the
 * same user claims in two tabs at the exact same instant; that's acceptable
 * for a quota pool — each per-topic claim itself stays atomic (assignedTo IS
 * NULL + version CAS at the call site). Throws ConflictError when over quota.
 */
export async function assertWithinClaimQuota(
  taskId: string,
  templateConfig: unknown,
  userId: string,
): Promise<void> {
  const settings = readTaskOperationalSettings(templateConfig)
  if (
    settings.distributionStrategy !== 'quota-by-annotator' ||
    settings.quotaTotal === null
  ) {
    return
  }
  const db = getDb()
  const [row] = await db
    .select({ held: count() })
    .from(topics)
    .where(and(eq(topics.taskId, taskId), eq(topics.assignedTo, userId)))
  const held = Number(row?.held ?? 0)
  if (held >= settings.quotaTotal) {
    throw new ConflictError(
      `You've reached your quota of ${settings.quotaTotal} topic(s) for this task.`,
    )
  }
}
