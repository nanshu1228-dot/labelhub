import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import {
  optionalUser,
  requireWorkspaceMember,
} from '@/lib/auth/guards'
import { EvalRunClient } from '@/components/eval-run/eval-run-client'

export const metadata: Metadata = {
  title: 'Run an agent — LabelHub',
}

/**
 * /workspaces/[id]/eval-runs/new
 *
 * Server Component shell. Resolves the workspace name for the breadcrumb,
 * then hands off to the client. The actual eval-run submit is auth-gated
 * inside `POST /api/eval-runs` (requires workspace admin); UI shows the
 * error inline if not authorized.
 *
 * Falls back gracefully when DB isn't configured — page still renders
 * with placeholder breadcrumb so the user can see the design.
 */
export default async function NewEvalRunPage(
  props: PageProps<'/workspaces/[id]/eval-runs/new'>,
) {
  const { id } = await props.params

  // Members only — eval-runs spend LLM tokens.
  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/workspaces/${id}/eval-runs/new`)
  try {
    await requireWorkspaceMember(id)
  } catch {
    notFound()
  }

  let workspaceName = 'workspace'
  try {
    const workspace = await getWorkspaceById(id)
    if (workspace) workspaceName = workspace.name
  } catch {
    // DB not configured — keep placeholder name; the form still renders.
  }

  return <EvalRunClient workspaceId={id} workspaceName={workspaceName} />
}
