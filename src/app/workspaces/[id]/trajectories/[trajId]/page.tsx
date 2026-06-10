import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { getTrajectoryWithSteps } from '@/lib/queries/trajectories'
import { getTrajectoryIAA, type StepIAA } from '@/lib/queries/iaa'
import { getGoldForTrajectory } from '@/lib/queries/gold-standards'
import {
  findUserAnnotationForTrajectory,
  getReviewThread,
  type ReviewThreadMessage,
} from '@/lib/queries/review-thread'
import { optionalUser, requireWorkspaceMember } from '@/lib/auth/guards'
import { getDb } from '@/lib/db/client'
import { users as usersTable } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { listMyStepMarksInline } from '@/lib/actions/step-annotations-inline'
import { GoldPromoteClient } from '@/components/quality/gold-promote-client'
import { ReviewThread } from '@/components/quality/review-thread'
import { ReviewVerdictControls } from '@/components/quality/review-verdict-controls'
import {
  getAnnotationAuditTimeline,
  type TimelineEntry,
} from '@/lib/queries/annotation-timeline'
import { AnnotationAuditTimeline } from '@/components/quality/annotation-audit-timeline'
import { SummaryCard } from '@/components/trajectory/summary-card'
import { getCachedSummary } from '@/lib/actions/trajectory-summary'
import type { TrajectoryFeatures } from '@/lib/trajectories/extract-features'
import type { TrajectorySummary } from '@/lib/ai/trajectory-summarizer'
import {
  Header,
  Body,
  DbError,
  ReviewModeBanner,
} from '@/components/trajectory/detail'

export const metadata: Metadata = {
  title: 'Trajectory — LabelHub',
}

/**
 * /workspaces/[id]/trajectories/[trajId]
 *
 * Read-only trajectory inspector. Server-rendered for fast first paint —
 * the data we display (steps + tool providers) is immutable once captured.
 *
 * This page is a thin data-fetch + compose shell: all presentation lives in
 * `@/components/trajectory/detail` and pure formatters in
 * `@/lib/trajectories/meta-display`.
 */
