import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { annotations } from '@/lib/db/schema'
import {
  optionalUser,
  requireWorkspaceMember,
} from '@/lib/auth/guards'
import { getTopicById } from '@/lib/queries/topics'
import { getTaskById } from '@/lib/queries/tasks'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { getTemplate } from '@/lib/templates/registry'
import '@/lib/templates/init'
import type { TemplateMode } from '@/lib/templates/types'
import { PairRubricForm } from '@/components/topic-annotate/pair-rubric-form'
import { ArenaGsbForm } from '@/components/topic-annotate/arena-gsb-form'

export const metadata: Metadata = {
  title: 'Annotate topic — LabelHub',
}

/**
 * /workspaces/[id]/topics/[topicId]/annotate
 *
 * The annotation surface for the two non-trajectory modes:
 *   - `pair-rubric`  — shared boolean rubric across two model responses
 *   - `arena-gsb`    — multi-dimension 1-5 scoring across two model responses
 *
 * Trajectory annotation has its own dedicated route under
 * `/workspaces/[id]/trajectories/[trajId]/annotate` because the data shape
 * (steps + tool providers) is fundamentally different. Topic-based modes
 * share this route because their data shape is the same envelope (prompt
 * + two responses), with the mode only differing in how the response is
 * scored.
 *
 * Access control: workspace-member + tenant-boundary check (topic must
 * belong to this workspace via its task).
 */
// Next 16 typed-routes regenerates on dev-start; we use an explicit
// param shape here so type-check passes before that happens.
export default async function TopicAnnotatePage(
  props: { params: Promise<{ id: string; topicId: string }> },
) {
  const { id: workspaceId, topicId } = await props.params

  const me = await optionalUser()
  if (!me) {
    redirect(
      `/signin?next=/workspaces/${workspaceId}/topics/${topicId}/annotate`,
    )
  }
  try {
    await requireWorkspaceMember(workspaceId)
  } catch {
    notFound()
  }

  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()

  const topic = await getTopicById(topicId)
  if (!topic) notFound()
  const task = await getTaskById(topic.taskId)
  if (!task) notFound()
  // Cross-tenant boundary: the URL says workspaceId, but the topic
  // is canonically tied to a task → workspace. Reject mismatch.
  if (task.workspaceId !== workspaceId) notFound()

  const template = getTemplate(task.templateMode as TemplateMode)
  if (!template) {
    throw new Error(
      `Task uses templateMode "${task.templateMode}" which is not registered. ` +
        `Either the mode was deleted (run migration) or templates/init.ts ` +
        `failed to import it.`,
    )
  }

  // Existing draft (if any) — pre-fill the form so a refresh doesn't wipe.
  const db = getDb()
  const [draft] = await db
    .select()
    .from(annotations)
    .where(
      and(
        eq(annotations.topicId, topicId),
        eq(annotations.userId, me.id),
      ),
    )
    .limit(1)
  const initialPayload = (draft?.payload ?? {}) as Record<string, unknown>

  // Each form renders the topic header (prompt + A + B) itself so the
  // page-level layout stays mode-agnostic.
  const itemData = topic.itemData as Record<string, unknown>

  if (task.templateMode === 'pair-rubric') {
    return (
      <PairRubricForm
        workspaceId={workspaceId}
        topicId={topicId}
        topicStatus={topic.status}
        itemData={itemData}
        checklist={template.pairChecklist ?? []}
        initialPayload={initialPayload}
        taskName={task.name}
        workspaceName={workspace.name}
      />
    )
  }

  if (task.templateMode === 'arena-gsb') {
    return (
      <ArenaGsbForm
        workspaceId={workspaceId}
        topicId={topicId}
        topicStatus={topic.status}
        itemData={itemData}
        dimensions={template.arenaDimensions ?? []}
        initialPayload={initialPayload}
        taskName={task.name}
        workspaceName={workspace.name}
      />
    )
  }

  // agent-trace-eval should never hit this route — it has its own surface.
  // If someone constructs the URL manually, bounce them to the right place.
  if (task.templateMode === 'agent-trace-eval') {
    // The topic might carry trajectoryId in itemData; if so, deep-link.
    const data = topic.itemData as { trajectoryId?: string }
    if (typeof data?.trajectoryId === 'string') {
      redirect(
        `/workspaces/${workspaceId}/trajectories/${data.trajectoryId}/annotate`,
      )
    }
  }

  // Unknown mode — bail loudly. We don't render a half-broken surface.
  notFound()
}
