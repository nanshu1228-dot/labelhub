import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { optionalUser, requireWorkspaceAdmin } from '@/lib/auth/guards'
import { getDb } from '@/lib/db/client'
import { users, workspaceMembers } from '@/lib/db/schema'
import { getTaskById } from '@/lib/queries/tasks'
import { createTopicsBatch } from '@/lib/actions/topics'
import { ImportWizard } from '@/components/task-admin/import-wizard'
import { readTaskOperationalSettings } from '@/lib/tasks/settings'

export const metadata: Metadata = {
  title: 'Import topics — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /admin/tasks/[id]/import — Finals D21-C.
 *
 * Spec section 4.1 calls for JSON / JSONL / Excel import (we also
 * accept CSV via the D14 parser registry). D14 shipped the parsers;
 * D21-C is the missing UI surface.
 *
 * Auth: requireWorkspaceAdmin on the task's workspace. 404 to
 * everyone else (don't leak task existence).
 */
export default async function ImportTopicsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/admin/tasks/${id}/import`)

  const task = await getTaskById(id)
  if (!task) notFound()
  try {
    await requireWorkspaceAdmin(task.workspaceId)
  } catch {
    notFound()
  }

  // Eligible annotators = workspace members with role 'annotator'.
  // The distribution UI in the wizard reads this list to render
  // the round-robin / random / quota chips. When the list is empty
  // the wizard falls back to leaving rows unassigned (open queue).
  const db = getDb()
  const annotatorRows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, task.workspaceId),
        eq(workspaceMembers.role, 'annotator'),
      ),
    )

  const annotators = annotatorRows.map((r) => ({
    id: r.id,
    label: r.displayName ?? r.email,
  }))
  const taskSettings = readTaskOperationalSettings(task.templateConfig)

  return (
    <ImportWizard
      taskId={task.id}
      taskName={task.name}
      templateMode={task.templateMode}
      annotators={annotators}
      backHref={`/workspaces/${task.workspaceId}/tasks/${task.id}`}
      initialStrategy={taskSettings.distributionStrategy}
      importBatch={createTopicsBatch}
    />
  )
}
