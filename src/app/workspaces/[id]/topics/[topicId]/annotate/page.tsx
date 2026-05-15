import type { Metadata } from 'next'
import Link from 'next/link'
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
import {
  getAnnotationReviewContext,
  type AnnotationReviewContext,
} from '@/lib/queries/annotation-review'
import {
  getReviewThread,
  type ReviewThreadMessage,
} from '@/lib/queries/review-thread'
import {
  getTopicPeerConsensus,
  type TopicPeerData,
} from '@/lib/queries/topic-peer-consensus'
import { getEffectiveTemplate } from '@/lib/templates/effective'
import '@/lib/templates/init'
import {
  ReviewVerdictControls,
  type ViewerRole,
} from '@/components/quality/review-verdict-controls'
import { ReviewThread } from '@/components/quality/review-thread'
import { PairRubricForm } from '@/components/topic-annotate/pair-rubric-form'
import { ArenaGsbForm } from '@/components/topic-annotate/arena-gsb-form'

export const metadata: Metadata = {
  title: 'Annotate topic — LabelHub',
}

/**
 * /workspaces/[id]/topics/[topicId]/annotate
 *
 * Two modes:
 *
 *   1. NORMAL (no `?annotationId=`): the viewer is annotating themselves.
 *      We load the viewer's own draft (or create on first save via auto-
 *      claim) and let them edit.
 *
 *   2. REVIEW (`?annotationId=<id>`): a QC/admin reviewer wants to inspect
 *      a specific submitter's annotation and render a verdict. We load
 *      THAT user's payload + the topic's review-thread events, and the
 *      form auto-goes read-only because topic.status is past `drafting`.
 *      Verdict buttons + reply textarea render alongside.
 *
 * Trajectory annotation has its own dedicated route — this one only
 * handles the topic-payload modes (pair-rubric / arena-gsb).
 */
