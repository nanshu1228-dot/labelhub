import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { optionalUser, requireWorkspaceAdmin } from '@/lib/auth/guards'
import { getTaskById } from '@/lib/queries/tasks'
import {
  getAiAgentConfig,
  saveAiAgentConfig,
} from '@/lib/actions/ai-agent-config'
import { AgentConfigForm } from '@/components/ai-agent/agent-config-form'

export const metadata: Metadata = {
  title: 'AI Review Agent · Task — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/tasks/[taskId]/ai-agent — Finals P2 D9.
 *
 * Per-task AI Review Agent configuration. Owner-only (workspace
 * admin). Saves into tasks.template_config.aiAgent; the scheduler
 * (src/lib/actions/ai-review-submission.ts) reads from the same
 * path at every annotation submit.
 *
 * Non-admins get 404 to keep the surface invisible (workspace owners
 * tune the rubric privately — labelers shouldn't even know the
 * Prompt exists).
 */
export default async function AIAgentConfigPage({
  params,
}: {
  params: Promise<{ id: string; taskId: string }>
}) {
  const { id: workspaceId, taskId } = await params
  const me = await optionalUser()
  if (!me) {
    redirect(
      `/signin?next=/workspaces/${workspaceId}/tasks/${taskId}/ai-agent`,
    )
  }
  const task = await getTaskById(taskId)
  if (!task || task.workspaceId !== workspaceId) notFound()
  await requireWorkspaceAdmin(workspaceId)

  const { config, templateMode } = await getAiAgentConfig({ taskId })

  return (
    <main
      className="min-h-screen p-8"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <nav
        className="ts-12 mono mb-4 flex items-center gap-2"
        style={{ color: 'var(--mute2)' }}
      >
        <Link
          href={`/workspaces/${workspaceId}/tasks/${taskId}`}
          style={{ color: 'var(--mute)', textDecoration: 'none' }}
        >
          ← {task.name ?? 'Task'}
        </Link>
        <span>·</span>
        <span>{templateMode}</span>
      </nav>
      <AgentConfigForm
        taskId={taskId}
        initialConfig={config}
        save={saveAiAgentConfig}
      />
    </main>
  )
}
