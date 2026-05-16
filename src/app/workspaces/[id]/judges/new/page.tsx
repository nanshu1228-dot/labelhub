import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  optionalUser,
  requireWorkspaceAdmin,
} from '@/lib/auth/guards'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { NewJudgeForm } from '@/components/llm-judge/new-judge-form'

export const metadata: Metadata = {
  title: 'New judge — LabelHub',
}

export const dynamic = 'force-dynamic'

export default async function NewJudgePage(props: {
  params: Promise<{ id: string }>
}) {
  const { id: workspaceId } = await props.params
  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/workspaces/${workspaceId}/judges/new`)
  try {
    await requireWorkspaceAdmin(workspaceId)
  } catch {
    notFound()
  }
  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()

  return (
    <div
      className="app-light min-h-screen px-6 py-8"
      style={{ background: 'var(--bg)' }}
    >
      <main className="mx-auto max-w-[900px]">
        <nav className="ts-12 mono flex items-center gap-1.5 mb-4">
          <Link
            href={`/workspaces/${workspaceId}`}
            style={{ color: 'var(--mute)' }}
            className="hover:underline"
          >
            {workspace.name}
          </Link>
          <span style={{ color: 'var(--mute2)' }}>·</span>
          <Link
            href={`/workspaces/${workspaceId}/judges`}
            style={{ color: 'var(--mute)' }}
            className="hover:underline"
          >
            judges
          </Link>
          <span style={{ color: 'var(--mute2)' }}>·</span>
          <span style={{ color: 'var(--text)' }}>new</span>
        </nav>
        <NewJudgeForm workspaceId={workspaceId} />
      </main>
    </div>
  )
}