export default async function TopicAnnotatePage(props: {
  params: Promise<{ id: string; topicId: string }>
  searchParams?: Promise<{ annotationId?: string }>
}) {
  const { id: workspaceId, topicId } = await props.params
  const search = (await props.searchParams) ?? {}
  const reviewAnnotationIdFromUrl =
    typeof search.annotationId === 'string' ? search.annotationId : null

  const me = await optionalUser()
  if (!me) {
    const qs = reviewAnnotationIdFromUrl
      ? `?annotationId=${reviewAnnotationIdFromUrl}`
      : ''
    redirect(
      `/signin?next=/workspaces/${workspaceId}/topics/${topicId}/annotate${qs}`,
    )
  }

  let viewerRole: ViewerRole
  try {
    const membership = await requireWorkspaceMember(workspaceId)
    viewerRole = membership.role
  } catch {
    notFound()
  }

  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()

  const topic = await getTopicById(topicId)
  if (!topic) notFound()
  const task = await getTaskById(topic.taskId)
  if (!task) notFound()
  if (task.workspaceId !== workspaceId) notFound()

  const template = getEffectiveTemplate(task.templateMode, task.templateConfig)
  if (!template) {
    throw new Error(
      `Task uses templateMode "${task.templateMode}" which is not registered.`,
    )
  }

  // Resolve review mode, if requested.
  const db = getDb()
  let reviewContext: AnnotationReviewContext | null = null
  let reviewThread: ReviewThreadMessage[] = []
  let peerConsensus: TopicPeerData | null = null
  let displayPayload: Record<string, unknown> = {}
  let displayStatus = topic.status

  if (reviewAnnotationIdFromUrl) {
    const ctx = await getAnnotationReviewContext({
      annotationId: reviewAnnotationIdFromUrl,
      workspaceId,
    })
    if (ctx) {
      // Defense-in-depth: the annotation must actually belong to THIS topic
      // (URL composition could mismatch).
      const [submitterAnno] = await db
        .select()
        .from(annotations)
        .where(eq(annotations.id, reviewAnnotationIdFromUrl))
        .limit(1)
      if (submitterAnno && submitterAnno.topicId === topicId) {
        reviewContext = ctx
        displayPayload = (submitterAnno.payload ?? {}) as Record<
          string,
          unknown
        >
        displayStatus = ctx.topicStatus
        // Run two parallel reads — the review thread + the peer
        // consensus (other raters' aggregated values on this topic).
        // Peer consensus only renders in review mode (the submitter
        // themselves shouldn't see it to avoid biasing them mid-draft).
        const [thread, peer] = await Promise.all([
          getReviewThread({ annotationId: reviewAnnotationIdFromUrl }),
          getTopicPeerConsensus({
            topicId,
            excludeUserId: ctx.submitterId,
          }),
        ])
        reviewThread = thread
        peerConsensus = peer
      }
    }
    // If ctx lookup failed (bad id, cross-workspace, etc.) we fall through
    // to NORMAL mode rather than 404 — matches the trajectory page's
    // forgiving behavior. The banner just won't render.
  }

  if (!reviewContext) {
    // Normal mode: load viewer's own draft.
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
    displayPayload = (draft?.payload ?? {}) as Record<string, unknown>
    displayStatus = topic.status
  }

  // agent-trace-eval should never hit this route — bounce to the right one.
  if (task.templateMode === 'agent-trace-eval') {
    const data = topic.itemData as { trajectoryId?: string }
    if (typeof data?.trajectoryId === 'string') {
      const qs = reviewAnnotationIdFromUrl
        ? `?annotationId=${reviewAnnotationIdFromUrl}`
        : ''
      redirect(
        `/workspaces/${workspaceId}/trajectories/${data.trajectoryId}/annotate${qs}`,
      )
    }
    notFound()
  }

  const itemData = topic.itemData as Record<string, unknown>
  const viewerIsSubmitter =
    !!reviewContext && reviewContext.submitterId === me.id

  const formNode = (() => {
    if (task.templateMode === 'pair-rubric') {
      return (
        <PairRubricForm
          workspaceId={workspaceId}
          topicId={topicId}
          topicStatus={displayStatus}
          itemData={itemData}
          checklist={template.pairChecklist ?? []}
          initialPayload={displayPayload}
          taskName={task.name}
          workspaceName={workspace.name}
          peerConsensus={
            peerConsensus && peerConsensus.mode === 'pair-rubric'
              ? { pair: peerConsensus.pair, peerCount: peerConsensus.peerCount }
              : null
          }
        />
      )
    }
    if (task.templateMode === 'arena-gsb') {
      return (
        <ArenaGsbForm
          workspaceId={workspaceId}
          topicId={topicId}
          topicStatus={displayStatus}
          itemData={itemData}
          dimensions={template.arenaDimensions ?? []}
          initialPayload={displayPayload}
          taskName={task.name}
          workspaceName={workspace.name}
          peerConsensus={
            peerConsensus && peerConsensus.mode === 'arena-gsb'
              ? {
                  arena: peerConsensus.arena,
                  peerCount: peerConsensus.peerCount,
                }
              : null
          }
        />
      )
    }
    return null
  })()

  if (!formNode) notFound()

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      {reviewContext && (
        <div className="mb-4">
          <ReviewModeBanner
            submitter={
              reviewContext.submitterDisplayName ??
              reviewContext.submitterEmail?.split('@')[0] ??
              'this annotator'
            }
            status={reviewContext.topicStatus}
            workspaceId={workspaceId}
            topicId={topicId}
          />
        </div>
      )}

      {reviewContext && (
        <div className="mb-6">
          <ReviewVerdictControls
            annotationId={reviewContext.annotationId}
            topicStatus={reviewContext.topicStatus}
            viewerRole={viewerRole}
            viewerIsSubmitter={viewerIsSubmitter}
            submitterDisplayName={reviewContext.submitterDisplayName}
          />
        </div>
      )}

      {formNode}

      {reviewContext && reviewThread.length > 0 && (
        <div className="mt-8">
          <ReviewThread
            annotationId={reviewContext.annotationId}
            messages={reviewThread}
            canReply={viewerIsSubmitter}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Tiny banner that explains why the page is read-only and links back
 * to the user's own view of the topic. Mirrors the trajectory route's
 * equivalent so QC/admin flows feel consistent.
 */
function ReviewModeBanner({
  submitter,
  status,
  workspaceId,
  topicId,
}: {
  submitter: string
  status: string
  workspaceId: string
  topicId: string
}) {
  return (
    <div
      className="rounded-md flex items-center justify-between gap-3 px-3 py-2"
      style={{
        background: 'var(--accent-soft)',
        border: '1px solid var(--accent-line)',
      }}
    >
      <div className="ts-12">
        <span className="lbl" style={{ color: 'var(--accent)' }}>
          § REVIEW MODE
        </span>
        <span className="ml-2" style={{ color: 'var(--text)' }}>
          inspecting{' '}
          <strong style={{ color: 'var(--hi)' }}>{submitter}</strong>
          &apos;s annotation · status{' '}
          <span className="mono" style={{ color: 'var(--mute2)' }}>
            {status}
          </span>
        </span>
      </div>
      <Link
        href={`/workspaces/${workspaceId}/topics/${topicId}/annotate`}
        className="ts-11 mono shrink-0"
        style={{
          color: 'var(--accent)',
          textDecoration: 'none',
        }}
      >
        exit review →
      </Link>
    </div>
  )
}
