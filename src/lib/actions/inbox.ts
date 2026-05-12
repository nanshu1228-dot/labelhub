'use server'

/**
 * Inbox binding — the glue that lets you annotate a proxy-captured trajectory.
 *
 * The annotation chain is `step_annotation → annotation → topic → task`.
 * Proxy / SDK captures land in `trajectories` with `taskId: null`, so they
 * have no parent topic and thus no annotation row to attach step marks to.
 *
 * This module auto-materializes that chain on demand:
 *   1. One `Inbox` task per workspace (template_mode = agent-trace-eval)
 *   2. One topic per trajectory, with itemData = { trajectoryId }
 *   3. One annotation per (topic, user)
 *
 * Idempotent — repeated calls return the existing rows, never duplicate.
 *
 * Why use a real Task row instead of relaxing the FK? The schema is the
 * platform's truth. Trajectories under the Inbox are first-class — they
 * show up in events, can be paid out via reward_config, can be archived.
 * Keeping the model honest > saving a write.
 */

import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  tasks,
  topics,
  trajectories,
} from '@/lib/db/schema'
import { NotFoundError } from '@/lib/errors'

// `'use server'` files can only export async functions, so this constant
// stays module-local. Anyone outside this module reads it implicitly via
// the rows returned by `openTrajectoryForAnnotation`.
const INBOX_TASK_NAME = 'Inbox — Captured Trajectories'

/**
 * Find-or-create the Inbox task for this workspace.
 *
 * One Inbox per workspace, identified by its constant name. Cost: a single
 * SELECT on first call, then a single INSERT if missing.
 */
async function getOrCreateInboxTask(workspaceId: string, actorId: string) {
  const db = getDb()
  const [existing] = await db
    .select()
    .from(tasks)
    .where(
      and(eq(tasks.workspaceId, workspaceId), eq(tasks.name, INBOX_TASK_NAME)),
    )
    .limit(1)
  if (existing) return existing

  const [created] = await db
    .insert(tasks)
    .values({
      workspaceId,
      name: INBOX_TASK_NAME,
      phase: 1,
      description:
        'Auto-generated bucket for trajectories captured via proxy / SDK / Eval-Run. Each row in this task corresponds to one captured trajectory.',
      guidelinesMarkdown:
        '# Inbox annotation\n\nRate each step:\n- ✓ correct\n- ⚠ suspicious\n- ✗ wrong\n\nWrite a short reason — the platform learns from disagreements between annotators.',
      templateMode: 'agent-trace-eval',
      rewardConfig: {
        type: 'cash-per-item',
        currency: 'CNY',
        amount: 0,
        qualityMultiplierMin: 1.0,
        qualityMultiplierMax: 1.0,
      },
      status: 'open',
    })
    .returning()

  await db.insert(events).values({
    type: 'inbox.task.created',
    workspaceId,
    actorId,
    payload: { taskId: created.id, name: INBOX_TASK_NAME },
  })

  return created
}

/**
 * Find-or-create the topic that binds this trajectory into the Inbox task.
 *
 * The topic's `itemData.trajectoryId` is how step_annotation auth check
 * (`step.trajectoryId === topic.itemData.trajectoryId`) works — see
 * `src/lib/actions/step-annotations.ts`.
 */
async function getOrCreateInboxTopic(opts: {
  taskId: string
  trajectoryId: string
  workspaceId: string
  actorId: string
}) {
  const db = getDb()
  const allTopics = await db
    .select()
    .from(topics)
    .where(eq(topics.taskId, opts.taskId))

  for (const t of allTopics) {
    const data = t.itemData as { trajectoryId?: string }
    if (data?.trajectoryId === opts.trajectoryId) return t
  }

  const [created] = await db
    .insert(topics)
    .values({
      taskId: opts.taskId,
      itemData: { trajectoryId: opts.trajectoryId },
      status: 'drafting',
    })
    .returning()

  await db.insert(events).values({
    type: 'inbox.topic.created',
    workspaceId: opts.workspaceId,
    actorId: opts.actorId,
    payload: {
      topicId: created.id,
      taskId: opts.taskId,
      trajectoryId: opts.trajectoryId,
    },
  })
  return created
}

/**
 * Find-or-create the annotation row owned by this user for this topic.
 * `payload: {}` until the user submits something — the step_annotations
 * are stored alongside, not inside, this row.
 */
async function getOrCreateMyAnnotation(opts: {
  topicId: string
  userId: string
}) {
  const db = getDb()
  const [existing] = await db
    .select()
    .from(annotations)
    .where(
      and(
        eq(annotations.topicId, opts.topicId),
        eq(annotations.userId, opts.userId),
      ),
    )
    .limit(1)
  if (existing) return existing

  const [created] = await db
    .insert(annotations)
    .values({
      topicId: opts.topicId,
      userId: opts.userId,
      payload: {},
    })
    .returning()
  return created
}

export interface InboxBinding {
  taskId: string
  topicId: string
  annotationId: string
}

/**
 * Single entry point: given a workspace + trajectory + user, hand back the
 * annotation_id needed for step marks. Called from the trajectory detail
 * page the moment an annotator clicks any rating button.
 *
 * Throws NotFoundError if the trajectory doesn't exist OR belongs to a
 * different workspace (anti-spoof).
 */
export async function openTrajectoryForAnnotation(opts: {
  workspaceId: string
  trajectoryId: string
  userId: string
}): Promise<InboxBinding> {
  const db = getDb()
  const [traj] = await db
    .select({
      id: trajectories.id,
      workspaceId: trajectories.workspaceId,
    })
    .from(trajectories)
    .where(eq(trajectories.id, opts.trajectoryId))
    .limit(1)
  if (!traj) throw new NotFoundError('Trajectory')
  if (traj.workspaceId !== opts.workspaceId) {
    throw new NotFoundError('Trajectory') // don't leak existence cross-workspace
  }

  const task = await getOrCreateInboxTask(opts.workspaceId, opts.userId)
  const topic = await getOrCreateInboxTopic({
    taskId: task.id,
    trajectoryId: opts.trajectoryId,
    workspaceId: opts.workspaceId,
    actorId: opts.userId,
  })
  const annotation = await getOrCreateMyAnnotation({
    topicId: topic.id,
    userId: opts.userId,
  })

  return {
    taskId: task.id,
    topicId: topic.id,
    annotationId: annotation.id,
  }
}
