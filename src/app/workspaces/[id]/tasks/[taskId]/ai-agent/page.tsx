import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Bot } from 'lucide-react'
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
      className="min-h-screen px-4 py-6 sm:px-6 lg:px-8"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6">
        <nav
          className="ts-12 mono flex items-center gap-2 flex-wrap"
          style={{ color: 'var(--mute2)' }}
        >
          <Link
            href={`/workspaces/${workspaceId}/tasks/${taskId}`}
            className="inline-flex items-center gap-1 rounded"
            style={{
              color: 'var(--mute)',
              textDecoration: 'none',
              minHeight: 32,
            }}
          >
            <ArrowLeft size={14} />
            {task.name ?? 'Task'}
          </Link>
          <span>/</span>
          <span>{templateMode}</span>
        </nav>

        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="lbl">AI REVIEW AGENT</div>
            <h1
              className="ts-24 mt-2"
              style={{ color: 'var(--hi)', fontWeight: 560 }}
            >
              Agent configuration
            </h1>
            <p className="ts-13 mt-1" style={{ color: 'var(--mute)' }}>
              {task.name}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <MetaPill label="Mode" value={templateMode} />
            <MetaPill label="Status" value={config.enabled ? 'enabled' : 'off'} />
            <MetaPill
              label="Policy"
              value={`${config.sendBackAt} / ${config.passAt}`}
              icon={<Bot size={13} />}
            />
          </div>
        </header>

        <AgentConfigForm
          taskId={taskId}
          initialConfig={config}
          save={saveAiAgentConfig}
        />
      </div>
    </main>
  )
}

function MetaPill({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon?: ReactNode
}) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded ts-12 mono"
      style={{
        minHeight: 32,
        padding: '0 10px',
        color: 'var(--text)',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        maxWidth: 320,
      }}
    >
      {icon ? <span aria-hidden>{icon}</span> : null}
      <span style={{ color: 'var(--mute2)' }}>{label}</span>
      <span className="truncate">{value}</span>
    </span>
  )
}
