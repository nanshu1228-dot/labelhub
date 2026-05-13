import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { getTrajectoryWithSteps } from '@/lib/queries/trajectories'
import { getTrajectoryIAA } from '@/lib/queries/iaa'
import { readMyAnnotatorMarks } from '@/lib/actions/annotate-marks'
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
  props: PageProps<'/workspaces/[id]/trajectories/[trajId]/annotate'>,
) {
  const { id: workspaceId, trajId } = await props.params

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
  // TODO: Claude hints — wire to trajectory-reviewer.ts output. For now empty.
  const claudeHintsByStep = claudeHintsByStepFromList([])

  return (
    <TrajectoryAnnotator
      workspaceId={workspaceId}
      trajectory={trajectoryView}
      rubric={template.rubric}
      initialStepMarks={marks.stepMarks}
      initialTrajectoryMarks={marks.trajectoryMarks}
      peerMarksByStep={peerMarksByStep}
      claudeHintsByStep={claudeHintsByStep}
    />
  )
}
