import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  optionalUser,
  requireWorkspaceAdmin,
} from '@/lib/auth/guards'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { NewJudgeForm } from '@/components/llm-judge/new-judge-form'

const SUPPORTED_MODES = new Set(['pair-rubric', 'arena-gsb'])

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
        {SUPPORTED_MODES.has(workspace.templateMode) ? (
          <NewJudgeForm workspaceId={workspaceId} />
        ) : (
          <div
            className="rounded-md p-5"
            style={{
              background: 'var(--warn-soft)',
              border: '1px solid oklch(0.6 0.14 75 / 0.4)',
            }}
          >
            <div
              className="lbl mb-1"
              style={{ color: 'oklch(0.55 0.14 75)' }}
            >
              § NOT SUPPORTED YET
            </div>
            <h1 className="ts-22" style={{ color: 'var(--hi)' }}>
              Judges don&apos;t run on{' '}
              <span className="mono">{workspace.templateMode}</span> yet
            </h1>
            <p
              className="ts-13 mt-2"
              style={{ color: 'var(--text)', maxWidth: 540 }}
            >
              The v1 judge runner samples pair-rubric and arena-gsb
              annotations only. Trajectory rubrics have a per-step +
              per-trajectory payload shape we&apos;ll handle in a
              follow-up. For now, judges are scoped to workspaces that
              produce flat (prompt + A + B) annotations.
            </p>
            <p
              className="ts-13 mt-3 mono"
              style={{ color: 'var(--mute)' }}
            >
              <Link
                href={`/workspaces/${workspaceId}/judges`}
                style={{ color: 'var(--accent)', textDecoration: 'none' }}
              >
                ← back to judges list
              </Link>
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
