import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { optionalUser, requireWorkspaceAdmin } from '@/lib/auth/guards'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { getTopicById } from '@/lib/queries/topics'
import { getTaskById } from '@/lib/queries/tasks'
import { listRevisionsForTopic } from '@/lib/actions/annotation-revisions'
import { HistoryClient } from '@/components/history/history-client'

export const metadata: Metadata = {
  title: 'Annotation history — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/topics/[topicId]/history
 *
 * Admin-only time machine for one topic. Lists every annotation tied
 * to the topic, and for each annotation a chronological revision
 * history. Admin can pick any revision and click "restore" — the
 * action writes a new revision marked 'restore' pointing at the
 * picked one and updates the live annotation payload.
 *
 * Append-only by design: the picked revision is NEVER overwritten,
 * so successive restores are reversible.
 */
export default async function TopicHistoryPage(props: {
  params: Promise<{ id: string; topicId: string }>
}) {
  const { id: workspaceId, topicId } = await props.params

  const me = await optionalUser()
  if (!me) {
    redirect(
      `/signin?next=/workspaces/${workspaceId}/topics/${topicId}/history`,
    )
  }
  try {
    await requireWorkspaceAdmin(workspaceId)
  } catch {
    notFound()
  }
  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()
  const topic = await getTopicById(topicId)
  if (!topic) notFound()
  const task = await getTaskById(topic.taskId)
  if (!task || task.workspaceId !== workspaceId) notFound()

  const { annotations: lists } = await listRevisionsForTopic({ topicId })

  return (
    <main
      className="app-light min-h-screen px-6 py-8"
      style={{ background: 'var(--bg)' }}
    >
      <div className="mx-auto max-w-[1000px]">
        <nav
          className="ts-12 mono flex items-center gap-1.5 mb-4"
          style={{ color: 'var(--mute2)' }}
        >
          <Link
            href={`/workspaces/${workspaceId}`}
            className="hover:underline"
            style={{ color: 'var(--mute)' }}
          >
            {workspace.name}
          </Link>
          <span>·</span>
          <Link
            href={`/workspaces/${workspaceId}/tasks/${task.id}`}
            className="hover:underline"
            style={{ color: 'var(--mute)' }}
          >
            {task.name}
          </Link>
          <span>·</span>
          <Link
            href={`/workspaces/${workspaceId}/topics/${topicId}/annotate`}
            className="hover:underline"
            style={{ color: 'var(--mute)' }}
          >
            topic
          </Link>
          <span>·</span>
          <span style={{ color: 'var(--text)' }}>history</span>
        </nav>

        <div className="mb-6">
          <div className="lbl mb-2">§ ANNOTATION HISTORY</div>
          <h1 className="ts-28" style={{ color: 'var(--hi)' }}>
            Time machine
          </h1>
          <p
            className="ts-13 mt-2"
            style={{ color: 'var(--mute)', maxWidth: 640 }}
          >
            Every save (autosave / submit / restore) appended as an
            immutable revision. Pick any version and click{' '}
            <span className="mono">restore</span> to roll the live
            annotation back to that state. Restores are themselves new
            revisions — fully reversible.
          </p>
        </div>

        {lists.length === 0 ? (
          <div
            className="rounded-md p-6 text-center ts-13 mono"
            style={{
              background: 'var(--panel)',
              border: '1px dashed var(--line)',
              color: 'var(--mute)',
            }}
          >
            No annotations on this topic yet — nothing to restore.
          </div>
        ) : (
          <HistoryClient lists={lists} />
        )}
      </div>
    </main>
  )
}
