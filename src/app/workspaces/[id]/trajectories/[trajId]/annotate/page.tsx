import type { Metadata } from 'next'
import { after } from 'next/server'
import { notFound } from 'next/navigation'
import { count, eq, desc, and, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { trajectories, trajectorySteps } from '@/lib/db/schema'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { getTrajectoryWithSteps } from '@/lib/queries/trajectories'
import { getTrajectoryIAA } from '@/lib/queries/iaa'
import { readMyAnnotatorMarks } from '@/lib/actions/annotate-marks'
import { scheduleHintsIfMissing, type CachedClaudeHint } from '@/lib/actions/trajectory-hints'
import { getTemplate } from '@/lib/templates/registry'
import '@/lib/templates/init'
import {
  TrajectoryAnnotator,
  trajectoryViewFromDb,
  peerMarksFromIaa,
  claudeHintsByStepFromList,
} from '@/components/trajectory/annotate'

export const metadata: Metadata = {
  title: 'Annotate trajectory — LabelHub',
}

/**
 * /workspaces/[id]/trajectories/[trajId]/annotate
 *
 * The new annotation surface. SSR loads everything the client shell needs:
 *   - trajectory + steps + tool providers       (immutable once captured)
 *   - my existing marks                          (canonical Mark JSON)
 *   - IAA (peer-rater consensus) for the viz
 *   - rubric spec from the registered template
 *
 * The actual annotation work is client-side: each rubric input subscribes
 * to its own Jotai atom and autosaves on debounce. Server actions only
 * see the result of an edit, not every keystroke.
 *
 * The old read-only detail page (`../page.tsx`) is kept as the fallback
 * for view-only consumers — reviewers, dashboards, dispute callouts. The
 * "Open annotator" CTA on that page links here.
 */
export default async function TrajectoryAnnotatePage(
  props: PageProps<'/workspaces/[id]/trajectories/[trajId]/annotate'> & {
    searchParams?: Promise<{ compareWith?: string }>
  },
) {
  const { id: workspaceId, trajId } = await props.params
  const searchParams = (await props.searchParams) ?? {}

  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()

  const bundle = await getTrajectoryWithSteps(trajId)
  if (!bundle) notFound()
  // Trajectory must actually belong to this workspace — otherwise we'd be
  // letting `/workspaces/A/trajectories/<id-from-B>` work.
  if (bundle.trajectory.workspaceId !== workspaceId) notFound()

  // Resolve the rubric. For now every trajectory uses the flagship trace-eval
  // rubric. When templates become per-workspace, look up by workspace.templateMode.
  const template = getTemplate('agent-trace-eval')
  if (!template?.rubric) {
    // Misconfiguration — surfaced as a hard error rather than rendering an
    // empty annotation surface.
    throw new Error(
      'Agent-trace-eval template has no rubric configured. Check src/lib/templates/modes/agent-trace-eval.ts.',
    )
  }

  // Parallelize the three independent reads.
  const [marks, iaa] = await Promise.all([
    readMyAnnotatorMarks({ workspaceId, trajectoryId: trajId }),
    getTrajectoryIAA(trajId),
  ])

  // Adapt DB shapes to client view types.
  const trajectoryView = trajectoryViewFromDb(
    bundle.trajectory,
    bundle.steps,
    bundle.providersById,
  )
  const peerMarksByStep = peerMarksFromIaa(iaa, /* myUserId */ null)

  // Claude pre-annotation hints — read cached list off the trajectory row.
  // If absent, schedule a background compute via after() so this page's
  // response isn't blocked on a 10s Sonnet call. Next visit will have hints.
  const cachedHints = Array.isArray(bundle.trajectory.claudeHints)
    ? (bundle.trajectory.claudeHints as CachedClaudeHint[])
    : []
  const claudeHintsByStep = claudeHintsByStepFromList(cachedHints)
  if (cachedHints.length === 0) {
    after(async () => {
      try {
        await scheduleHintsIfMissing({ trajectoryId: trajId })
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(
          `Claude-hint background fill failed for ${trajId}:`,
          e instanceof Error ? e.message : e,
        )
      }
    })
  }

  // Compare-mode data: list other trajectories in the workspace + optionally
  // load the one we're comparing against (from ?compareWith=… query param).
  const db = getDb()
  const candidateRows = await db
    .select({
      id: trajectories.id,
      agentName: trajectories.agentName,
      capturedAt: trajectories.createdAt,
      stepCount: count(trajectorySteps.id),
    })
    .from(trajectories)
    .leftJoin(
      trajectorySteps,
      eq(trajectorySteps.trajectoryId, trajectories.id),
    )
    .where(
      and(
        eq(trajectories.workspaceId, workspaceId),
        isNull(trajectories.deletedAt),
      ),
    )
    .groupBy(
      trajectories.id,
      trajectories.agentName,
      trajectories.createdAt,
    )
    .orderBy(desc(trajectories.createdAt))
    .limit(50)
  const candidateTrajectories = candidateRows
    .filter((r) => r.id !== trajId) // exclude self
    .map((r) => ({
      id: r.id,
      agentName: r.agentName,
      capturedAt: r.capturedAt as Date | null,
      stepCount: Number(r.stepCount ?? 0),
    }))

  let compareWithTrajectory: ReturnType<typeof trajectoryViewFromDb> | null = null
  if (searchParams.compareWith) {
    const bundleB = await getTrajectoryWithSteps(searchParams.compareWith)
    if (bundleB && bundleB.trajectory.workspaceId === workspaceId) {
      compareWithTrajectory = trajectoryViewFromDb(
        bundleB.trajectory,
        bundleB.steps,
        bundleB.providersById,
      )
    }
  }

  return (
    <TrajectoryAnnotator
      workspaceId={workspaceId}
      trajectory={trajectoryView}
      rubric={template.rubric}
      initialStepMarks={marks.stepMarks}
      initialTrajectoryMarks={marks.trajectoryMarks}
      peerMarksByStep={peerMarksByStep}
      claudeHintsByStep={claudeHintsByStep}
      candidateTrajectories={candidateTrajectories}
      compareWithTrajectory={compareWithTrajectory}
    />
  )
}