export default async function TrajectoryDetailPage(
  props: PageProps<'/workspaces/[id]/trajectories/[trajId]'> & {
    searchParams?: Promise<{ annotationId?: string }>
  },
) {
  const { id: workspaceId, trajId } = await props.params
  const search = (await props.searchParams) ?? {}
  // ?annotationId= switches the page into "review mode" — show THIS
  // submitter's marks (not the viewer's) and render verdict controls.
  const reviewAnnotationIdFromUrl =
    typeof search.annotationId === 'string' ? search.annotationId : null

  let workspaceName = 'workspace'
  let dbError: string | null = null
  let bundle: Awaited<ReturnType<typeof getTrajectoryWithSteps>> = null
  let myMarks: Awaited<ReturnType<typeof listMyStepMarksInline>> = {}
  let iaaByStep = new Map<string, StepIAA>()
  let isAdmin = false
  let viewerRole: 'admin' | 'qc' | 'annotator' | 'viewer' = 'viewer'
  let goldBlock: {
    id: string
    promotedAt: Date
    promotedBy: string | null
    explanation: string | null
    markCount: number
  } | null = null
  let reviewThread: ReviewThreadMessage[] = []
  let auditTimeline: TimelineEntry[] = []
  let reviewAnnotationId: string | null = null
  let viewerIsSubmitter = false
  // Review-mode-only fields, populated when ?annotationId= is present.
  let reviewContext: import('@/lib/queries/annotation-review').AnnotationReviewContext | null = null
  let summary: TrajectorySummary | null = null
  let summaryAt: Date | null = null
  let summaryModel: string | null = null
  let features: TrajectoryFeatures | null = null

  // Access control: signed-in workspace members only. Trajectory detail
  // pages expose root prompt, full step traces, AI summary, peer marks —
  // everything except the keys. Unauth visitors get bounced to /signin;
  // non-members get a generic 404 (don't leak existence across tenants).
  const me = await optionalUser()
  if (!me) {
    redirect(
      `/signin?next=/workspaces/${workspaceId}/trajectories/${trajId}`,
    )
  }

  try {
    const workspace = await getWorkspaceById(workspaceId)
    if (!workspace) notFound()
    workspaceName = workspace.name

    {
      try {
        const { role } = await requireWorkspaceMember(workspaceId)
        viewerRole = role
        isAdmin = role === 'admin' || workspace.adminId === me.id
      } catch {
        // Not a member of this workspace — don't render anything.
        notFound()
      }

      // Review mode (?annotationId=...): load the SPECIFIC submitter's
      // marks + their thread; verdict controls render based on viewer
      // role × topic status. Falls back to "my marks" mode if the
      // annotationId is invalid or not in this workspace.
      if (reviewAnnotationIdFromUrl) {
        const { getAnnotationReviewContext } = await import(
          '@/lib/queries/annotation-review'
        )
        const ctx = await getAnnotationReviewContext({
          annotationId: reviewAnnotationIdFromUrl,
          workspaceId,
        }).catch(() => null)
        if (ctx) {
          reviewContext = ctx
          reviewAnnotationId = ctx.annotationId
          viewerIsSubmitter = ctx.submitterId === me.id
          const [thread, audit] = await Promise.all([
            getReviewThread({ annotationId: ctx.annotationId }).catch(
              () => [],
            ),
            getAnnotationAuditTimeline({
              annotationId: ctx.annotationId,
            }).catch(() => [] as TimelineEntry[]),
          ])
          reviewThread = thread
          auditTimeline = audit
        }
      }

      // Fallback path: if we're NOT in review mode (or review-mode load
      // failed), wire up the viewer's own annotation thread so the
      // submitter can see and reply to their pending review.
      if (!reviewContext) {
        const annId = await findUserAnnotationForTrajectory({
          workspaceId,
          trajectoryId: trajId,
          userId: me.id,
        }).catch(() => null)
        if (annId) {
          reviewAnnotationId = annId
          viewerIsSubmitter = true
          reviewThread = await getReviewThread({
            annotationId: annId,
          }).catch(() => [])
        }
      }
    }

    bundle = await getTrajectoryWithSteps(trajId)
    if (bundle) {
      features = (bundle.trajectory.features ?? null) as TrajectoryFeatures | null
      summaryAt = bundle.trajectory.summaryAt ?? null
      summaryModel = bundle.trajectory.summaryModel ?? null
      summary = await getCachedSummary(trajId).catch(() => null)

      // Marks source: in review mode use the submitter's marks; otherwise
      // the viewer's own. Same shape either way, downstream widgets don't
      // know the difference.
      const marksLoader = reviewContext
        ? (async () => {
            const { getStepMarksForAnnotation } = await import(
              '@/lib/queries/annotation-review'
            )
            return getStepMarksForAnnotation({
              annotationId: reviewContext.annotationId,
              workspaceId,
            })
          })()
        : listMyStepMarksInline({ workspaceId, trajectoryId: trajId })

      const [marks, iaa, gold] = await Promise.all([
        marksLoader,
        getTrajectoryIAA(trajId),
        getGoldForTrajectory({ workspaceId, trajectoryId: trajId }),
      ])
      myMarks = marks
      iaaByStep = new Map(iaa.map((s) => [s.trajectoryStepId, s]))
      if (gold) {
        const db = getDb()
        const [promoter] = await db
          .select({
            displayName: usersTable.displayName,
            email: usersTable.email,
          })
          .from(usersTable)
          .where(eq(usersTable.id, gold.promotedByUserId))
          .limit(1)
        const trajMarkCount = Object.keys(
          gold.correctAnswer.trajectoryMarks ?? {},
        ).length
        const stepMarkCount = Object.values(
          gold.correctAnswer.stepMarks ?? {},
        ).reduce((acc, m) => acc + Object.keys(m).length, 0)
        goldBlock = {
          id: gold.id,
          promotedAt: gold.promotedAt,
          promotedBy:
            promoter?.displayName ??
            promoter?.email?.split('@')[0] ??
            null,
          explanation: gold.explanation,
          markCount: trajMarkCount + stepMarkCount,
        }
      }
    }
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e)
  }

  if (!dbError && !bundle) notFound()

  const demoMode = process.env.LABELHUB_DEMO_MODE === 'true'

  return (
    <div className="app-light min-h-screen">
      <Header
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        agentName={bundle?.trajectory.agentName ?? 'trajectory'}
        trajectoryId={trajId}
      />

      <main className="mx-auto max-w-[1200px] px-6 py-8">
        {dbError ? (
          <DbError
            message={dbError}
            description="Couldn't load this trajectory."
          />
        ) : bundle ? (
          <>
            {reviewContext && (
              <div className="mb-3">
                <ReviewModeBanner
                  submitter={
                    reviewContext.submitterDisplayName ??
                    reviewContext.submitterEmail?.split('@')[0] ??
                    'this annotator'
                  }
                  status={reviewContext.topicStatus}
                  workspaceId={workspaceId}
                  trajectoryId={trajId}
                />
              </div>
            )}
            <div className="mb-6">
              <SummaryCard
                summary={summary}
                features={features}
                summaryAt={summaryAt}
                summaryModel={summaryModel}
              />
            </div>
            {(goldBlock || isAdmin) && (
              <div className="mb-6">
                <GoldPromoteClient
                  workspaceId={workspaceId}
                  trajectoryId={trajId}
                  isAdmin={isAdmin}
                  gold={goldBlock}
                />
              </div>
            )}
            {/* Verdict controls only render in review mode (?annotationId=…). */}
            {reviewContext && (
              <div className="mb-6">
                <ReviewVerdictControls
                  annotationId={reviewContext.annotationId}
                  topicStatus={reviewContext.topicStatus}
                  viewerRole={viewerRole}
                  twoStage={reviewContext.twoStageReview}
                  viewerIsSubmitter={viewerIsSubmitter}
                  submitterDisplayName={reviewContext.submitterDisplayName}
                />
              </div>
            )}
            {reviewThread.length > 0 && reviewAnnotationId && (
              <div className="mb-6">
                <ReviewThread
                  annotationId={reviewAnnotationId}
                  messages={reviewThread}
                  canReply={viewerIsSubmitter}
                />
              </div>
            )}
            {reviewContext && auditTimeline.length > 0 && (
              <div className="mb-6">
                <AnnotationAuditTimeline entries={auditTimeline} />
              </div>
            )}
            <Body
              workspaceId={workspaceId}
              trajectory={bundle.trajectory}
              steps={bundle.steps}
              providersById={bundle.providersById}
              myMarks={myMarks}
              demoMode={demoMode}
              iaaByStep={iaaByStep}
            />
          </>
        ) : null}
      </main>
    </div>
  )
}
